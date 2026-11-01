import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { modules, scenarios } from '../src/catalog.js';
import { createOpenApi } from './openapi.mjs';
import { scenarioServices } from '../src/server/registry.js';
import { loadServerEnv } from '../src/server/env.js';
import { importNovelChapter, NOVEL_IMPORT_PATH, NovelImportError } from '../src/modules/text/novel-import.js';
import { importNewsArticle, NEWS_IMPORT_PATH } from '../src/modules/text/news-import.js';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
loadServerEnv(path.join(projectRoot,'.env'));
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.json':'application/json; charset=utf-8'};
const json = (response, status, body, headers={}) => {response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers});response.end(JSON.stringify(body));};

const BACKEND_URL = (process.env.BACKEND_URL || 'http://127.0.0.1:8010').replace(/\/$/, '');
// createServer() 默认 scaffold，保证 CI/单测不依赖后端；CLI 启动时可用 PROXY_BACKEND=1 开启代理。
function wantProxy(explicit) {
  if (explicit != null) return Boolean(explicit);
  return /^(1|true|yes)$/i.test(String(process.env.PROXY_BACKEND || ''));
}
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

export function createServer({dist=false, proxy=null, novelImporter=importNovelChapter, newsImporter=importNewsArticle, textModelClient, egteClient}={}) {
  function readJsonBody(request,{maxBytes=16*1024}={}){
  return new Promise((resolve,reject)=>{
    const declared=Number(request.headers['content-length']);
    if(Number.isFinite(declared)&&declared>maxBytes){reject(new NovelImportError('REQUEST_TOO_LARGE','请求内容超过允许大小。',{status:413}));request.resume();return;}
    const chunks=[];let size=0,settled=false;
    const fail=error=>{if(settled)return;settled=true;reject(error);};
    request.on('data',chunk=>{if(settled)return;size+=chunk.length;if(size>maxBytes){fail(new NovelImportError('REQUEST_TOO_LARGE','请求内容超过允许大小。',{status:413}));request.resume();return;}chunks.push(chunk);});
    request.on('end',()=>{if(settled)return;settled=true;try{const raw=Buffer.concat(chunks).toString('utf8');resolve(raw?JSON.parse(raw):{});}catch{reject(new NovelImportError('INVALID_JSON','请求内容必须是有效JSON。',{status:400}));}});
    request.on('error',fail);
  });
}


  const base = path.resolve(projectRoot,dist?'dist':'.');
  const proxyEnabled = wantProxy(proxy);
  return http.createServer(async (request,response)=>{
    const requestId = randomUUID();
    let pathname;
    try { pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname); } catch { return json(response,400,{error:{code:'BAD_URL',message:'无效地址'},requestId}); }
    if (pathname.startsWith('/api/')) {
      if (pathname==='/api/v1/health' && request.method==='GET') return json(response,200,{status:'ok',mode:'development',businessImplemented:true,implementedScenarios:['text_news','text_novel']});
      if (pathname==='/api/v1/catalog' && request.method==='GET') return json(response,200,{data:modules,counts:{modules:modules.length,scenarios:scenarios.length},requestId});
      if (pathname===NOVEL_IMPORT_PATH) {
        if(request.method!=='POST')return json(response,405,{error:{code:'METHOD_NOT_ALLOWED',message:'请使用 POST'},requestId},{Allow:'POST'});
        try{
          const payload=await readJsonBody(request);
          if(typeof payload.url!=='string'||!payload.url.trim())throw new NovelImportError('INVALID_URL','请提供章节网页链接。',{status:400,sourceUrl:payload.url});
          const data=await novelImporter(payload.url.trim());
          return json(response,200,{data,requestId});
        }catch(error){
          if(error instanceof NovelImportError||error?.code)return json(response,error.status||500,{error:{code:error.code||'INTERNAL_ERROR',message:error.status?error.message:'章节导入服务处理失败'},details:error.details,requestId});
          return json(response,500,{error:{code:'INTERNAL_ERROR',message:'章节导入服务处理失败'},requestId});
        }
      }
      if (pathname===NEWS_IMPORT_PATH) {
        if(request.method!=='POST')return json(response,405,{error:{code:'METHOD_NOT_ALLOWED',message:'请使用 POST'},requestId},{Allow:'POST'});
        try{
          const payload=await readJsonBody(request);
          if(typeof payload.url!=='string'||!payload.url.trim())throw new NovelImportError('INVALID_URL','请提供新闻网页链接。',{status:400,sourceUrl:payload.url});
          const data=await newsImporter(payload.url.trim());
          return json(response,200,{data,requestId});
        }catch(error){
          if(error instanceof NovelImportError||error?.code)return json(response,error.status||500,{error:{code:error.code||'INTERNAL_ERROR',message:error.status?error.message:'新闻导入服务处理失败'},details:error.details,requestId});
          return json(response,500,{error:{code:'INTERNAL_ERROR',message:'新闻导入服务处理失败'},requestId});
        }
      }
      const feature=scenarios.find(item=>item.api.path===pathname);
      const localText = feature?.moduleId === 'text' && ['news', 'novel'].includes(feature.id);
      if (proxyEnabled && !localText) {
        try { await proxyBackend(request, response, pathname); }
        catch (error) {
          if (!request.destroyed && !response.destroyed && !response.writableEnded) {
            json(response,502,{error:{code:'BACKEND_UNREACHABLE',message:'后端代理请求失败'},requestId});
          }
        }
        return;
      }
      const allowed=feature?.api.method || (['/api/v1/health','/api/v1/catalog'].includes(pathname)?'GET':null);
      if (allowed && request.method!==allowed) return json(response,405,{error:{code:'METHOD_NOT_ALLOWED',message:`请使用 ${allowed}`},requestId},{Allow:allowed});
      if (feature) {
        try {
          const textAnalysis = feature.moduleId === 'text' && ['news', 'novel'].includes(feature.id);
          const payload = await readJsonBody(request,{maxBytes:textAnalysis ? 4*1024*1024 : 1024*1024});
          const data = await scenarioServices[feature.moduleId](feature, payload, { requestId, modelClient:textModelClient, egteClient });
          return json(response,200,{data,requestId});
        } catch (error) {
          if (error.code === 'NOT_IMPLEMENTED') return json(response,501,{error:{code:error.code,message:error.message},requestId,endpoint:feature.api});
          if (error?.code && error?.status) return json(response,error.status,{error:{code:error.code,message:error.expose===false?'服务处理失败':error.message},requestId});
          return json(response,500,{error:{code:'INTERNAL_ERROR',message:'服务处理失败'},requestId});
        }
      }
      return json(response,404,{error:{code:'NOT_FOUND',message:'接口不存在'},requestId});
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
  // CLI：无 CI 时默认代理后端；CI 或 PROXY_BACKEND=0 时保持 scaffold
  const proxy = process.env.PROXY_BACKEND != null
    ? wantProxy()
    : process.env.CI !== 'true';
  const server=createServer({dist:process.argv.includes('--dist'), proxy});
  // 默认 requestTimeout=300s，长 PDF 会在代理层被断开
  if (proxy) {
    server.requestTimeout = PROXY_TIMEOUT_MS;
    server.headersTimeout = PROXY_TIMEOUT_MS;
    server.keepAliveTimeout = 120_000;
  }
  server.on('error',error=>{console.error(`无法启动服务：${error.message}`);process.exitCode=1;});
  server.listen(port,host,()=>{
    if (proxy) {
      console.log(`VERITAS preview: http://${host}:${port}\nAPI proxy → ${BACKEND_URL} (timeout ${PROXY_TIMEOUT_MS}ms)`);
    } else {
      console.log(`VERITAS preview: http://${host}:${port}\nMode: framework only / business endpoints return 501`);
    }
  });
}
