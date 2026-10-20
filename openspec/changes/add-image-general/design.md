# Design

## Context

范围见[proposal](proposal.md)，验收见[spec](specs/image-general/spec.md)。框架已经提供独立场景页与501空接口；业务待实现。

## Decisions

负责人：③ 吕佳文。负责2.1单张与批量图片AI来源检测，提供可供④按材料版本引用的结果；售后局部篡改、商品核对和案件汇总归④，不以完成证件票据流程为调用前提。

- 页面：`src/modules/image/pages/general.js`，目前不创建DOM和业务请求。
- 服务：`src/modules/image/service.js`；修改前与同模块场景成员对齐。
- 场景定义：`src/modules/image/definition.js`；类型：同目录 `contracts.d.ts`。
- 公共映射见[统一设计](../define-shared-foundation/design.md)，代码分工见[开发索引](../../../docs/TEAM_DEVELOPMENT.md)。

## Owner Follow-up

负责人结合需求补充输入输出、页面交互、后端校验、算法或服务选择、失败处理及验证方式。总控不预先规定算法、供应商或开发细任务。新增公共字段时在同一PR更新契约与调用方。
