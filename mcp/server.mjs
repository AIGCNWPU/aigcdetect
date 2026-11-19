#!/usr/bin/env node
/** VERITAS 音频伪造检测 · MCP Server
 *
 * 一个 server、一个工具：detect_audio_forgery。
 * 用户/模型都不需要判断音频里有几个人——服务端固定用 mode=auto：
 *   单人 → 整段结论；双人及以上 → 分人结论（谁被伪造）。
 *
 * 用法：
 *   node mcp/server.mjs                 # stdio（Claude Desktop / Cursor）
 *   node mcp/server.mjs --http 8787     # Streamable HTTP（远程/云端）
 *
 * 环境变量：
 *   VERITAS_API_BASE   网关地址，默认 http://127.0.0.1:8080
 *   VERITAS_API_KEY    可选，会带 Authorization: Bearer
 *   VERITAS_TIMEOUT_MS 单次检测超时，默认 180000
 *   MCP_FETCH_MAX_MB   允许从 URL 拉取的音频上限，默认 40
 */
import http from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

import { summarizeText } from './summarize.mjs';

const API_BASE = (process.env.VERITAS_API_BASE || 'http://127.0.0.1:8080').replace(/\/$/, '');
const API_KEY = process.env.VERITAS_API_KEY || '';
const TIMEOUT_MS = Number(process.env.VERITAS_TIMEOUT_MS || 180_000);
const FETCH_MAX_MB = Number(process.env.MCP_FETCH_MAX_MB || 40);

const TOOL_DESCRIPTION = [
  '检测一段音频是否包含 AI 合成/克隆语音。',
  '系统会自动识别说话人数量，用户不需要事先说明音频里有几个人：',
  '单人音频返回整段结论（是否伪造、可疑片段、伪造手法）；',
  '双人对话会额外返回每个人分别是不是伪造的。',
  '适用于：核实通话录音、客服对话、采访素材是否被 AI 篡改。',
].join('');

async function callGateway(body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE}/api/v1/audio/forgery`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
    if (!response.ok) {
      const code = payload?.error?.code || `HTTP_${response.status}`;
      const message = payload?.error?.message || text.slice(0, 300) || '服务返回错误';
      throw new Error(`${code}：${message}`);
    }
    if (!payload || !payload.data) throw new Error('服务返回格式异常：缺少 data 字段');
    return payload.data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(`检测超时（>${TIMEOUT_MS / 1000}s），音频可能过长`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** 把 http(s) 音频下载成 base64（服务端暂只接受 base64）。 */
async function fetchAsBase64(url, fileName) {
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error(`audioUrl 不是合法地址：${url}`); }
  if (!/^https?:$/.test(parsed.protocol)) throw new Error('audioUrl 只支持 http / https');

  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`拉取音频失败：HTTP ${response.status}`);
  const length = Number(response.headers.get('content-length') || 0);
  if (length && length > FETCH_MAX_MB * 1024 * 1024) {
    throw new Error(`音频超过 ${FETCH_MAX_MB} MB 上限（${(length / 1024 / 1024).toFixed(1)} MB）`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > FETCH_MAX_MB * 1024 * 1024) {
    throw new Error(`音频超过 ${FETCH_MAX_MB} MB 上限`);
  }
  const name = fileName || decodeURIComponent(parsed.pathname.split('/').pop() || 'audio.wav');
  return { audioBase64: buffer.toString('base64'), fileName: name };
}

function createServer() {
  const server = new McpServer({ name: 'veritas-audio', version: '1.0.0' });

  server.tool(
    'detect_audio_forgery',
    TOOL_DESCRIPTION,
    {
      audioUrl: z.string().url().optional().describe('音频的 http(s) 直链（与 audioBase64 二选一）'),
      audioBase64: z.string().optional().describe('音频内容的 base64（与 audioUrl 二选一）'),
      fileName: z.string().optional().describe('文件名，仅用于结果里标识来源'),
    },
    async ({ audioUrl, audioBase64, fileName }) => {
      try {
        if (!audioUrl && !audioBase64) {
          return {
            isError: true,
            content: [{ type: 'text', text: '请提供 audioUrl 或 audioBase64 其中之一。' }],
          };
        }
        const body = audioBase64
          ? { audioBase64, fileName: fileName || 'upload.wav', mode: 'auto' }
          : { ...(await fetchAsBase64(audioUrl, fileName)), mode: 'auto' };

        const data = await callGateway(body);
        return {
          content: [{ type: 'text', text: summarizeText(data) }],
          structuredContent: data,
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: `检测失败：${error.message}` }],
        };
      }
    },
  );

  return server;
}

async function startStdio() {
  const server = createServer();
  await server.connect(new StdioServerTransport());
  // stdio 模式下 stdout 属于协议通道，日志必须写 stderr
  console.error(`[veritas-audio] stdio ready, gateway=${API_BASE}`);
}

async function startHttp(port) {
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);

  const httpServer = http.createServer(async (request, response) => {
    if (request.url === '/health') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      return response.end(JSON.stringify({ status: 'ok', server: 'veritas-audio', gateway: API_BASE }));
    }
    if (request.url !== '/mcp') {
      response.writeHead(404, { 'Content-Type': 'application/json' });
      return response.end(JSON.stringify({ error: 'not found' }));
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    let body;
    try { body = raw ? JSON.parse(raw) : undefined; } catch {
      response.writeHead(400, { 'Content-Type': 'application/json' });
      return response.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null }));
    }
    await transport.handleRequest(request, response, body);
  });

  await new Promise(resolve => httpServer.listen(port, '0.0.0.0', resolve));
  console.log(`[veritas-audio] http ready: http://0.0.0.0:${port}/mcp (gateway=${API_BASE})`);
}

const args = process.argv.slice(2);
const httpIndex = args.indexOf('--http');
if (httpIndex >= 0) {
  await startHttp(Number(args[httpIndex + 1] || 8787));
} else {
  await startStdio();
}
