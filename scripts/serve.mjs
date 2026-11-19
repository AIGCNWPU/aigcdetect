import { BODY_LIMIT, ReviewError } from '../src/modules/image/documents/server/review-service.js';
import { clientFiles } from './source-files.mjs';
import http from 'node:http';
import https from 'node:https';
import { handleAuthRequest, currentUser, beginDetectionCharge } from '../src/server/auth.js';
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

import { createRefundApi } from '../src/modules/image/refund/server/api.js';
import { createVideoApi } from '../src/modules/video/aftersales/server/api.js';
import { allowSameOriginRequest } from '../src/server/request-origin.js';
import { API_APPLICATION_PATH, saveApiApplication } from '../src/server/api-applications.js';
import { renderStandardReport, reportFilename, REPORT_BODY_LIMIT } from '../src/modules/image/report-standard/service.js';

import { readMultipartBody } from '../src/server/multipart.js';
import { detectorHealth } from '../src/server/detector.js';

/** 场景 POST 请求体：multipart 存入文件与字段，JSON 解析为对象，其余报 415。 */
async function readScenarioPayload(request) {
  const contentType=String(request.headers['content-type']||'');
  if (contentType.startsWith('multipart/form-data')) return readMultipartBody(request);
  if (contentType.startsWith('application/json')) {
    const chunks=[];let total=0;
    for await (const chunk of request) {
      total+=chunk.length;
      if(total>1024*1024) throw Object.assign(new Error('JSON 请求体超过 1 MiB。'),{code:'PAYLOAD_TOO_LARGE',status:413});
      chunks.push(chunk);
    }
    if(!chunks.length) return undefined;
    try { return {json:JSON.parse(Buffer.concat(chunks).toString('utf8'))}; } catch { throw Object.assign(new Error('JSON 请求体格式无效。'),{code:'BAD_JSON',status:400}); }
  }
  throw Object.assign(new Error('请使用 multipart/form-data 或 application/json 提交。'),{code:'UNSUPPORTED_MEDIA_TYPE',status:415});
}


import { forwardDeepfake } from '../src/server/video-deepfake.js';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
loadServerEnv(path.join(projectRoot,'.env'));
const mime = {'.mp4':'video/mp4','.webm':'video/webm','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.json':'application/json; charset=utf-8'};
const json = (response, status, body, headers={}) => {
  if (status >= 400 && !Object.hasOwn(headers, 'X-Veritas-Credits')) response.removeHeader('X-Veritas-Credits');
  response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers});
  response.end(JSON.stringify(body));
};

const BACKEND_URL = (process.env.BACKEND_URL || 'http://127.0.0.1:8010').replace(/\/$/, '');
// createServer() 默认 scaffold，保证 CI/单测不依赖后端；CLI 启动时可用 PROXY_BACKEND=1 开启代理。
function wantProxy(explicit) {
  if (explicit != null) return Boolean(explicit);
  return /^(1|true|yes)$/i.test(String(process.env.PROXY_BACKEND || ''));
}
// PDF/MinerU 常要 5–10 分钟才回首包；fetch/undici 默认 ~300s 无响应体会掐断，页面误报「后端不可达」
const PROXY_TIMEOUT_MS = Number(process.env.PROXY_TIMEOUT_MS || 1_800_000); // 默认 30 分钟，覆盖大 PDF / MinerU

