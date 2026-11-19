import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serviceDir = path.dirname(fileURLToPath(import.meta.url));
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_HTML_BYTES * 3 + 65_536;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

export function loadTextImportParserEnv() {
  return readFile(path.join(serviceDir, '.env'), 'utf8').then(text => {
    for (const original of text.replace(/^\uFEFF/u, '').split(/\r?\n/u)) {
      const match = /^\s*(MINERU_[A-Z0-9_]+|TEXT_IMPORT_PARSER_(?:HOST|PORT))\s*=\s*(.*?)\s*$/u.exec(original);
      if (!match || process.env[match[1]] !== undefined) continue;
      let value = match[2];
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      process.env[match[1]] = value;
    }
  }).catch(error => { if (error?.code !== 'ENOENT') throw error; });
}

function json(response, status, body, extraHeaders = {}) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders });
  response.end(JSON.stringify(body));
}

async function readJsonBody(request) {
  const declared = Number(request.headers['content-length']);
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) throw Object.assign(new Error('请求过大。'), { code: 'PAYLOAD_TOO_LARGE', status: 413 });
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_REQUEST_BYTES) throw Object.assign(new Error('请求过大。'), { code: 'PAYLOAD_TOO_LARGE', status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('请求必须是有效JSON。'), { code: 'INVALID_JSON', status: 400 }); }
}

function mineruCommand() {
  let command;
  try { command = JSON.parse(process.env.MINERU_COMMAND_JSON || '["mineru"]'); }
  catch { throw Object.assign(new Error('MINERU_COMMAND_JSON格式无效。'), { code: 'INVALID_CONFIG', status: 500 }); }
  if (!Array.isArray(command) || !command.length || command.some(item => typeof item !== 'string' || !item)) {
    throw Object.assign(new Error('MINERU_COMMAND_JSON必须是非空字符串数组。'), { code: 'INVALID_CONFIG', status: 500 });
  }
  return command;
}

function mineruArguments(paths) {
  let template;
  try { template = JSON.parse(process.env.MINERU_ARGS_JSON || '["parse","{input}","-o","{output_file}"]'); }
  catch { throw Object.assign(new Error('MINERU_ARGS_JSON格式无效。'), { code: 'INVALID_CONFIG', status: 500 }); }
  if (!Array.isArray(template) || !template.length || template.some(item => typeof item !== 'string')) {
    throw Object.assign(new Error('MINERU_ARGS_JSON必须是非空字符串数组。'), { code: 'INVALID_CONFIG', status: 500 });
  }
  return template.map(item => item
    .replaceAll('{input}', paths.input)
    .replaceAll('{output_file}', paths.outputFile)
    .replaceAll('{output_dir}', paths.outputDir));
}

function runCommand(command, args, { cwd, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    const collect = target => chunk => {
      outputBytes += chunk.length;
      if (outputBytes <= 128 * 1024) target.push(chunk);
    };
    child.stdout.on('data', collect(stdout));
    child.stderr.on('data', collect(stderr));
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(Object.assign(new Error('MinerU解析超时。'), { code: 'PARSER_TIMEOUT', status: 504 }));
    }, timeoutMs);
    child.once('error', error => {
      clearTimeout(timer);
      reject(Object.assign(new Error(error?.code === 'ENOENT' ? '未找到MinerU命令。' : '无法启动MinerU。'), { code: 'PARSER_NOT_READY', status: 503 }));
    });
    child.once('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') });
      else reject(Object.assign(new Error('MinerU解析失败。'), { code: 'PARSER_FAILED', status: 502 }));
    });
  });
}

async function markdownFiles(directory, output = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) await markdownFiles(target, output);
    else if (entry.isFile() && /\.md$/iu.test(entry.name)) output.push(target);
  }
  return output;
}

function markdownToText(markdown) {
  return String(markdown)
    .replace(/<!--[\s\S]*?-->/gu, '')
    .replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/gu, '')
    .replace(/<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/giu, '')
    .replace(/<[^>\n]+>/gu, '')
    .replace(/!\[[^\]]*\]\([^\n)]*\)/gu, '')
    .replace(/\[([^\]]+)\]\([^\n)]*\)/gu, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gmu, '')
    .replace(/[\t ]+/gu, ' ')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

