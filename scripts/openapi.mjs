import { modules, scenarios } from '../src/catalog.js';

export function createOpenApi() {
  const paths={};
  const errorSchema={type:'object',required:['error','requestId'],properties:{error:{type:'object',required:['code','message'],properties:{code:{type:'string'},message:{type:'string'}}},requestId:{type:'string'}}};
  for(const module of modules) for(const scenario of module.scenarios){
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
  const novelImportRequest={type:'object',additionalProperties:false,required:['url'],properties:{url:{type:'string',format:'uri',maxLength:2000}}};
  const novelImportResult={type:'object',required:['sourceUrl','finalUrl','site','workTitle','title','content','extractionStatus','completeness','notice'],properties:{sourceUrl:{type:'string',format:'uri'},finalUrl:{type:'string',format:'uri'},site:{type:'string',enum:['ciweimao','faloo','zongheng','generic']},workTitle:{type:'string',description:'从页面可靠线索提取的作品名称；无法确认时为空字符串。'},title:{type:'string'},content:{type:'string'},extractionStatus:{type:'string',enum:['completed','partial']},completeness:{type:'string',enum:['complete','partial','unknown']},notice:{type:'string'}}};
  const newsImportRequest={type:'object',additionalProperties:false,required:['url'],properties:{url:{type:'string',format:'uri',maxLength:2000}}};
  const newsImportResult={type:'object',required:['sourceUrl','finalUrl','siteName','title','author','publishedAt','content','extractionStatus','completeness','notice'],properties:{sourceUrl:{type:'string',format:'uri'},finalUrl:{type:'string',format:'uri'},siteName:{type:'string'},title:{type:'string'},author:{type:'string'},publishedAt:{type:'string'},content:{type:'string'},extractionStatus:{type:'string',enum:['completed','partial']},completeness:{type:'string',enum:['partial','unknown']},notice:{type:'string'}}};
  const aiSegment={type:'object',additionalProperties:false,required:['segmentId','sentenceIndex','sentenceIndexes','sentenceCount','merged','paragraphIndex','start','end','text'],properties:{segmentId:{type:'string'},sentenceIndex:{type:'integer',minimum:1},sentenceIndexes:{type:'array',minItems:1,maxItems:2,items:{type:'integer',minimum:1}},sentenceCount:{type:'integer',minimum:1,maximum:2},merged:{type:'boolean'},paragraphIndex:{type:'integer',minimum:1},start:{type:'integer',minimum:0},end:{type:'integer',minimum:1},text:{type:'string'}}};
  const newsAnalysisRequest={type:'object',required:['action','material','checks'],properties:{action:{const:'analyze'},material:{type:'object',required:['title','content'],properties:{title:{type:'string',maxLength:120},content:{type:'string',maxLength:50000},language:{type:'string',enum:['zh','en']},aiSegments:{type:'array',maxItems:10000,items:{$ref:'#/components/schemas/AiSentenceSegment'}},source:{type:'object'}}},checks:{type:'array',items:{type:'string',enum:['proofreading','ai-risk']}}}};
  const novelAnalysisRequest={type:'object',required:['action','work','chapters','checks'],properties:{action:{const:'analyze'},work:{type:'object',required:['title'],properties:{title:{type:'string',maxLength:120},language:{type:'string',enum:['zh','en']}}},chapters:{type:'array',minItems:1,maxItems:20,items:{type:'object',required:['localId','title','content'],properties:{localId:{type:'string'},title:{type:'string',maxLength:120},content:{type:'string',maxLength:100000},language:{type:'string',enum:['zh','en']},aiSegments:{type:'array',maxItems:10000,items:{$ref:'#/components/schemas/AiSentenceSegment'}},source:{type:'object'}}}},checks:{type:'array',items:{type:'string',enum:['repetition','padding','ai-risk']}}}};
  return {openapi:'3.1.0',info:{title:'VERITAS 智鉴 · 场景接口',version:'1.4.2',description:'新闻与小说已接入EGTE句级AI检测；新闻三审三校和小说重复/水稿检测由服务端模型适配层执行。'},servers:[{url:'http://localhost:4173'}],tags:modules.map(module=>({name:module.title})),paths,components:{schemas:{Error:errorSchema,AiSentenceSegment:aiSegment,NewsAnalysisRequest:newsAnalysisRequest,NovelAnalysisRequest:novelAnalysisRequest,NewsImportRequest:newsImportRequest,NewsImportResult:newsImportResult,NovelImportRequest:novelImportRequest,NovelImportResult:novelImportResult}}};
}
