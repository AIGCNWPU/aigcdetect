# Design

## Context

范围见[proposal](proposal.md)，验收见[spec](specs/text-news/spec.md)。框架已经提供独立场景页与501空接口；业务待实现。

## Decisions

负责人：② 智森慧。负责1.2新闻场景及三审三校，同时维护1.3网文工作包。论文处理归①；AI生成风险与校对问题分别展示，修订后新建检测并保留旧稿结果。

- 页面：`src/modules/text/pages/news.js`，目前不创建DOM和业务请求。
- 服务：`src/modules/text/service.js`；修改前与同模块场景成员对齐。
- 场景定义：`src/modules/text/definition.js`；类型：同目录 `contracts.d.ts`。
- 公共映射见[统一设计](../define-shared-foundation/design.md)，代码分工见[开发索引](../../../docs/TEAM_DEVELOPMENT.md)。

## Owner Follow-up

负责人结合需求补充输入输出、页面交互、后端校验、算法或服务选择、失败处理及验证方式。总控不预先规定算法、供应商或开发细任务。新增公共字段时在同一PR更新契约与调用方。
