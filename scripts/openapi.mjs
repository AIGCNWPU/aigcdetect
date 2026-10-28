import { modules, scenarios } from '../src/catalog.js';

export function createOpenApi() {
  const paths={};
  const errorSchema={type:'object',required:['error','requestId'],properties:{error:{type:'object',required:['code','message'],properties:{code:{type:'string'},message:{type:'string'}}},requestId:{type:'string'}}};
  const riskEnum={type:'string',enum:['low','medium','high','unknown']};
  for(const module of modules) for(const scenario of module.scenarios){
    if(scenario.api.implemented){
      paths[scenario.api.path]={post:{
        operationId:scenario.api.operationId,tags:[module.title],summary:scenario.title,
        description:`已接入业务实现：上传视频（multipart 字段 video，MP4/WebM，≤500MiB），由 Native-Scale 视觉伪造检测方法（Qwen2.5-ViT-448p 原生分辨率，ICLR 2026）判定AI生成风险，返回整片风险、可疑时间段、代表画面与检测范围。前端路由：#${scenario.path}。`,
        'x-implemented':true,'x-source-page':scenario.sourcePage,'x-page-route':scenario.path,
        requestBody:{required:true,content:{'multipart/form-data':{schema:{type:'object',required:['video'],properties:{video:{type:'string',format:'binary',description:'待检测视频文件'}}}}}},
        responses:{
          '200':{description:'检测完成。data 为前端契约结构。',content:{'application/json':{schema:{type:'object',properties:{data:{type:'object',required:['risk','summary','coverage','scope','duration','sampledFrames'],properties:{risk:riskEnum,summary:{type:'string'},coverage:{type:'string',enum:['full','partial']},scope:{type:'string'},duration:{type:'number'},sampledFrames:{type:'integer'},findings:{type:'array',items:{type:'string'}},segments:{type:'array',items:{type:'object',properties:{id:{type:'string'},start:{type:'number'},end:{type:'number'},risk:riskEnum,summary:{type:'string'},frameId:{type:'string'}}}},frames:{type:'array',items:{type:'object',properties:{id:{type:'string'},time:{type:'number'},risk:riskEnum,caption:{type:'string'},image:{type:'string'}}}}}},requestId:{type:'string'}}}}}},
          '400':{description:'请求校验失败（缺文件、格式不支持）。',content:{'application/json':{schema:{$ref:'#/components/schemas/Error'}}}},
          '413':{description:'视频超过 500 MiB。',content:{'application/json':{schema:{$ref:'#/components/schemas/Error'}}}},
          '502':{description:'推理服务处理失败。',content:{'application/json':{schema:{$ref:'#/components/schemas/Error'}}}},
          '503':{description:'推理服务未启动。',content:{'application/json':{schema:{$ref:'#/components/schemas/Error'}}}},
        },
      }};
      continue;
    }
    paths[scenario.api.path]={post:{
      operationId:scenario.api.operationId,tags:[module.title],summary:scenario.title,
      description:`场景入口占位，尚未实现业务。前端场景页面保持空白：#${scenario.path}。`,
      'x-implemented':false,'x-source-page':scenario.sourcePage,'x-page-route':scenario.path,
      requestBody:{required:true,content:{'application/json':{schema:{type:'object',description:'场景级请求预留；字段在实际业务实现阶段定义。',additionalProperties:true},example:{}}}},
      responses:{'501':{description:'场景接口已预留，业务尚未实现。',content:{'application/json':{schema:{$ref:'#/components/schemas/Error'}}}}},
    }};
  }
  paths['/api/v1/health']={get:{operationId:'health',summary:'框架健康检查',responses:{'200':{description:'框架服务运行状态；services.videoGeneral.available 表示通用视频检测推理服务是否就绪。'}}}};
  paths['/api/v1/catalog']={get:{operationId:'catalog',summary:'获取模块与场景配置',responses:{'200':{description:`返回 ${modules.length} 个模块、${scenarios.length} 个场景。`}}}};
  const implemented=scenarios.filter(scenario=>scenario.api.implemented).length;
  return {openapi:'3.1.0',info:{title:'VERITAS 智鉴 · 场景接口',version:'1.1.0',description:`4 个模块与 10 个业务场景。已实现业务 ${implemented} 个：3.1 通用AI生成视频检测（Native-Scale）；其余场景接口返回 501。`},servers:[{url:'http://localhost:4173'}],tags:modules.map(module=>({name:module.title})),paths,components:{schemas:{Error:errorSchema}}};
}
