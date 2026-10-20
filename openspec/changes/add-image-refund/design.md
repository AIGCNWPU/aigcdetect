# Design

## Context

范围见[proposal](proposal.md)，验收见[spec](specs/image-refund/spec.md)。框架已经提供独立场景页与501空接口；业务待实现。

## Decisions

负责人：④ 闭耀松。负责2.2售后图片局部篡改定位、商品描述核对、补证及案件结果，同时维护3.3售后视频。图片AI来源结果引用③；同案图视频使用统一案件引用，不重复实现通用来源检测。

- 页面：`src/modules/image/pages/refund.js`，目前不创建DOM和业务请求。
- 服务：`src/modules/image/service.js`；修改前与同模块场景成员对齐。
- 场景定义：`src/modules/image/definition.js`；类型：同目录 `contracts.d.ts`。
- 公共映射见[统一设计](../define-shared-foundation/design.md)，代码分工见[开发索引](../../../docs/TEAM_DEVELOPMENT.md)。

## Owner Follow-up

负责人结合需求补充输入输出、页面交互、后端校验、算法或服务选择、失败处理及验证方式。总控不预先规定算法、供应商或开发细任务。新增公共字段时在同一PR更新契约与调用方。
