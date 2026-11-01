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
  return {openapi:'3.1.0',info:{title:'VERITAS 智鉴 · 场景接口',version:'1.2.0',description:'4 个模块、10 个检测场景占位接口，以及独立的新闻和小说网页导入接口。检测业务接口仍统一返回501。'},servers:[{url:'http://localhost:4173'}],tags:modules.map(module=>({name:module.title})),paths,components:{schemas:{Error:errorSchema,NewsImportRequest:newsImportRequest,NewsImportResult:newsImportResult,NovelImportRequest:novelImportRequest,NovelImportResult:novelImportResult}}};
}