async function proxyBackend(request, response, pathname, baseUrl=BACKEND_URL, maxBytes=80_000_000, { beforeForward=null }={}) {
  const target = new URL(pathname + (request.url.includes('?') ? request.url.slice(request.url.indexOf('?')) : ''), baseUrl);
  if (Number(request.headers['content-length']) > maxBytes) { request.resume(); return json(response,413,{error:{code:'PAYLOAD_TOO_LARGE',message:'请求过大'}}); }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    chunks.push(chunk);
    bytes += chunk.length;
    if (bytes > maxBytes) {
      request.destroy();
      return json(response, 413, { error: { code: 'PAYLOAD_TOO_LARGE', message: '请求过大' } });
    }
  }
  const body = ['GET', 'HEAD'].includes(request.method) ? null : Buffer.concat(chunks);
  if (beforeForward && !(await beforeForward(body))) return;
  const headers = {};
  for (const name of ['content-type', 'accept', 'authorization']) {
    const value = request.headers[name];
    if (value) headers[name] = value;
  }
  if (body) headers['content-length'] = String(body.length);

  await new Promise(resolve => {
    const upstreamReq = (target.protocol === 'https:' ? https : http).request({
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
        const statusCode = upstreamRes.statusCode || 502;
        if (statusCode >= 400) response.removeHeader('X-Veritas-Credits');
        const outHeaders = { 'Cache-Control': 'no-store' };
        const contentType = upstreamRes.headers['content-type'];
        if (contentType) outHeaders['Content-Type'] = contentType;
        const disposition = upstreamRes.headers['content-disposition'];
        if (disposition) outHeaders['Content-Disposition'] = disposition;
        response.writeHead(statusCode, outHeaders);
        response.end(Buffer.concat(out));
        resolve();
      });
      upstreamRes.on('error', error => {
        if (!response.writableEnded) {
          json(response, 502, { error: { code: 'BACKEND_UNREACHABLE', message: '检测后端当前无法连接，请稍后重试。' } });
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
            message: '检测后端当前无法连接，请稍后重试。',
          },
        });
      }
      resolve();
    });
    if (body) upstreamReq.write(body);
    upstreamReq.end();
  });
}

async function readReviewRequest(request) {
  if(!/^application\/json(?:;|$)/i.test(request.headers['content-type']||''))throw new ReviewError('JSON_REQUIRED','请使用JSON文件上传请求',415);
  if(request.headers.origin&&request.headers.origin!==`http://${request.headers.host}`&&request.headers.origin!==`https://${request.headers.host}`)throw new ReviewError('ORIGIN_REJECTED','不接受跨站请求',403);
  if(Number(request.headers['content-length'])>BODY_LIMIT)throw new ReviewError('UPLOAD_TOO_LARGE','上传请求超过大小限制',413);
  const buffers=[];let size=0;
  for await(const chunk of request){size+=chunk.length;if(size>BODY_LIMIT)throw new ReviewError('UPLOAD_TOO_LARGE','上传请求超过大小限制',413);buffers.push(chunk);}
  try{return JSON.parse(Buffer.concat(buffers).toString('utf8'));}catch{throw new ReviewError('BAD_JSON','请求JSON无效');}
}

function isBillableDetectionPayload(pathname, payload) {
  if (pathname === '/api/v1/image/general') return payload?.action === 'detect';
  if (pathname === '/api/v1/image/documents') return payload?.action === 'review';
  if (pathname === '/api/v1/text/news') return !payload?.action || payload.action === 'analyze';
  if (pathname === '/api/v1/text/novel') {
    if (payload?.action === 'rewrite') return false;
    if (Array.isArray(payload?.checks) && payload.checks.length > 0 && payload.checks.every(item => item === 'rewrite')) return false;
    return true;
  }
  return true;
}

