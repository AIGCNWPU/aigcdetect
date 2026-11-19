# Design

## Context

范围见[proposal](proposal.md)，验收见[spec](specs/audio-forgery/spec.md)。框架已经提供独立场景页与501空接口；业务待实现。

## Decisions

负责人：⑥ 张启宇。负责4.1独立音频伪造检测、时间段、试听与报告。视频画面与换脸归⑤，视频音轨伪造不默认并入⑤；需要跨场景调用时再明确材料与时间段引用。

- 页面：`src/modules/audio/pages/forgery.js`，已接入演示页（实测样例、波形、结论与「未接入」失败态）；业务接口仍返回 501，页面不伪造上传文件的判定结果。
- 分人视图：`src/modules/audio/dialogue-view.js` + 样例数据 `dialogue-cases.js`。同一入口下，后端返回 `speakers.length >= 2` 时页面自动切到分人视图；界面只呈现“一段对话 + 每位说话人的判定”，不展示掩码、底噪、单人音轨等内部处理细节，阈值与分数不作为界面指标。
- 服务：`src/modules/audio/service.js`；修改前与同模块场景成员对齐。
- 场景定义：`src/modules/audio/definition.js`；类型：同目录 `contracts.d.ts`。
- 公共映射见[统一设计](../define-shared-foundation/design.md)，代码分工见[开发索引](../../../docs/TEAM_DEVELOPMENT.md)。

## Owner Follow-up

负责人结合需求补充输入输出、页面交互、后端校验、算法或服务选择、失败处理及验证方式。总控不预先规定算法、供应商或开发细任务。新增公共字段时在同一PR更新契约与调用方。
