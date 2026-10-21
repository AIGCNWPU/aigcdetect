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
