# 接口使用约定

场景和方法由 `src/modules/*/definition.js` 定义，经 `src/catalog.js` 聚合。OpenAPI运行时地址 `/docs/openapi.json`，快照为本目录 `openapi.json`。

- 框架接口：`GET /api/v1/health`、`GET /api/v1/catalog`。
- 检测业务接口：10个 `POST /api/v1/<模块>/<场景>`，当前均返回 `501 NOT_IMPLEMENTED`，没有真实算法、任务或存储。
- 新闻链接导入：`POST /api/v1/text/news/import`，请求为`{"url":"https://..."}`。成功结果包含来源、站点、标题、作者、发布时间、正文、提取状态、完整性状态和提示。
- 小说章节导入：`POST /api/v1/text/novel/import`，请求为`{"url":"https://..."}`。该接口独立于检测服务，后端只获取公开HTTP/HTTPS单章节页；成功结果包含来源、最终地址、站点、标题、正文、提取状态、完整性状态和提示。
- 未知接口404，已知接口错误方法405。错误含 `error.code`、`error.message` 和 `requestId`。
- 检测请求参数仍是扩展JSON对象占位，HTTP层不解析检测请求体。新闻和小说导入接口已实现JSON校验、16 KiB请求上限、公网目标与逐跳重定向校验、10秒等待时间及2 MiB响应上限；真实检测业务接入时仍须补充检测请求校验、身份权限、结果类型和测试。
- `src/api.js` 负责统一调用和非2xx错误；成功响应若采用`{data, requestId}`信封，`api.invoke`会向页面返回其中的`data`业务对象。跨域认证、文件上传、异步状态和导出协议待正式设计。
- 模型和存储密钥仅放后端；GitHub工作流和前端不得包含生产凭据。

页面接入示例见[接入说明](接入说明.md)，每个场景的完整需求见对应OpenSpec工作包。

新闻导入优先读取JSON-LD `NewsArticle`/`Article`、Open Graph信息和语义正文容器，并已适配新华网、央视网、中新网、凤凰网和澎湃新闻当前公开单篇图文页面的正文容器。`extractionStatus`为`completed`或`partial`，`completeness`为`partial`或`unknown`；站点模板变化、视频/直播/专题页、登录验证或仅客户端渲染页面仍可能无法提取，不保证适配所有新闻网站。

章节导入成功结果使用`workTitle`表示作品名称、`title`表示章节标题；无法可靠识别作品名称时`workTitle`为空字符串。`extractionStatus`为`completed`或`partial`，`completeness`为`complete`、`partial`或`unknown`。无可读正文时返回结构化非2xx错误及`details`，不得创建空章节。当前成功适配刺猬猫公开MIP/WAP单章节页、飞卢公开免费章节页、纵横公开免费章节页和结构清晰的公开HTML正文页；目录页返回`DIRECTORY_PAGE`，起点WAF、番茄动态字体及登录/付费页会返回对应限制原因。
