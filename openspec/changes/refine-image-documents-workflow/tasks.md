# Tasks

- [x] T1 模型链路定论文档化（design 决策 1；README/前端展示名统一）
- [x] T2 前端删除 规则适用地区/省份/业务日期 三控件；jurisdiction 保留为"非中国大陆材料"开关（默认 CN）
- [x] T3 服务端：`context.region/businessDate` 兼容忽略；policyReferences 注入移除；省份/高校数据归档至 `runtime/research/policy-studies-archived/`
- [x] T4 双模式：请求 `mode=single|batch`；single 跳过 edges/candidates/跨材料规则/confirmations 拒收；语义包 relations=[] 且两份提示词补"单材料不得推测跨材料关系"
- [x] T5 前端模式选择与 single 结果视图（无核心选择/关联确认/跨材料专栏）
- [x] T6 SEED 逐框置信度（components 输出连通域均值 → regions[].score）与 2.3 tamperScore(0-100)
- [x] T7 图像属性 v1 规则基线（quality stage）+ 前端直观提示
- [x] T8 市场 API：tamperScore/逐框 probability/overlay 可选/duration/materialType=auto/错误码 429 文案；README+guide 更新
- [x] T9 回归：node 测试（新增 mode/quality/tamperScore 断言）、check/build/smoke、market-api pytest、两模式各一轮真机
- [x] T10 图像属性 v1.2：行高归一化笔画宽度主判据、方向化锐度、模糊分级/类型/逐行定位
- [x] T11 OCR 空间与置信度融合（低置信不单独定罪；无文字行/笔画不可测两条降级路径）
- [x] T12 市场 API 透出 quality.blur（分级/类型/区域/证据分量）与前端模糊徽标；手写属性明确不评估