async function parseInputWithMineru(inputData, { extension, temporaryPrefix }) {
  const workDir = await mkdtemp(path.join(os.tmpdir(), temporaryPrefix));
  const input = path.join(workDir, `source${extension}`);
  const outputDir = path.join(workDir, 'output');
  const outputFile = path.join(outputDir, 'result.md');
  try {
    await mkdir(outputDir, { recursive: true });
    await writeFile(input, inputData);
    const [command, ...prefix] = mineruCommand();
    const timeoutMs = Number(process.env.MINERU_TIMEOUT_MS || 90_000);
    await runCommand(command, [...prefix, ...mineruArguments({ input, outputFile, outputDir })], {
      cwd: workDir,
      timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 90_000,
    });
    const files = await markdownFiles(outputDir);
    const documents = await Promise.all(files.map(async file => {
      const content = await readFile(file, 'utf8');
      return { file, content, bytes: Buffer.byteLength(content, 'utf8') };
    }));
    const selected = documents.filter(item => item.bytes <= MAX_OUTPUT_BYTES).sort((left, right) => right.bytes - left.bytes)[0];
    const text = selected ? markdownToText(selected.content) : '';
    if (text.length < 60) throw Object.assign(new Error('MinerU未返回足够的正文。'), { code: 'PARSER_EMPTY', status: 422 });
    return { text, markdown: selected?.content || '', chapters: [], parser: 'mineru-cli' };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function parseHtmlWithMineru(html) {
  if (typeof html !== 'string' || !html.trim()) throw Object.assign(new Error('html不能为空。'), { code: 'INVALID_HTML', status: 400 });
  if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) throw Object.assign(new Error('html超过2MiB。'), { code: 'PAYLOAD_TOO_LARGE', status: 413 });
  return parseInputWithMineru(html, { extension: '.html', temporaryPrefix: 'veritas-mineru-html-' });
}

export async function parseImageWithMineru(image, { extension = '.png' } = {}) {
  if (!Buffer.isBuffer(image) || !image.length) throw Object.assign(new Error('图片不能为空。'), { code: 'INVALID_IMAGE', status: 400 });
  if (image.length > MAX_IMAGE_BYTES) throw Object.assign(new Error('图片超过12MiB。'), { code: 'PAYLOAD_TOO_LARGE', status: 413 });
  if (!/^\.(?:png|jpe?g|webp)$/iu.test(extension)) throw Object.assign(new Error('只支持PNG、JPEG或WebP图片。'), { code: 'INVALID_IMAGE_TYPE', status: 400 });
  return parseInputWithMineru(image, { extension: extension.toLowerCase(), temporaryPrefix: 'veritas-mineru-image-' });
}

export function createParserServer({ parser = parseHtmlWithMineru } = {}) {
  return http.createServer(async (request, response) => {
    let pathname;
    try { pathname = new URL(request.url, 'http://localhost').pathname; }
    catch { return json(response, 400, { error: { code: 'INVALID_URL', message: '无效请求地址。' } }); }

    if (pathname === '/health') {
      if (request.method !== 'GET') return json(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: '请使用GET。' } }, { Allow: 'GET' });
      try {
        const [command, ...prefix] = mineruCommand();
        await runCommand(command, [...prefix, '--help'], { cwd: serviceDir, timeoutMs: 10_000 });
        return json(response, 200, { status: 'ok', ready: true, service: 'text-import-parser', engine: 'mineru-cli' });
      } catch (error) {
        return json(response, 503, { status: 'degraded', ready: false, service: 'text-import-parser', error: { code: error.code || 'PARSER_NOT_READY', message: error.message } });
      }
    }

    if (pathname !== '/api/v1/html/parse') return json(response, 404, { error: { code: 'NOT_FOUND', message: '接口不存在。' } });
    if (request.method !== 'POST') return json(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: '请使用POST。' } }, { Allow: 'POST' });
    if (!String(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
      request.resume();
      return json(response, 415, { error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: '请使用application/json。' } });
    }

    try {
      const payload = await readJsonBody(request);
      const data = await parser(payload?.html, { sourceUrl: typeof payload?.sourceUrl === 'string' ? payload.sourceUrl : '' });
      return json(response, 200, { data });
    } catch (error) {
      return json(response, error.status || 500, { error: { code: error.code || 'INTERNAL_ERROR', message: error.status ? error.message : '解析服务处理失败。' } });
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await loadTextImportParserEnv();
  const host = process.env.TEXT_IMPORT_PARSER_HOST || '127.0.0.1';
  const port = Number(process.env.TEXT_IMPORT_PARSER_PORT || 8013);
  const server = createParserServer();
  server.listen(port, host, () => console.log(`Text import parser: http://${host}:${port}`));
}
