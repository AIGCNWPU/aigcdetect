import { modules, scenarios } from '../src/catalog.js';

export function createOpenApi() {
  const paths={};
  const errorSchema={type:'object',required:['error','requestId'],properties:{error:{type:'object',required:['code','message'],properties:{code:{type:'string'},message:{type:'string'}}},requestId:{type:'string'}}};
  for(const module of modules) for(const scenario of module.scenarios){
    paths[scenario.api.path]={post:{
      operationId:scenario.api.operationId,tags:[module.title],summary:scenario.title,
      description:`场景入口占位，尚未实现业务。前端场景页面保持空白：#${scenario.path}。`,
      'x-implemented':false,'x-source-page':scenario.sourcePage,'x-page-route':scenario.path,
      requestBody:{required:true,content:{'application/json':{schema:{type:'object',description:'场景级请求预留；字段在实际业务实现阶段定义。',additionalProperties:true},example:{}}}},
      responses:{'501':{description:'场景接口已预留，业务尚未实现。',content:{'application/json':{schema:{$ref:'#/components/schemas/Error'}}}}},
    }};
  }
  paths['/api/v1/health']={get:{operationId:'health',summary:'框架健康检查',responses:{'200':{description:'框架服务正在运行；业务尚未接入。'}}}};
  paths['/api/v1/catalog']={get:{operationId:'catalog',summary:'获取模块与场景配置',responses:{'200':{description:`返回 ${modules.length} 个模块、${scenarios.length} 个场景。`}}}};
  const root='/api/v1/image/refund';
  const operation=(id,summary,parameters=[])=>({operationId:id,tags:['AI图片检测'],summary,parameters,responses:{'200':{description:'当前内存会话的实际处理结果。'},'400':{description:'输入无效。'},'403':{description:'请求不是来自本机页面。'},'404':{description:'会话或任务不存在、已关闭或已过期。'},'409':{description:'会话已关闭或材料关联不一致。'},'413':{description:'材料超出大小限制。'},'503':{description:'检测能力未配置或临时空间不可用。'}}});
  const parameter=name=>({name,in:'path',required:true,schema:{type:'string'}});
  const fields=['caseNumber','productName','style','productInfo','description'];
  const sessionSchema={type:'object',required:['id','fields','files'],properties:{id:{type:'string',pattern:'^c_[a-f0-9]{24}$',description:'每次材料版本的随机临时会话编号。'},fields:{type:'object',required:fields,properties:Object.fromEntries(fields.map(name=>[name,{type:'string'}]))},files:{type:'array',minItems:1,maxItems:10,items:{type:'object',required:['name','type','data'],properties:{name:{type:'string'},type:{enum:['image/jpeg','image/png','image/webp']},data:{type:'string',contentEncoding:'base64',description:'原始图片字节，单张不超过5 MiB；仅用于当前分析。'}}}}}};
  const create={...operation('image_refund','准备当前分析材料'), 'x-implemented':true,'x-page-route':'/image/refund','x-source-page':7,requestBody:{required:true,content:{'application/json':{schema:sessionSchema}}}};
  paths[root]={post:create};
  paths[root+'/sessions']={post:{...create,operationId:'image_refund_create_session'}};
  paths[root+'/sessions/{sessionId}/close']={post:operation('image_refund_close_session','取消当前任务并释放临时材料与结果',[parameter('sessionId')])};
  paths[root+'/status']={get:operation('image_refund_status','当前检测能力，不返回内部算法与密钥')};
  paths[root+'/status'].get.responses['200'].content={'application/json':{schema:{type:'object',required:['version','storage','capabilities'],properties:{version:{const:2},storage:{const:'memory'},capabilities:{type:'object',properties:{ai:{type:'boolean'},comparison:{type:'boolean'},tamper:{type:'boolean'}}}}}}};
  paths[root+'/jobs']={post:{...operation('image_refund_job','创建当前会话的单图检测任务'),requestBody:{required:true,content:{'application/json':{schema:{type:'object',required:['sessionId','imageId','kind'],properties:{id:{type:'string'},sessionId:{type:'string'},imageId:{type:'string'},kind:{enum:['ai','tamper','comparison']}}}}}},responses:{'202':{description:'任务已创建，仅在当前会话内查询结果。'},'400':{description:'输入无效。'},'404':{description:'当前材料会话已结束。'},'503':{description:'检测能力未配置。'}}}};
  paths[root+'/jobs/{jobId}']={get:operation('image_refund_job_status','查询 queued/running/succeeded/failed/cancelled 状态',[parameter('jobId')])};
  paths[root+'/jobs/{jobId}/cancel']={post:operation('image_refund_job_cancel','取消任务并丢弃迟到结果',[parameter('jobId')])};
  const videoRoot='/api/v1/video/aftersales';
  const videoOperation=(id,summary,parameters=[])=>({...operation(id,summary,parameters),tags:['AI视频检测'],responses:{'200':{description:'当前视频材料或分析结果。'},'202':{description:'任务已排队。'},'400':{description:'输入无效。'},'403':{description:'仅允许本机页面。'},'409':{description:'视频未上传或版本关联不一致。'},'410':{description:'当前会话已清理。'},'422':{description:'视频解码或元数据验证失败。'},'429':{description:'超过并发、空间或任务上限。'},'503':{description:'模型服务未就绪。'}}});
  const videoSchema={type:'object',required:['fields','videos'],properties:{id:{type:'string',pattern:'^v_[a-f0-9-]{36}$'},fields:sessionSchema.properties.fields,videos:{type:'array',minItems:1,maxItems:5,items:{type:'object',required:['id','version','type','size','duration','width','height'],properties:{id:{type:'string'},version:{type:'integer',minimum:0},type:{enum:['video/mp4','video/webm']},size:{type:'integer',minimum:1,maximum:209715200},duration:{type:'number',exclusiveMinimum:0,maximum:600},width:{type:'integer',minimum:1,maximum:4096},height:{type:'integer',minimum:1,maximum:4096}}}}}};
  const videoCreate={...videoOperation('video_aftersales','准备当前视频分析的临时会话'),'x-implemented':true,'x-page-route':'/video/aftersales','x-source-page':11,requestBody:{required:true,content:{'application/json':{schema:videoSchema}}}};
  paths[videoRoot]={post:videoCreate};
  paths[videoRoot+'/sessions']={post:{...videoCreate,operationId:'video_aftersales_create_session'}};
  paths[videoRoot+'/status']={get:videoOperation('video_aftersales_status','获取商品视频来源与资料核对能力')};
  paths[videoRoot+'/sessions/{sessionId}/videos/{videoId}']={put:{...videoOperation('video_aftersales_upload','上传原视频二进制并校验格式、尺寸、时长与摘要',[parameter('sessionId'),parameter('videoId')]),requestBody:{required:true,content:{'video/mp4':{schema:{type:'string',format:'binary'}},'video/webm':{schema:{type:'string',format:'binary'}}}}}};
  paths[videoRoot+'/sessions/{sessionId}/close']={post:videoOperation('video_aftersales_close_session','取消任务并清理本次临时视频',[parameter('sessionId')])};
  paths[videoRoot+'/jobs']={post:{...videoOperation('video_aftersales_job','创建单视频分析任务'),requestBody:{required:true,content:{'application/json':{schema:{type:'object',required:['sessionId','videoId','version','kind'],properties:{id:{type:'string'},sessionId:{type:'string'},videoId:{type:'string'},version:{type:'integer'},kind:{enum:['ai','tamper','comparison'],description:'tamper 保留为商品视频修改线索字段，当前未接入；不提供人脸检测。'}}}}}}}};
  paths[videoRoot+'/jobs/{jobId}']={get:videoOperation('video_aftersales_job_status','查询当前任务及经过验证的采样位置',[parameter('jobId')])};
  paths[videoRoot+'/jobs/{jobId}/cancel']={post:videoOperation('video_aftersales_job_cancel','取消任务并丢弃迟到结果',[parameter('jobId')])};
  paths['/api/v1/health'].get.responses['200'].description='本机服务状态；图片和视频售后只处理当前材料，不提供历史记录。';
  for(const [pathname,item] of Object.entries(paths)){
    if(!pathname.startsWith(root) && !pathname.startsWith(videoRoot))continue;
    const methods=Object.keys(item).filter(method=>['get','post','put'].includes(method));
    for(const method of methods)item[method].responses['405']={description:'已知接口的请求方法不正确。',headers:{Allow:{description:'该路由接受的请求方法。',schema:{type:'string',enum:[methods.map(value=>value.toUpperCase()).join(', ')]}}},content:{'application/json':{schema:{$ref:'#/components/schemas/Error'}}}};
  }
  return {openapi:'3.1.0',info:{title:'VERITAS 智鉴 · 场景接口',version:'2.1.0',description:'图片与视频售后提供当前材料的临时分析会话；图片结果可导出PDF。无历史记录接口，其余八个场景保留501。'},servers:[{url:'http://localhost:4173'}],tags:modules.map(module=>({name:module.title})),paths,components:{schemas:{Error:errorSchema}}};
}
