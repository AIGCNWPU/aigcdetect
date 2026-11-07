# Design

## Context

范围见[proposal](proposal.md)，验收见[spec](specs/video-general/spec.md)。框架已经提供独立场景页与501空接口；业务待实现。

## Decisions

负责人：⑤ 毛向智。负责3.1视频采样画面AI来源风险、检测范围、时间段和代表画面，提供给④售后视频引用；不要求先完成人物换脸，不承担售后商品核对。视频预处理由公共底座支撑。

- 页面：`src/modules/video/pages/general.js`，当前提供视频上传、任务列表、结果概览、时间轴、可疑片段、关键画面和报告操作。
- 前端数据：`general/model.js` 负责文件校验、格式化与结果归一化；`general/sample.js` 提供明确标注的虚构样例；`general/detection.js` 提供可配置的检测适配入口；`general/report.js` 生成独立 HTML 报告。
- 服务：`src/modules/video/service.js`；修改前与同模块场景成员对齐。
- 场景定义：`src/modules/video/definition.js`；类型：同目录 `contracts.d.ts`。
- 公共映射见[统一设计](../define-shared-foundation/design.md)，代码分工见[开发索引](../../../docs/TEAM_DEVELOPMENT.md)。

## 前端交付（2026-10-21）

- 已实现：MP4/WebM 本地读取与封面生成、时长/尺寸/大小校验、会话内任务状态、进度回调、可定位播放的时间轴、可疑时间段、代表画面筛选、结果字段校验、报告本机保存和 HTML 导出。
- 未实现：真实检测算法、异步任务服务、材料持久化、权限、历史任务跨刷新恢复、真实原始视频与结果的长期关联。`POST /api/v1/video/general` 仍返回501，页面默认不调用它。
- 未配置适配器时，上传视频只做本地预览，不提交检测；页面内置的样例任务明确标注“样例数据”，不得作为真实结论。`window.Veritas.videoGeneralDetection` 用于接入真实服务，结果由前端归一化和边界校验。
- 报告“保存记录”只写入当前浏览器 `localStorage`（最多20条）；导出报告为独立 HTML，样例任务的导出内容保留样例标识。
- 自检：`npm test` 覆盖模型、样例、报告和适配器；可选的 `tests/video-general.browser.mjs` 使用本机 Edge 验证上传、时间轴、筛选、结果、取消/重试和窄屏布局。接入说明见[通用视频检测说明](../../../docs/video-general-integration.md)。

## Owner Follow-up

负责人结合需求补充输入输出、页面交互、后端校验、算法或服务选择、失败处理及验证方式。总控不预先规定算法、供应商或开发细任务。新增公共字段时在同一PR更新契约与调用方。

## 后端交付（2026-10-24）

- 算法（2026-10-28 起）：Native-Scale（ICLR 2026，Qwen2.5-ViT-448p，保留原生分辨率伪造痕迹）。官方权重从 Google Drive 手动获取放入 artifacts（不入 Git）；权重缺失时服务如实报未就绪、页面保持未接入。前序引擎 ReStraV（NeurIPS 2025）已按项目要求移除，实现保留在 Git 历史。DINOv2 ViT-S/14 逐帧编码，21 维时间几何特征（步进距离/转角）+ MLP 判别；推理时全片均匀采样多个约 2 秒窗口（每窗 24 帧，最多 12 个）逐窗判别，聚合出整片风险、可疑时间段（相邻可疑窗合并）与代表画面（可疑窗中帧 JPEG data URL）。
- 服务：`services/video-general/`（FastAPI，`/health`、`/detect`），训练管线与产物见其 README。网关 `scripts/serve.mjs` 实现真实 `POST /api/v1/video/general`（multipart 解析 → 转发 → 前端契约结果），推理服务未启动时 `/api/v1/health` 报 `services.videoGeneral.available=false`，页面保持"未接入"、视频不上传。
- 前端：`general/backend.js` 渲染时探测健康状态并自动注册适配器，不覆盖外部已配置的处理器。
- 契约与校验：`definition.js` 标记 implemented；OpenAPI 快照、接口映射表随 `npm run build` 再生成；`tests/video-general.backend.test.mjs` 覆盖 multipart 解析、上传校验与转发链路（stub 推理服务）。
- 首轮训练（2026-10-24，A100）：43,319 个采样窗口特征（REAL=UCF101 全量 13,320，FAKE=VidProM example 的 ms/t2vz/cog 三个生成器 29,999），均衡后 26,640 训练。留出测试集 Accuracy 99.98%、F1 0.9998、AUC≈1.0（同分布，即测试生成器与训练重叠；跨生成器/真实业务视频的泛化尚未评测，为已知限制）。
- 未实现：异步任务队列、材料持久化与权限、跨刷新历史、跨生成器评测与阈值再标定（见 `services/video-general/README.md` 风险分档）。
