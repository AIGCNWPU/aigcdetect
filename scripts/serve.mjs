import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { modules, scenarios } from '../src/catalog.js';
import { createOpenApi } from './openapi.mjs';
import { scenarioServices } from '../src/server/registry.js';
import { readMultipartBody } from '../src/server/multipart.js';
import { detectorHealth } from '../src/server/detector.js';

const projectRoot=fileURLToPath(new URL('../',import.meta.url));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.json':'application/json; charset=utf-8'};
const json=(response,status,body,headers={})=>{response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers});response.end(JSON.stringify(body));};

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

export function createServer({dist=false}={}) {
  const base=path.resolve(projectRoot,dist?'dist':'.');
  return http.createServer(async (request,response)=>{
    const requestId=randomUUID();
    let pathname;
    try { pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname); } catch { return json(response,400,{error:{code:'BAD_URL',message:'无效地址'},requestId}); }
    if (pathname.startsWith('/api/')) {
      if (pathname==='/api/v1/health'&&request.method==='GET') {
        const videoGeneralAvailable=await detectorHealth();
        return json(response,200,{status:'ok',mode:videoGeneralAvailable?'business-partial':'scaffold',businessImplemented:videoGeneralAvailable,services:{videoGeneral:{available:videoGeneralAvailable,api:'/api/v1/video/general'}},requestId});
      }
      if (pathname==='/api/v1/catalog'&&request.method==='GET') return json(response,200,{data:modules,counts:{modules:modules.length,scenarios:scenarios.length},requestId});
      const feature=scenarios.find(item=>item.api.path===pathname);
      const allowed=feature?.api.method||(['/api/v1/health','/api/v1/catalog'].includes(pathname)?'GET':null);
      if (allowed&&request.method!==allowed) return json(response,405,{error:{code:'METHOD_NOT_ALLOWED',message:`请使用 ${allowed}`},requestId},{Allow:allowed});
      if (feature) {
        try {
          // 占位场景不读请求体，保持任何请求都得到明确的 501
          const payload=feature.api.implemented?await readScenarioPayload(request):undefined;
          const data=await scenarioServices[feature.moduleId](feature,payload,{requestId});
          return json(response,200,{data,requestId});
        } catch (error) {
          if (error.code==='NOT_IMPLEMENTED') return json(response,501,{error:{code:error.code,message:error.message},requestId,endpoint:feature.api});
          const status=Number.isInteger(error.status)&&error.status>=400&&error.status<600?error.status:500;
          if (status===500) console.error(`[api] ${feature.api.operationId} 失败:`,error);
          return json(response,status,{error:{code:error.code||'INTERNAL_ERROR',message:status===500?'服务处理失败':error.message},requestId});
        }
      }
      return json(response,404,{error:{code:'NOT_FOUND',message:'接口不存在'},requestId});
    }
    if (!['GET','HEAD'].includes(request.method)) return json(response,405,{error:{code:'METHOD_NOT_ALLOWED',message:'静态资源仅支持 GET / HEAD'},requestId},{Allow:'GET, HEAD'});
    if (pathname==='/docs/openapi.json') {
      if (request.method==='HEAD') { response.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});return response.end(); }
      return json(response,200,createOpenApi());
    }
    const relative=pathname==='/'?'index.html':pathname.slice(1);
    if (relative.split(/[\\/]/).some(part=>part==='..'||part==='.')||relative.includes('\0')) return json(response,404,{error:{code:'NOT_FOUND',message:'资源不存在'},requestId});
    const allowedStatic=relative==='index.html'||relative.startsWith('src/')||relative.startsWith('public/')||dist&&relative.startsWith('assets/');
    const target=path.resolve(base,relative);
    if (!allowedStatic||!target.startsWith(base+path.sep)) return json(response,404,{error:{code:'NOT_FOUND',message:'资源不存在'},requestId});
    try {
      const data=await readFile(target);
      response.writeHead(200,{'Content-Type':mime[path.extname(target)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});
      response.end(request.method==='HEAD'?undefined:data);
    } catch { return json(response,404,{error:{code:'NOT_FOUND',message:'资源不存在'},requestId}); }
  });
}
if (process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const port=Number(process.env.PORT||4173);
  const host=process.env.HOST||'127.0.0.1';
  const server=createServer({dist:process.argv.includes('--dist')});
  server.on('error',error=>{console.error(`无法启动服务：${error.message}`);process.exitCode=1;});
  server.listen(port,host,()=>console.log(`VERITAS preview: http://${host}:${port}\nMode: framework + video/general detection (needs VIDEO_GENERAL_SERVICE_URL)`));
}
