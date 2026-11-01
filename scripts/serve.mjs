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

export function createServer({dist=false,novelImporter=importNovelChapter,newsImporter=importNewsArticle,textModelClient,egteClient}={}) {
  const base = path.resolve(projectRoot,dist?'dist':'.');
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
      response.writeHead(200,{'Content-Type':mime[path.extname(target)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});
      response.end(request.method==='HEAD'?undefined:data);
    } catch { return json(response,404,{error:{code:'NOT_FOUND',message:'资源不存在'},requestId}); }
  });
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const port=Number(process.env.PORT||4173);
  const host=process.env.HOST||'127.0.0.1';
  const server=createServer({dist:process.argv.includes('--dist')});
  server.on('error',error=>{console.error(`无法启动服务：${error.message}`);process.exitCode=1;});
  server.listen(port,host,()=>console.log(`VERITAS preview: http://${host}:${port}\nMode: news proofreading and novel quality require server-side model configuration`));
}
