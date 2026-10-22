import { modules, scenarios } from '../src/catalog.js';

export function createOpenApi() {
  const paths={};
  const errorSchema={type:'object',required:['error','requestId'],properties:{error:{type:'object',required:['code','message'],properties:{code:{type:'string'},message:{type:'string'}}},requestId:{type:'string'}}};
  for(const module of modules) for(const scenario of module.scenarios){
    paths[scenario.api.path]={post:{
      operationId:scenario.api.operationId,tags:[module.title],summary:scenario.title,
      description:`场景入口占位，尚未实现业务。前端页面状态与接入边界见对应场景工作包：#${scenario.path}。`,
      'x-implemented':false,'x-source-page':scenario.sourcePage,'x-page-route':scenario.path,
      requestBody:{required:true,content:{'application/json':{schema:{type:'object',description:'场景级请求预留；字段在实际业务实现阶段定义。',additionalProperties:true},example:{}}}},
      responses:{'501':{description:'场景接口已预留，业务尚未实现。',content:{'application/json':{schema:{$ref:'#/components/schemas/Error'}}}}},
    }};
  }
  paths['/api/v1/health']={get:{operationId:'health',summary:'框架健康检查',responses:{'200':{description:'框架服务正在运行；业务尚未接入。'}}}};
  paths['/api/v1/catalog']={get:{operationId:'catalog',summary:'获取模块与场景配置',responses:{'200':{description:`返回 ${modules.length} 个模块、${scenarios.length} 个场景。`}}}};
  return {openapi:'3.1.0',info:{title:'VERITAS 智鉴 · 场景接口预留',version:'1.0.0',description:'4 个模块与 10 个场景。业务接口当前统一返回 501，真实算法、任务与存储待接入。'},servers:[{url:'http://localhost:4173'}],tags:modules.map(module=>({name:module.title})),paths,components:{schemas:{Error:errorSchema}}};
}
