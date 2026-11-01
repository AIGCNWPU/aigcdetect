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
  paths['/api/v1/video/deepfake'].post = {
    operationId:'video_deepfake', tags:['AI视频检测'], summary:'本地智鉴换脸检测试运行',
    description:'同步推理（GPU可用时自动使用，否则CPU），最多120秒/100MiB；稀疏采样、简易人物轨迹、风险阈值未校准；不提供持久化、鉴权和真实任务进度。',
    'x-implemented':true,'x-source-page':10,'x-page-route':'/video/deepfake',
    requestBody:{required:true,content:{'multipart/form-data':{schema:{type:'object',required:['video'],properties:{video:{type:'string',format:'binary'}}}}}},
    responses:{'200':{description:'data包含risk、aiProbability、summary、coverage、scope、duration、sampledFrames、faceFrames、persons；详细字段见video/contracts.d.ts。'},
      ...Object.fromEntries([400,413,422,429,503].map(status=>[status,{description:{400:'上传格式无效',413:'文件过大',422:'材料不可解码或超时长',429:'服务正在处理其他任务',503:'模型服务未就绪或请求中断'}[status],content:{'application/json':{schema:{$ref:'#/components/schemas/Error'}}}}]))},
  };
  paths['/api/v1/video/deepfake/health']={get:{operationId:'video_deepfake_health',summary:'检查智鉴模型就绪状态',responses:{'200':{description:'ready、model、device、parameters及requestId'},'503':{description:'模型服务不可用'}}}};
  paths['/api/v1/health']={get:{operationId:'health',summary:'框架健康检查',responses:{'200':{description:'框架服务正在运行；业务尚未接入。'}}}};
  paths['/api/v1/catalog']={get:{operationId:'catalog',summary:'获取模块与场景配置',responses:{'200':{description:`返回 ${modules.length} 个模块、${scenarios.length} 个场景。`}}}};
  return {openapi:'3.1.0',info:{title:'VERITAS 智鉴 · 场景接口预留',version:'1.0.0',description:'4 个模块与10个场景；3.2接入本地智鉴实验服务，其余业务接口为501占位。'},servers:[{url:'http://localhost:4173'}],tags:modules.map(module=>({name:module.title})),paths,components:{schemas:{Error:errorSchema}}};
}
