# 接口使用约定

场景和方法由 `src/modules/*/definition.js` 定义，经 `src/catalog.js` 聚合。OpenAPI运行时地址 `/docs/openapi.json`，快照为本目录 `openapi.json`。

- 框架接口：`GET /api/v1/health`、`GET /api/v1/catalog`。
- 业务接口：10个 `POST /api/v1/<模块>/<场景>`，当前均返回 `501 NOT_IMPLEMENTED`，没有真实算法、任务或存储。
- 未知接口404，已知接口错误方法405。错误含 `error.code`、`error.message` 和 `requestId`。
- 请求参数当前是扩展JSON对象占位；HTTP层尚未读取业务请求体。真实业务接入时必须在同一PR补充请求校验、大小限制、身份权限、结果类型和测试，并更新OpenAPI及调用方。
- `src/api.js` 负责统一调用和非2xx错误；页面当前不会自动调用它。跨域认证、文件上传、异步状态和导出协议待正式设计。
- 模型和存储密钥仅放后端；GitHub工作流和前端不得包含生产凭据。

页面接入示例见[接入说明](接入说明.md)，每个场景的完整需求见对应OpenSpec工作包。
