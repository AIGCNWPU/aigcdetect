# 2.1 与 2.3 总项目交付

本次交付任务 2.1 通用图片检测与 2.3 证件票据核验。通用图片提供真实异步检测、来源凭证与辅助诊断、区域响应展示及冻结实测示例；材料核验接入 Agent 智能复核、证据关联、可点击篡改区域和更清晰的单份/跨文件结果。超长审核输入预先编目、分批，内部容量异常不作为材料矛盾展示。

涉及公共入口：图片模块服务分发、HTTP 请求处理、健康接口场景列表、OpenAPI、构建清单及冒烟检查。集成时保留团队已有其他场景。

依赖：Agent SDK 与 zod；模型权重、Python 环境、C2PA 工具、示例资产和私密 API 配置不进入 Git，部署需按 image-workstream 文档配置。DDA-H＋用于整图生成检测，SEED用于局部定位。

OpenSpec：继续 add-image-general 与 add-image-documents，不归档未完成项。

功能分支交付，仅供维护者评审合并；未修改远端 main。

## 基线与来源

总项目基线 `949f08a`，分支 `ljw/image-review-20261102`。业务代码来自独立仓库快照 `a86a2cc`，同时包含 `3a3f53c` 的积累成果和师兄 `5cbcd06` 的 Agent 实现，保留作者署名。未移入独立仓库专用 README/远端配置，也未提交 output PDF、模型权重、数据集和运行结果。

## 集成适配

- 保留总项目全部文本、售后图片、视频和音频实现，沿用 esbuild 与现有 Node 测试入口。
- 图片生成检测和材料核验使用34 MiB有界JSON解析与同源检查，异步提交返回202；其他接口保持原协议。
- 材料页面适配总项目 `api.invoke` 已返回业务对象的契约，避免重复取 data 导致示例和轮询空白。
- 图像 OpenAPI 拆为 `scripts/image-openapi.mjs` 并入总契约；原有文本和其他场景schema保留。
- 静态服务限于客户端清单、样式与public/assets，禁止读取服务器源码及Python适配器。新增 `regions.js` 客户端条目。
- 新增Agent SDK及zod，保留esbuild，锁文件重新生成并用npm ci验证。

## 验证与复跑

493项Node测试通过；npm ci、npm run check、npm run build、npm run smoke通过；OpenSpec 1.13.1的11个工作包严格校验通过。浏览器检查两种图片工作台的实测示例、桌面/手机布局以及模拟上传202→轮询200协议通过。本次集成交付没有重新调用GPU或付费API；历史模型效果见原实验文档。

可选浏览器回归：先构建，设置 `PLAYWRIGHT_MODULE` 为已有Playwright入口的file URL、`BROWSER_EXECUTABLE` 为浏览器程序，执行 `node tests/image-client-integration.browser.mjs`。该回归拦截材料请求返回测试数据，不会调用真实模型。

部署必须显式设置 `AIGC_PLATFORM_ROOT` 指向本机资产根目录，按迁移及模型文档恢复Python环境、DDA-H＋、SEED、OCR和C2PA；示例JSON位于该目录的 `runtime/public-examples/`。仅克隆Git不会自动获得模型或冻结示例；未配置时接口如实返回不可用。Agent配置仅放服务端环境中。

超长材料支持有界分批，但跨分片全局语义二次汇总尚未实现，保留部分完成状态。公共认证、长期材料治理和生产多用户任务隔离仍不在本次完成声明内。

## 页面截图

[通用图片检测](../screenshots/image-general-integration.jpg) · [材料核验](../screenshots/image-documents-integration.jpg)
