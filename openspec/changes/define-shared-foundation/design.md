# Design

## Context

当前采用原生JavaScript模块、CSS和Node.js HTTP服务，参考VERITAS项目前端设计；当前只展示4个模块与10个空白场景。`jumu-team/jumu`用作团队协作组织参考，未迁移其业务与Next.js依赖。

## 已接入框架的实际映射

| 公共入口 | 当前实现与边界 |
| --- | --- |
| `src/catalog.js` | 聚合四个模块定义，派生10个场景 |
| `src/modules/*/definition.js` | 各模块的场景、名称、路由和API元数据 |
| `src/modules/*/pages/*.js` | 10个独立空白场景渲染函数 |
| `src/modules/registry.js` | 聚合客户端场景注册，不含服务端实现 |
| `src/app.js` / `src/styles.css` | 公共顶栏、侧栏、模块卡片、面包屑和路由 |
| `src/api.js` / `src/contracts.d.ts` | 请求封装及场景级初始类型 |
| `src/modules/*/service.js` | 各模块业务接入点，目前均抛出未实现错误 |
| `src/server/registry.js` | 服务端模块分发；不进入浏览器打包 |
| `scripts/serve.mjs` | 静态预览、健康检查、目录及10个501业务接口 |
| `scripts/openapi.mjs` / `docs/openapi.json` | 运行时接口和交付快照，均由场景配置生成 |
| `scripts/source-files.mjs` / `scripts/build.mjs` | 无依赖离线构建，新增客户端文件须同步打包列表 |

## Decisions

- 页面注册与服务注册分别维护；业务算法、密钥和数据不得进入浏览器打包。
- 当前业务POST接口是场景入口占位，没有解析或验证业务请求体；接入真实业务时先约定请求schema、大小限制、鉴权与响应，不能把目前的空对象当作完成的API。
- 前端Hash路由与API路径分开。原始输入、文件和任务标识由正式公共后端定义，不在本次框架里伪造。
- 部分结果、覆盖不足和服务失败必须分开表示；只有模型实际处理后才展示对应风险线索。
- 论文/新闻/网文可分别开发；图片与视频售后场景将来通过同一案件标识关联材料，不复制或互相改写对方结果。
- 证件票据和报告需要按需求脱敏；密钥、访问控制、存储保留期限由公共能力实现时补充。

## Owner Follow-up

先完成最小输入与任务契约、权限与存储，再推进各工作包的真实服务联调。具体技术选型和字段在实现时细化；不提前把占位写成生产能力。
