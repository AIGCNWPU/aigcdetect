# Design

## 决策 1：推理常驻服务（T1）

**现状**：每次核验 spawn 一个 Python 进程，重新 import torch（开发机 ~3s、正式服务器网络盘冷缓存 70s+）并加载 DDA（3.2GB）/SEED 权重，总冷启动 40–80s。

**方案**：常驻推理守护进程 `scripts/image-validation/inference_daemon.py`
- 启动时加载 DDA 与 SEED 两个模型（按启动时 GPU 快照选卡，`--gpu` 可指定）；
- 监听 `127.0.0.1:8617`（`AIGC_INFERENCE_PORT` 可覆盖），仅本机回环；
- 端点：`GET /health`、`POST /mirror`、`POST /seed`——入参为 manifest JSON（与现有 analyze.py / evaluate_seed.py 相同结构），返回与两者相同的报告 JSON；
- 无状态：一次请求处理一个 manifest 的全部样本；进程崩溃由 systemd 拉起。

**接入（回退兼容）**：`local-runtime.js` 的 `executeStage('mirror'|'seed')` 优先 `fetch http://127.0.0.1:8617/...`（环境变量 `AIGC_INFERENCE_URL` 可覆盖；连接拒绝/超时 2s 即回退现有 spawn 路径）。2.1 的 `general/service.js` 排水器同样优先调用（其 runner 参数与 analyze.py 等价）。
**部署**：`deploy/aigc-inference.service`（systemd user unit，`Restart=always`）；正式服务器安装后 enable --now。
**显存**：DDA≈2–3GB + SEED≈3–4GB，共 ≈6GB，低于 12GB 门槛；启动时选卡后固定。

## 决策 2：前端简约化（T3）

以视觉审查（截图）+ DeepSeek 文案审查结论为准，落以下结构（2.3）：
1. **核验功能**收敛为 6 项带推荐语义的选项，新增「小票/收据核验」（映射 `merchant_reconciliation` 或独立轻项——实现上新增 objective `receipt_review` 复用发票规则包的收据子集）；每文件的**材料类型**默认「自动识别」，不再要求用户逐份选择。
2. **示例区**移到页面底部 Benchmark 之上。
3. **结果页三层**：
   - 顶层（放大）：智能复核结论卡（含矛盾计数与关键矛盾摘要）+ 总结论徽标；
   - 中层：需关注问题列表（每条只给结论与一句原因，证据收起）；
   - 底层（默认折叠）：字段明细、阶段详情、通过项统计（"N 项通过"一句带过，不逐条展开）。
4. 删除页面顶部宣传性大标题、流程步骤条等非功能性元素；辅助小字合并为一行说明。
2.1 同步：结果区结论放大、文件信息/来源候选折叠、删除重复说明文字。

## 决策 3：视觉 + DeepSeek 审查（T2）

- 截图两张前端（Playwright 已有 browser 检查脚本可产出 png；或直接使用现有桌面截图），由视觉模型（多模态读取）按"信息层级/冗余/可达性"出意见；
- DeepSeek flash：把两个结果页的 DOM 文案（去 HTML 标签）发给 2.3 已配置的 DeepSeek，要求按"重复陈述/信息密度/用户下一步行动"给出意见；
- 意见落入 design 附录，逐条映射到 T3 的具体修改。

## 决策 4：MCP（T4）

调研结论（另见 `docs/image-workstream/mcp-integration.md`）：
- 传输：stdio（本地 CLI/IDE 客户端）与 streamable HTTP（远程共享）双模式，均由同一 MCP server 提供；
- 工具面：`image_general_detect` / `image_general_task_result` / `document_review` / `document_review_task_result` / `document_extract_fields`，与市场 API 同源映射；
- 工具描述写明适用场景、输入约束与能力边界（未校准、闭集归因等），客户端 LLM 依据描述做工具选择——描述质量即"算法推荐"的关键；工具返回"结论摘要置顶 + 结构化 JSON 附后"，降低客户端二次整理成本；
- 鉴权复用 APPCODE 语义（MCP HTTP 模式用 header 透传）。

## Risks

- 常驻服务占卡：单卡 ≈6GB，与 12GB 门槛并存时其他任务可能选不到该卡——由 systemd 放在负载最低卡并文档说明；服务崩溃自动重启，回退路径保证可用性。
- objective 新增 `receipt_review` 会进入 OpenAPI 与目录：需同步 catalog 与测试。
- 前端重构涉及大量模板字符串，回归以 UI 测试 + 截图视觉验收双保险。

## 2026-11-20 交互与部署修复

- 前端四个目的对应 invoice_review、identity_consistency、receipt_review、other_review。新增两项后端目的及语义背景；原采购/报销/收付款接口目的保留兼容。智能选择保留 unknown 输入，不提前强制改成收据。
- 隐藏科研审批、项目审批、出差审批、验收记录、证明的手动分类入口，自动分类和历史材料仍可使用原类型。
- 每份文件的模糊/修改图层选择保存在页面状态里，轮询重绘、结果切换及放大视图保持选择；两类图层独立。
- 添加全部清空和明确删除按钮，释放缩略图URL、清除旧结果/关联/错误状态；检测期间禁用编辑以防请求错配。
- 单份智能核查证据桌面每行3项，平板2项，手机1项；保留原文完整内容与默认折叠。
- 正式部署保留API配置和资产，不清理未跟踪文件；仅更新用户工作分支，不合并主分支。平台4184交由单一systemd实例负责，推理8617与API8090独立常驻。
