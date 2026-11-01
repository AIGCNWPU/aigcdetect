import { modules, scenarios } from '../src/catalog.js';

export function createOpenApi() {
  const paths={};
  const errorSchema={type:'object',required:['error','requestId'],properties:{error:{type:'object',required:['code','message'],properties:{code:{type:'string'},message:{type:'string'}}},requestId:{type:'string'}}};
  for(const module of modules) for(const scenario of module.scenarios){
    if(scenario.path==='/video/general') {
      const riskEnum={type:'string',enum:['low','medium','high','unknown']};
      paths[scenario.api.path]={post:{
        operationId:scenario.api.operationId,tags:[module.title],summary:scenario.title,
        description:`已接入业务实现：上传视频（multipart 字段 video，MP4/WebM，≤500MiB），由 Native-Scale 视觉伪造检测方法（Qwen2.5-ViT-448p 原生分辨率，ICLR 2026）判定AI生成风险，返回整片风险、可疑时间段、代表画面与检测范围；配置视觉复核服务后可为可疑片段补充画面解释。前端路由：#${scenario.path}。`,
        'x-implemented':true,'x-source-page':scenario.sourcePage,'x-page-route':scenario.path,
        requestBody:{required:true,content:{'multipart/form-data':{schema:{type:'object',required:['video'],properties:{video:{type:'string',format:'binary',description:'待检测视频文件'}}}}}},
        responses:{
          '200':{description:'检测完成。data 为前端契约结构。',content:{'application/json':{schema:{type:'object',properties:{data:{type:'object',required:['risk','summary','coverage','scope','duration','sampledFrames'],properties:{risk:riskEnum,summary:{type:'string'},coverage:{type:'string',enum:['full','partial']},scope:{type:'string'},duration:{type:'number'},sampledFrames:{type:'integer'},findings:{type:'array',items:{type:'string'}},segments:{type:'array',items:{type:'object',properties:{id:{type:'string'},start:{type:'number'},end:{type:'number'},risk:riskEnum,summary:{type:'string'},score:{type:'number'},explanation:{type:'string'},frameId:{type:'string'}}}},frames:{type:'array',items:{type:'object',properties:{id:{type:'string'},time:{type:'number'},risk:riskEnum,caption:{type:'string'},image:{type:'string'}}}}}},requestId:{type:'string'}}}}}},
          '400':{description:'请求校验失败（缺文件、格式不支持）。',content:{'application/json':{schema:{$ref:'#/components/schemas/Error'}}}},
          '413':{description:'视频超过 500 MiB。',content:{'application/json':{schema:{$ref:'#/components/schemas/Error'}}}},
          '502':{description:'推理服务处理失败。',content:{'application/json':{schema:{$ref:'#/components/schemas/Error'}}}},
          '503':{description:'推理服务未启动。',content:{'application/json':{schema:{$ref:'#/components/schemas/Error'}}}},
        },
      }};

      continue;
    }
    const implemented=scenario.api.implemented;
    const schemaName=scenario.id==='news'?'NewsAnalysisRequest':scenario.id==='novel'?'NovelAnalysisRequest':null;
    paths[scenario.api.path]={post:{
      operationId:scenario.api.operationId,tags:[module.title],summary:scenario.title,
      description:implemented?(scenario.id==='news'?'调用EGTE执行句级AI检测，并由大模型执行新闻三审三校；结果均附原文。':'调用EGTE执行句级AI检测，并由大模型执行小说重复与水稿检测；多章同次提交支持跨章完全重复对照。'):`场景入口占位，尚未实现业务。前端场景页面：#${scenario.path}。`,
      'x-implemented':implemented,'x-source-page':scenario.sourcePage,'x-page-route':scenario.path,
      requestBody:{required:true,content:{'application/json':{schema:schemaName?{$ref:`#/components/schemas/${schemaName}`}:{type:'object',description:'场景级请求预留；字段在实际业务实现阶段定义。',additionalProperties:true}}}},
      responses:implemented?{
        '200':{description:'返回通过服务端原文回查的真实模型分析结果及覆盖范围；内部证据拒绝计数不进入客户端响应。'},
        '400':{description:'请求字段或正文无效。',content:{'application/json':{schema:{$ref:'#/components/schemas/Error'}}}},
        '422':{description:'所选检测项尚未支持。',content:{'application/json':{schema:{$ref:'#/components/schemas/Error'}}}},
        '502':{description:'模型上游不可用或返回无效结构。',content:{'application/json':{schema:{$ref:'#/components/schemas/Error'}}}},
        '503':{description:'服务端模型配置缺失或无效。',content:{'application/json':{schema:{$ref:'#/components/schemas/Error'}}}},
      }:{'501':{description:'场景接口已预留，业务尚未实现。',content:{'application/json':{schema:{$ref:'#/components/schemas/Error'}}}}},
    }};
  }
  paths['/api/v1/text/novel/import']={post:{
    operationId:'text_novel_import',tags:['AI文本检测'],summary:'从公开章节网页导入小说正文',
    description:'仅获取公开可访问的单章节HTTP/HTTPS页面；不绕过登录、付费、验证码、WAF或动态字体混淆。与仍返回501的小说检测接口相互独立。',
    'x-implemented':true,'x-page-route':'/text/novel',
    requestBody:{required:true,content:{'application/json':{schema:{$ref:'#/components/schemas/NovelImportRequest'}}}},
    responses:{
      '200':{description:'返回可供用户预览和确认的公开正文。',content:{'application/json':{schema:{type:'object',required:['data','requestId'],properties:{data:{$ref:'#/components/schemas/NovelImportResult'},requestId:{type:'string'}}}}}},
      '400':{description:'链接或JSON无效。',content:{'application/json':{schema:{$ref:'#/components/schemas/Error'}}}},
      '403':{description:'目标不是公开网络地址。',content:{'application/json':{schema:{$ref:'#/components/schemas/Error'}}}},
      '422':{description:'页面受限、混淆或无法识别正文。',content:{'application/json':{schema:{$ref:'#/components/schemas/Error'}}}},
      '502':{description:'目标网站请求失败。',content:{'application/json':{schema:{$ref:'#/components/schemas/Error'}}}},
    },
  }};
  paths['/api/v1/text/news/import']={post:{
    operationId:'text_news_import',tags:['AI文本检测'],summary:'从公开新闻网页导入标题与正文',
    description:'仅获取公开可访问的单篇新闻HTTP/HTTPS页面；不绕过登录、付费、验证码、WAF或仅客户端渲染限制。与仍返回501的新闻检测接口相互独立。',
    'x-implemented':true,'x-page-route':'/text/news',
    requestBody:{required:true,content:{'application/json':{schema:{$ref:'#/components/schemas/NewsImportRequest'}}}},
    responses:{
      '200':{description:'返回可供用户预览和确认的公开新闻材料。',content:{'application/json':{schema:{type:'object',required:['data','requestId'],properties:{data:{$ref:'#/components/schemas/NewsImportResult'},requestId:{type:'string'}}}}}},
      '400':{description:'链接或JSON无效。',content:{'application/json':{schema:{$ref:'#/components/schemas/Error'}}}},
      '403':{description:'目标不是公开网络地址。',content:{'application/json':{schema:{$ref:'#/components/schemas/Error'}}}},
      '422':{description:'页面受限或无法识别正文。',content:{'application/json':{schema:{$ref:'#/components/schemas/Error'}}}},
      '502':{description:'目标网站请求失败。',content:{'application/json':{schema:{$ref:'#/components/schemas/Error'}}}},
    },
  }};
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
  const novelImportRequest={type:'object',additionalProperties:false,required:['url'],properties:{url:{type:'string',format:'uri',maxLength:2000}}};
  const novelImportResult={type:'object',required:['sourceUrl','finalUrl','site','workTitle','title','content','extractionStatus','completeness','notice'],properties:{sourceUrl:{type:'string',format:'uri'},finalUrl:{type:'string',format:'uri'},site:{type:'string',enum:['ciweimao','faloo','zongheng','generic']},workTitle:{type:'string',description:'从页面可靠线索提取的作品名称；无法确认时为空字符串。'},title:{type:'string'},content:{type:'string'},extractionStatus:{type:'string',enum:['completed','partial']},completeness:{type:'string',enum:['complete','partial','unknown']},notice:{type:'string'}}};
  const newsImportRequest={type:'object',additionalProperties:false,required:['url'],properties:{url:{type:'string',format:'uri',maxLength:2000}}};
  const newsImportResult={type:'object',required:['sourceUrl','finalUrl','siteName','title','author','publishedAt','content','extractionStatus','completeness','notice'],properties:{sourceUrl:{type:'string',format:'uri'},finalUrl:{type:'string',format:'uri'},siteName:{type:'string'},title:{type:'string'},author:{type:'string'},publishedAt:{type:'string'},content:{type:'string'},extractionStatus:{type:'string',enum:['completed','partial']},completeness:{type:'string',enum:['partial','unknown']},notice:{type:'string'}}};
  const aiSegment={type:'object',additionalProperties:false,required:['segmentId','sentenceIndex','sentenceIndexes','sentenceCount','merged','paragraphIndex','start','end','text'],properties:{segmentId:{type:'string'},sentenceIndex:{type:'integer',minimum:1},sentenceIndexes:{type:'array',minItems:1,maxItems:2,items:{type:'integer',minimum:1}},sentenceCount:{type:'integer',minimum:1,maximum:2},merged:{type:'boolean'},paragraphIndex:{type:'integer',minimum:1},start:{type:'integer',minimum:0},end:{type:'integer',minimum:1},text:{type:'string'}}};
  const newsAnalysisRequest={type:'object',required:['action','material','checks'],properties:{action:{const:'analyze'},material:{type:'object',required:['title','content'],properties:{title:{type:'string',maxLength:120},content:{type:'string',maxLength:50000},language:{type:'string',enum:['zh','en']},aiSegments:{type:'array',maxItems:10000,items:{$ref:'#/components/schemas/AiSentenceSegment'}},source:{type:'object'}}},checks:{type:'array',items:{type:'string',enum:['proofreading','ai-risk']}}}};
  const novelAnalysisRequest={type:'object',required:['action','work','chapters','checks'],properties:{action:{const:'analyze'},work:{type:'object',required:['title'],properties:{title:{type:'string',maxLength:120},language:{type:'string',enum:['zh','en']}}},chapters:{type:'array',minItems:1,maxItems:20,items:{type:'object',required:['localId','title','content'],properties:{localId:{type:'string'},title:{type:'string',maxLength:120},content:{type:'string',maxLength:100000},platform:{type:'string',enum:['ciweimao','faloo','zongheng','fanqie','qidian','unknown'],description:'章节发布平台；链接输入时由前端自动匹配，无法识别时使用unknown。'},language:{type:'string',enum:['zh','en']},aiSegments:{type:'array',maxItems:10000,items:{$ref:'#/components/schemas/AiSentenceSegment'}},source:{type:'object'}}}},checks:{type:'array',items:{type:'string',enum:['repetition','padding','ai-risk']}}}};
  return {openapi:'3.1.0',info:{title:'VERITAS 智鉴 · 场景接口',version:'2.1.0',description:'新闻与小说提供检测及审校；学术检测依赖独立后端；图片与视频售后支持当前材料临时分析。'},servers:[{url:'http://localhost:4173'}],tags:modules.map(module=>({name:module.title})),paths,components:{schemas:{Error:errorSchema,AiSentenceSegment:aiSegment,NewsAnalysisRequest:newsAnalysisRequest,NovelAnalysisRequest:novelAnalysisRequest,NewsImportRequest:newsImportRequest,NewsImportResult:newsImportResult,NovelImportRequest:novelImportRequest,NovelImportResult:novelImportResult}}};
}
