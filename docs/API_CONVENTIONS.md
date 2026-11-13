# 接口使用约定

场景和方法由 `src/modules/*/definition.js` 定义，经 `src/catalog.js` 聚合。OpenAPI运行时地址 `/docs/openapi.json`，快照为本目录 `openapi.json`。

- 框架接口：`GET /api/v1/health`、`GET /api/v1/catalog`。
- 检测业务接口：新闻与小说均已接入EGTE句级AI检测；新闻另接入三审三校，小说另接入重复/水稿检测；其余场景仍返回`501 NOT_IMPLEMENTED`。
- 新闻链接导入：`POST /api/v1/text/news/import`，请求为`{"url":"https://..."}`。成功结果包含来源、站点、标题、作者、发布时间、正文、提取状态、完整性状态和提示。
- 小说章节导入：`POST /api/v1/text/novel/import`，请求为`{"url":"https://..."}`。该接口独立于检测服务，后端只获取公开HTTP/HTTPS单章节页；成功结果包含来源、最终地址、站点、标题、正文、提取状态、完整性状态和提示。
- 未知接口404，已知接口错误方法405。错误含 `error.code`、`error.message` 和 `requestId`。
- 新闻和小说检测请求使用不超过4 MiB的JSON请求体并校验正文、检测项和长度（完整正文与句级片段会同时传输以供防篡改核对）。选择`ai-risk`时，前端提交按原文顺序排列的`aiSegments`，每项含`segmentId`、`sentenceIndex`、`sentenceIndexes`、`sentenceCount`、`merged`、`paragraphIndex`、`paragraphIndexes`、`start`、`end`和`text`；单片段包含一至两句，20至29字符的短句优先与同段相邻句合并，小说可合并相邻且各自仅含一句的短段，片段不超过100字符。超过100字符的长句优先按软标点切分且每段不少于20字符。后端使用同一规则重新分句并校验UTF-16区间、连续编号、完整覆盖、段落关系及原文一致性。结果按评分片段返回分类器、状态、AI类得分和判断。三审三校及水稿结果另携带内容哈希、覆盖范围、原始段落ID、字符位置和问题原文。导入接口维持16 KiB请求上限、公网目标与逐跳重定向校验、10秒等待时间及2 MiB响应上限。
- `src/api.js` 负责统一调用和非2xx错误；成功响应若采用`{data, requestId}`信封，`api.invoke`会向页面返回其中的`data`业务对象。跨域认证、文件上传、异步状态和导出协议待正式设计。
- 模型和存储密钥仅放后端；GitHub工作流和前端不得包含生产凭据。
- 默认模型供应商为DeepSeek。设置`TEXT_MODEL_PROVIDER=deepseek`和服务端`TEXT_MODEL_API_KEY`后，使用官方Chat Completions端点、`deepseek-v4-pro`、JSON Output和`high`推理强度；端点、模型、推理强度、输出上限与超时均可由服务端环境覆盖。错误响应不包含授权头、密钥、上游响应正文或模型端点。
- 本地开发由服务端自动加载项目根目录`.env`，仅接受`TEXT_MODEL_*`和`EGTE_*`字段；进程或部署平台已经存在的环境变量不会被本地文件覆盖。`.env`由Git忽略，仓库只保留空Key的`.env.example`。
- EGTE由Node服务端通过`EGTE_API_URL`调用独立HTTP算法服务，当前服务器默认地址为`http://127.0.0.1:8012/api/v1/infer/batch`。8012接口使用`POST`提交`classifier`与`texts`并按顺序返回结果；客户端依据接口上限自动拆为每批最多200条（可用`EGTE_BATCH_SIZE`调低）并保持原片段顺序。旧式接口仍兼容`classifier`与`segments`。中文选择`cred`，英文选择`raid`。新闻和小说仅对算法输入副本执行NFKC、空白与危险不可见字符归一化，使其成为稳定的Markdown兼容纯文本，展示原文及位置不变。8012批量端点返回413、422或500时，客户端在`EGTE_ISOLATION_MAX_REQUESTS`（默认64）预算内二分定位异常片段，单个异常片段标记为无法评分并继续其余评分；全部片段持续500、400契约错误、连接失败、超时、鉴权、限流、502/503/504、无效JSON、结果数量不一致或预算耗尽仍统一转换为`AI_DETECTOR_UNAVAILABLE`。非回环HTTP地址会被拒绝，远程地址必须使用HTTPS，且不会向客户端回显端点、密钥或上游响应正文。`aiScore`可乘100展示百分比，但它是未校准AI类得分，不得表述为AI几率或确定概率。
- 小说跨章比较目前只覆盖同一次请求中的多个章节；单章请求不会被描述为具备跨章记忆。

页面接入示例见[接入说明](接入说明.md)，每个场景的完整需求见对应OpenSpec工作包。

新闻导入优先读取JSON-LD `NewsArticle`/`Article`、Open Graph信息和语义正文容器，并已适配新华网、央视网、中新网、凤凰网和澎湃新闻当前公开单篇图文页面的正文容器。`extractionStatus`为`completed`或`partial`，`completeness`为`partial`或`unknown`；站点模板变化、视频/直播/专题页、登录验证或仅客户端渲染页面仍可能无法提取，不保证适配所有新闻网站。

章节导入成功结果使用`workTitle`表示作品名称、`title`表示章节标题；无法可靠识别作品名称时`workTitle`为空字符串。`extractionStatus`为`completed`或`partial`，`completeness`为`complete`、`partial`或`unknown`。无可读正文时返回结构化非2xx错误及`details`，不得创建空章节。当前成功适配刺猬猫公开MIP/WAP单章节页、飞卢公开免费章节页、纵横公开免费章节页和结构清晰的公开HTML正文页；目录页返回`DIRECTORY_PAGE`，起点WAF、番茄动态字体及登录/付费页会返回对应限制原因。

新闻三审三校的`proofreading`与小说重复/水稿的`quality`只向客户端返回通过服务端原文回查的问题。无法回指原文的模型结果被丢弃，并以`text_model_evidence_rejected`事件在服务端记录请求号、场景和接收/通过/拒绝数量；日志不记录模型原文、稿件内容、密钥或授权信息，客户端响应与摘要也不包含内部拒绝计数或校验说明。模型虽返回合法JSON但缺少`findings`数组时仍返回`MODEL_RESPONSE_INVALID`，不得降级为空结果。

人物换脸检测通过 multipart 上传，服务限制与健康检查见 [VLAForge 服务说明](../services/video-deepfake/README.md)。
