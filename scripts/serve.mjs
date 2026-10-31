import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { modules, scenarios } from '../src/catalog.js';
import { createOpenApi } from './openapi.mjs';
import { scenarioServices } from '../src/server/registry.js';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.json':'application/json; charset=utf-8'};
const json = (response, status, body, headers={}) => {response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers});response.end(JSON.stringify(body));};

const BACKEND_URL = (process.env.BACKEND_URL || 'http://127.0.0.1:8010').replace(/\/$/, '');
// PDF/MinerU 常要 5–10 分钟才回首包；fetch/undici 默认 ~300s 无响应体会掐断，页面误报「后端不可达」
const PROXY_TIMEOUT_MS = Number(process.env.PROXY_TIMEOUT_MS || 1_800_000); // 默认 30 分钟，覆盖大 PDF / MinerU

async function proxyBackend(request, response, pathname) {
  const target = new URL(pathname + (request.url.includes('?') ? request.url.slice(request.url.indexOf('?')) : ''), BACKEND_URL);
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
    if (Buffer.concat(chunks).length > 80_000_000) {
      request.destroy();
      return json(response, 413, { error: { code: 'PAYLOAD_TOO_LARGE', message: '请求过大' } });
    }
  }
  const body = ['GET', 'HEAD'].includes(request.method) ? null : Buffer.concat(chunks);
  const headers = {};
  for (const name of ['content-type', 'accept', 'authorization']) {
    const value = request.headers[name];
    if (value) headers[name] = value;
  }
  if (body) headers['content-length'] = String(body.length);

  await new Promise(resolve => {
    const upstreamReq = http.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      path: `${target.pathname}${target.search}`,
      method: request.method,
      headers,
      timeout: PROXY_TIMEOUT_MS,
    }, upstreamRes => {
      const out = [];
      upstreamRes.on('data', chunk => out.push(chunk));
      upstreamRes.on('end', () => {
        if (response.writableEnded) return resolve();
        const outHeaders = { 'Cache-Control': 'no-store' };
        const contentType = upstreamRes.headers['content-type'];
        if (contentType) outHeaders['Content-Type'] = contentType;
        const disposition = upstreamRes.headers['content-disposition'];
        if (disposition) outHeaders['Content-Disposition'] = disposition;
        response.writeHead(upstreamRes.statusCode || 502, outHeaders);
        response.end(Buffer.concat(out));
        resolve();
      });
      upstreamRes.on('error', error => {
        if (!response.writableEnded) {
          json(response, 502, { error: { code: 'BACKEND_UNREACHABLE', message: `后端不可达 ${BACKEND_URL}：${error.message}` } });
        }
        resolve();
      });
    });
    upstreamReq.on('timeout', () => {
      upstreamReq.destroy(new Error(`代理等待后端超时（>${PROXY_TIMEOUT_MS / 1000}s），大 PDF 解析可能仍在进行`));
    });
    upstreamReq.on('error', error => {
      if (!response.writableEnded) {
        json(response, 502, {
          error: {
            code: 'BACKEND_UNREACHABLE',
            message: `后端不可达 ${BACKEND_URL}：${error.message}`,
          },
        });
      }
      resolve();
    });
    if (body) upstreamReq.write(body);
    upstreamReq.end();
  });
}

export function createServer({dist=false}={}) {
  const base = path.resolve(projectRoot,dist?'dist':'.');
  return http.createServer(async (request,response)=>{
    const requestId = randomUUID();
    let pathname;
    try { pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname); } catch { return json(response,400,{error:{code:'BAD_URL',message:'无效地址'},requestId}); }
    if (pathname.startsWith('/api/')) {
      // 框架自检仍本地返回；其余 /api 一律代理到真实后端（8010）
      if (pathname==='/api/v1/catalog' && request.method==='GET') {
        return json(response,200,{data:modules,counts:{modules:modules.length,scenarios:scenarios.length},requestId});
      }
      return proxyBackend(request, response, pathname);
    }
    if (!['GET','HEAD'].includes(request.method)) return json(response,405,{error:{code:'METHOD_NOT_ALLOWED',message:'静态资源仅支持 GET / HEAD'},requestId},{Allow:'GET, HEAD'});
    if (pathname==='/docs/openapi.json') {
      if (request.method==='HEAD') { response.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});return response.end(); }
      return json(response,200,createOpenApi());
    }
    const relative = pathname==='/'?'index.html':pathname.slice(1);
    if (relative.split(/[\\/]/).some(part=>part==='..'||part==='.') || relative.includes('\0')) return json(response,404,{error:{code:'NOT_FOUND',message:'资源不存在'},requestId});
    const allowedStatic=relative==='index.html'||relative.startsWith('src/')||relative.startsWith('public/')||dist&&relative.startsWith('assets/');
    const target=path.resolve(base,relative);
    if (!allowedStatic || !target.startsWith(base+path.sep)) return json(response,404,{error:{code:'NOT_FOUND',message:'资源不存在'},requestId});
    try {
      const data=await readFile(target);
      response.writeHead(200,{'Content-Type':mime[path.extname(target)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
      response.end(request.method==='HEAD'?undefined:data);
    } catch { return json(response,404,{error:{code:'NOT_FOUND',message:'资源不存在'},requestId}); }
  });
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const port=Number(process.env.PORT||4173);
  const rawHost = process.env.BIND_HOST || process.env.HOST || '127.0.0.1';
  const host = /linux-gnu|conda/i.test(rawHost) ? '127.0.0.1' : rawHost;
  const server=createServer({dist:process.argv.includes('--dist')});
  // 默认 requestTimeout=300s，长 PDF 会在代理层被断开
  server.requestTimeout = PROXY_TIMEOUT_MS;
  server.headersTimeout = PROXY_TIMEOUT_MS;
  server.keepAliveTimeout = 120_000;
  server.on('error',error=>{console.error(`无法启动服务：${error.message}`);process.exitCode=1;});
  server.listen(port,host,()=>console.log(`VERITAS preview: http://${host}:${port}\nAPI proxy → ${BACKEND_URL} (timeout ${PROXY_TIMEOUT_MS}ms)`));
}