export function createServer({dist=false, proxy=null, enforceCredits=process.env.NODE_ENV==='production', novelImporter=importNovelChapter, newsImporter=importNewsArticle, textModelClient, egteClient, refundOptions, videoOptions, deepfakeServiceUrl=process.env.VLAFORGE_SERVICE_URL || 'http://127.0.0.1:8601', audioServiceUrl=process.env.AUDIO_SERVICE_URL || 'http://127.0.0.1:8000', imageServiceUrl=process.env.IMAGE_GENERAL_SERVICE_URL || '', imageDocumentsServiceUrl=process.env.IMAGE_DOCUMENTS_SERVICE_URL || imageServiceUrl}={}) {
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

  function gateDetection(request, response, requestId, { scene, pathname, summary = '', runIdFallback = '' }) {
    const user = currentUser(request);
    if (!user) {
      if (!enforceCredits) return true;
      request.resume();
      json(response, 401, { error: { code: 'UNAUTHENTICATED', message: '请先登录或注册后再开始检测（新用户注册即赠 100 积分）' }, requestId });
      return false;
    }
    const runId = String(request.headers['x-veritas-run-id'] || runIdFallback || '');
    const charge = beginDetectionCharge(user.id, { scene, path: pathname, summary, runId });
    if (!charge.ok) {
      request.resume();
      json(response, charge.status, { error: { code: charge.code, message: charge.message }, credits: charge.credits, requestId }, { 'X-Veritas-Credits': String(charge.credits) });
      return false;
    }
    response.setHeader('X-Veritas-Credits', String(charge.credits));
    let finalized = false;
    const finalize = () => {
      if (finalized) return;
      finalized = true;
      charge.finish(Boolean(response.writableFinished && response.statusCode < 400));
    };
    response.once('finish', finalize);
    response.once('close', finalize);
    return true;
  }

  const base = path.resolve(projectRoot,dist?'dist':'.');
  const proxyEnabled = wantProxy(proxy);
  const refundApi=createRefundApi(refundOptions);
  const videoApi=createVideoApi(videoOptions);
  const server=http.createServer(async (request,response)=>{
    const requestId = randomUUID();
    let pathname;
    try { pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname); } catch { return json(response,400,{error:{code:'BAD_URL',message:'无效地址'},requestId}); }
    request.on('error', () => {});
    response.on('error', () => {});
    if (pathname.startsWith('/api/')) {
      if (pathname === API_APPLICATION_PATH) {
        const fail = (status, code, message, headers) => json(response, status, { error: { code, message }, requestId }, headers);
        if (request.method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED', '请使用 POST。', { Allow: 'POST' });
        if (!allowSameOriginRequest(request)) return fail(403, 'ORIGIN_REJECTED', '请从智鉴 API 中心提交。');
        if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) {
          return fail(415, 'JSON_REQUIRED', '请使用 JSON 提交。');
        }
        try {
          const payload = await readJsonBody(request, { maxBytes: 8 * 1024 });
          const { status, ...result } = saveApiApplication(payload);
          return json(response, status, { ...result, requestId });
        } catch (error) {
          if (error instanceof NovelImportError) return fail(error.status, error.code, error.message);
          return fail(500, 'APPLICATION_UNAVAILABLE', '申请暂时无法保存，请稍后重试。');
        }
      }
      if (await handleAuthRequest(request,response,pathname,{enforceCredits})) return;
      if (pathname==='/api/v1/version' && request.method==='GET') return json(response,200,{commit:process.env.VERITAS_COMMIT||null,release:process.env.VERITAS_RELEASE||'development'});
      const audioPath=pathname==='/api/v1/audio/health'?'/api/v1/health':pathname==='/api/v1/audio/forgery'?pathname:null;
      const imageTarget=pathname==='/api/v1/image/general'?imageServiceUrl:pathname==='/api/v1/image/documents'?imageDocumentsServiceUrl:'';
      if (proxyEnabled && (audioPath || imageTarget)) {
        const allowed=pathname.endsWith('/health')?'GET':'POST';
        if(request.method!==allowed)return json(response,405,{error:{code:'METHOD_NOT_ALLOWED',message:`请使用 ${allowed}`},requestId},{Allow:allowed});
        const origin=request.headers.origin;
        if(origin && origin!==`https://${request.headers.host}` && origin!==`http://${request.headers.host}`)return json(response,403,{error:{code:'ORIGIN_REJECTED',message:'不接受跨站请求'},requestId});
        if (pathname==='/api/v1/audio/forgery' && !gateDetection(request, response, requestId, { scene: 'audio-forgery', pathname })) return;
        const beforeForward = imageTarget ? bodyBuf => {
          let parsed = null;
          try { parsed = bodyBuf ? JSON.parse(bodyBuf.toString('utf8')) : null; } catch { return true; }
          if (!isBillableDetectionPayload(pathname, parsed)) return true;
          const scene = pathname === '/api/v1/image/general' ? 'image-general' : 'image-documents';
          return gateDetection(request, response, requestId, { scene, pathname });
        } : null;
        try {await proxyBackend(request,response,audioPath||pathname,audioPath?audioServiceUrl:imageTarget,audioPath?112*1024*1024:BODY_LIMIT,{beforeForward});}
        catch {if(!response.destroyed&&!response.writableEnded)json(response,502,{error:{code:'BACKEND_UNREACHABLE',message:'检测后端当前无法连接，请稍后重试。'},requestId});}
        return;
      }
    }
    if (pathname === '/api/v1/video/deepfake' || pathname === '/api/v1/video/deepfake/health') {
      const allowed = pathname.endsWith('/health') ? 'GET' : 'POST';
      if (request.method !== allowed) return json(response,405,{error:{code:'METHOD_NOT_ALLOWED',message:`请使用 ${allowed}`},requestId},{Allow:allowed});
      if (pathname === '/api/v1/video/deepfake' && !gateDetection(request, response, requestId, { scene: 'video-deepfake', pathname })) return;
      const result = await forwardDeepfake(request,response,deepfakeServiceUrl,requestId);
      return json(response,result.status,result.body);
    }
    if (pathname.startsWith('/api/')) {
      if (request.method==='POST' && pathname==='/api/v1/image/refund/jobs' && allowSameOriginRequest(request)) {
        if (!gateDetection(request, response, requestId, { scene: 'image-refund', pathname })) return;
      }
      if(await refundApi.handle(request,response,pathname,requestId))return;
      if (request.method==='POST' && pathname==='/api/v1/video/aftersales/jobs' && allowSameOriginRequest(request)) {
        if (!gateDetection(request, response, requestId, { scene: 'video-aftersales', pathname })) return;
      }
      if(await videoApi.handle(request,response,pathname,requestId))return;
      if (pathname==='/api/v1/image/report' && request.method==='POST') {
        if (!allowSameOriginRequest(request)) return json(response,403,{error:{code:'ORIGIN_REJECTED',message:'不接受跨站请求'},requestId});
        if (enforceCredits && !currentUser(request)) return json(response,401,{error:{code:'AUTH_REQUIRED',message:'请先登录后导出报告。'},requestId});
        try {
          if(Number(request.headers['content-length'])>REPORT_BODY_LIMIT)throw Object.assign(new Error('报告请求超过大小限制'),{code:'UPLOAD_TOO_LARGE',status:413});
          const chunks=[];let size=0;
          for await(const chunk of request){size+=chunk.length;if(size>REPORT_BODY_LIMIT)throw Object.assign(new Error('报告请求超过大小限制'),{code:'UPLOAD_TOO_LARGE',status:413});chunks.push(chunk);}
          let body;
          try { body=JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return json(response,400,{error:{code:'BAD_JSON',message:'报告数据格式无效。'},requestId}); }
          if (!body || typeof body !== 'object') return json(response,400,{error:{code:'BAD_PAYLOAD',message:'报告数据格式无效。'},requestId});
          const format=body.format==='docx'?'docx':'pdf';
          const result=await renderStandardReport({scenario:body.scenario,payload:body.payload,format,generatedAt:body.generatedAt,reportNo:body.reportNo});
          const bytes=format==='docx'?result.docx:result.pdf;
          const filename=reportFilename(result.model,format);
          response.writeHead(200,{'Content-Type':format==='docx'?'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'application/pdf','Content-Length':String(bytes.length),'Content-Disposition':`attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,'Cache-Control':'no-store'});
          response.end(Buffer.from(bytes));
          return;
        } catch (error) {
          return json(response,error.status||500,{error:{code:error.code||'REPORT_FAILED',message:error.status && error.status < 500 ? error.message : '报告生成失败'},requestId});
        }
      }
      if (pathname==='/api/v1/health' && request.method==='GET') return json(response,200,{status:'ok',mode:process.env.NODE_ENV==='production'?'production':'development',businessImplemented:true,implementedScenarios:['text_news','text_novel','image_general','image_documents','image_refund','video_general','video_deepfake','video_aftersales'],services:{videoGeneral:{available:await detectorHealth(),api:'/api/v1/video/general'}}});
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
      const academicRoute = /^\/api\/v1\/(?:text\/(?:academic|humanize)(?:\/|$)|pdf\/|document\/|reports\/)/.test(pathname);
      if (proxyEnabled && academicRoute) {
        if (pathname==='/api/v1/text/academic' && request.method==='POST') {
          if (!gateDetection(request, response, requestId, { scene: 'text-academic', pathname })) return;
        }
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
          const videoUpload = feature.moduleId === 'video' && feature.id === 'general';
          const imageReview=feature.moduleId==='image'&&['general','documents'].includes(feature.id);
          if (videoUpload || (feature.moduleId === 'text' && feature.id === 'academic') || (feature.moduleId === 'audio' && feature.id === 'forgery')) {
            if (!gateDetection(request, response, requestId, { scene: `${feature.moduleId}-${feature.id}`, pathname })) return;
          }
          const payload = imageReview ? await readReviewRequest(request) : videoUpload ? await readScenarioPayload(request) : await readJsonBody(request,{maxBytes:textAnalysis ? 4*1024*1024 : 1024*1024});
          if ((textAnalysis || imageReview) && isBillableDetectionPayload(pathname, payload)) {
            if (!gateDetection(request, response, requestId, { scene: `${feature.moduleId}-${feature.id}`, pathname })) return;
          }
          const data = await scenarioServices[feature.moduleId](feature, payload, { requestId, modelClient:textModelClient, egteClient });
          return json(response,imageReview&&['detect','review'].includes(payload.action)?202:200,{data,requestId});
        } catch (error) {
          if (error.code === 'NOT_IMPLEMENTED') return json(response,501,{error:{code:error.code,message:error.message},requestId,endpoint:feature.api});
          if (error?.code && error?.status) return json(response,error.status,{error:{code:error.code,message:error.expose===false?'服务处理失败':error.message},requestId});
          return json(response,500,{error:{code:'INTERNAL_ERROR',message:'服务处理失败'},requestId});
        }
      }
      return json(response,404,{error:{code:'NOT_FOUND',message:'接口不存在'},requestId});
    }
    if (!['GET','HEAD'].includes(request.method)) return json(response,405,{error:{code:'METHOD_NOT_ALLOWED',message:'静态资源仅支持 GET / HEAD'},requestId},{Allow:'GET, HEAD'});
    if (!dist && pathname==='/public/vendor/fflate/browser.js') {
      const bytes=await readFile(new URL('../node_modules/fflate/esm/browser.js',import.meta.url));
      response.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store'});
      return response.end(request.method==='HEAD'?undefined:bytes);
    }
    if (pathname==='/docs/openapi.json') {
      if (request.method==='HEAD') { response.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});return response.end(); }
      return json(response,200,createOpenApi());
    }
    const relative = pathname==='/'?'index.html':pathname.slice(1);
    if (relative.split(/[\\/]/).some(part=>part==='..'||part==='.') || relative.includes('\0')) return json(response,404,{error:{code:'NOT_FOUND',message:'资源不存在'},requestId});
    const allowedStatic=relative==='index.html'||clientFiles.includes(relative)||['src/styles.css','src/portal.css'].includes(relative)||relative.startsWith('public/')||dist&&relative.startsWith('assets/');
    const target=path.resolve(base,relative);
    if (!allowedStatic || !target.startsWith(base+path.sep)) return json(response,404,{error:{code:'NOT_FOUND',message:'资源不存在'},requestId});
    try {
      const data=await readFile(target);
      // Hashed build output never changes under the same name; everything else, including index.html, stays uncached.
      const immutable=dist&&/^assets\/(?:chunks\/)?[^/]+-[A-Z0-9]{8,}\.(?:js|css)$/.test(relative);
      response.writeHead(200,{'Content-Type':mime[path.extname(target)]||'application/octet-stream','Cache-Control':immutable?'public, max-age=31536000, immutable':'no-store','X-Content-Type-Options':'nosniff'});
      response.end(request.method==='HEAD'?undefined:data);
    } catch { return json(response,404,{error:{code:'NOT_FOUND',message:'资源不存在'},requestId}); }
  });
  server.on('close',()=>{void refundApi.close();void videoApi.close();});
  return server;
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
  for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{server.close();server.closeIdleConnections();});
  server.listen(port,host,()=>{
    if (proxy) {
      console.log(`VERITAS preview: http://${host}:${port}\nAPI proxy → ${BACKEND_URL} (timeout ${PROXY_TIMEOUT_MS}ms)`);
    } else {
      console.log(`VERITAS preview: http://${host}:${port}\nMode: framework only / business endpoints return 501`);
    }
  });
}
