# Design

## Context

范围见[proposal](proposal.md)，验收见[spec](specs/video-aftersales/spec.md)。框架已经提供独立场景页与501空接口；业务待实现。

## Decisions

负责人：④ 闭耀松。负责3.3售后视频修改线索、商品描述核对、补证和图视频案件汇总。通用视频AI来源结果引用⑤，不依赖换脸完成；同一案件图片由自己的2.2工作包提供。

- 页面：`src/modules/video/pages/aftersales.js`，目前不创建DOM和业务请求。
- 服务：`src/modules/video/service.js`；修改前与同模块场景成员对齐。
- 场景定义：`src/modules/video/definition.js`；类型：同目录 `contracts.d.ts`。
- 公共映射见[统一设计](../define-shared-foundation/design.md)，代码分工见[开发索引](../../../docs/TEAM_DEVELOPMENT.md)。

## Owner Follow-up

负责人结合需求补充输入输出、页面交互、后端校验、算法或服务选择、失败处理及验证方式。总控不预先规定算法、供应商或开发细任务。新增公共字段时在同一PR更新契约与调用方。
