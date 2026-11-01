import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { modules, scenarios } from '../src/catalog.js';
import { createOpenApi } from './openapi.mjs';
import { scenarioServices } from '../src/server/registry.js';
import { createRefundApi } from '../src/modules/image/refund/server/api.js';
import { createVideoApi } from '../src/modules/video/aftersales/server/api.js';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const mime = {'.mp4':'video/mp4','.webm':'video/webm','.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'};
const json = (response, status, body, headers={}) => {response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers});response.end(JSON.stringify(body));};

export function createServer({dist=false,refundOptions,videoOptions}={}) {
  const base = path.resolve(projectRoot,dist?'dist':'.');
  const refundApi=createRefundApi(refundOptions);
  const videoApi=createVideoApi(videoOptions);
  const server=http.createServer(async (request,response)=>{
    const requestId = randomUUID();
    let pathname;
    try { pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname); } catch { return json(response,400,{error:{code:'BAD_URL',message:'无效地址'},requestId}); }
    if (pathname.startsWith('/api/')) {
      if(await refundApi.handle(request,response,pathname,requestId))return;
      if(await videoApi.handle(request,response,pathname,requestId))return;
      if (pathname==='/api/v1/health' && request.method==='GET') return json(response,200,{status:'ok',mode:'current-media-analysis',businessImplemented:true,implementedScenarios:['/image/refund','/video/aftersales']});
      if (pathname==='/api/v1/catalog' && request.method==='GET') return json(response,200,{data:modules,counts:{modules:modules.length,scenarios:scenarios.length},requestId});
      const feature=scenarios.find(item=>item.api.path===pathname);
      const allowed=feature?.api.method || (['/api/v1/health','/api/v1/catalog'].includes(pathname)?'GET':null);
      if (allowed && request.method!==allowed) return json(response,405,{error:{code:'METHOD_NOT_ALLOWED',message:`请使用 ${allowed}`},requestId},{Allow:allowed});
      if (feature) {
        try {
          const data = await scenarioServices[feature.moduleId](feature, undefined, { requestId });
          return json(response,200,{data,requestId});
        } catch (error) {
          if (error.code === 'NOT_IMPLEMENTED') return json(response,501,{error:{code:error.code,message:error.message},requestId,endpoint:feature.api});
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
  server.on('close',()=>{void refundApi.close();void videoApi.close();});
  return server;
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const port=Number(process.env.PORT||4173);
  const host=process.env.HOST||'127.0.0.1';
  const server=createServer({dist:process.argv.includes('--dist')});
  server.on('error',error=>{console.error(`无法启动服务：${error.message}`);process.exitCode=1;});
  for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{server.close();server.closeIdleConnections();});
  server.listen(port,host,()=>console.log(`VERITAS preview: http://${host}:${port}\nMode: current image/video analysis; no historical case storage`));
}
