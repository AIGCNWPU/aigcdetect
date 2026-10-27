# 2.3 核查 skills 研究与解释提示词

2026-10-22。先检索公开 skills，再按本项目的中文材料与外发边界设计提示词。以下仅采用核查方法，不安装外部连接器，不把第三方 skill 当作中国法律、税务核验或图像鉴伪模型。

## 检索结论

| 原始来源 | 固定版本与许可 | 采用内容 | 未采用内容 |
| --- | --- | --- | --- |
| [Anthropic reconciliation](https://github.com/anthropics/knowledge-work-plugins/blob/33d3dea41a341b341d4f5da2e8801ae0c89be2b8/finance/skills/reconciliation/SKILL.md) | `33d3dea41a341b341d4f5da2e8801ae0c89be2b8`，Apache-2.0 | 同期间/同口径比较，区分时间差与未解释差异，保留核对依据 | 其示例金额、账龄和升级阈值不作为我国机构政策 |
| [Anthropic audit-support](https://github.com/anthropics/knowledge-work-plugins/blob/33d3dea41a341b341d4f5da2e8801ae0c89be2b8/finance/skills/audit-support/SKILL.md) | 同上 | 先明确核验目标和所需证据，再列例外与未覆盖项 | 美国SOX适用判断、抽样数量和法律结论 |
| [Loopfour contract-to-invoice](https://github.com/loopfour/finance-skills/blob/6f02e8a0ac9f306a6d2d20bc3d9b7c8aec6f6065/skills/contract-to-invoice/SKILL.md) | `6f02e8a0ac9f306a6d2d20bc3d9b7c8aec6f6065`，MIT | 围绕核心发票对照合同，理由需回指证据，合同歧义保留待复核 | 让LLM重新计算本地已验证金额、直接批准票据 |
| [Loopfour payment-reconciliation](https://github.com/loopfour/finance-skills/blob/6f02e8a0ac9f306a6d2d20bc3d9b7c8aec6f6065/skills/payment-reconciliation/SKILL.md) | 同上 | 弱关系不强匹配，区分分期、退款和手续费 | 原始业务标识外发、自动记账或付款 |
| [Loopfour invoice-health-check](https://github.com/loopfour/finance-skills/blob/6f02e8a0ac9f306a6d2d20bc3d9b7c8aec6f6065/skills/invoice-health-check/SKILL.md) | 同上 | 字段完整性与计算正确性分开 | 无校准的0–100综合健康分不作为真伪分 |

原文件、LICENSE、提交号及逐文件SHA256保存在平台根 `runtime/references/review-skills-20261022/pinned-manifest.json` 和同级对应仓库目录。GitHub API首次访问失败记录也保留；后续通过公开Git refs取得提交号，按固定提交下载原始文本。没有执行任何第三方安装脚本。

结论：找到适合复用的对账/证据审查方法，但没有在本次检索中验证到可直接覆盖“中文票据视觉篡改＋政府/科研制度＋核心多材料核查”的现成skill。由本地代码执行规则、来源与关系核验，DeepSeek解释已确定的证据与不足。

## 提示词和外发结构

新提示词：[deepseek-target-review-v1.txt](../../src/modules/image/documents/prompts/deepseek-target-review-v1.txt)。旧提示词及旧实验保持不变。

顺序是核验范围、规则状态、证据支持的有限结论、可能的替代解释、可执行复核动作。文件级描述可以是“本文件存在待复核的内容矛盾，依据是……”，不必将矛盾归结为某一处已证实篡改。模型不能修改规则状态、补造法规或推断修改动机。

`redacted-target-review/0.2` 沿用数值/枚举白名单，并增加：

- `region_rule_links`：仅当字段证据的材料、页码与渲染图哈希匹配时，报告本地矩形空间重叠；不发送字段值、业务ID或哈希。
- `region_ocr_support`：区域内OCR框数量、低置信数量；不发送文字。
- 所有外发位置是相对坐标，关联ID在摘要中匿名重编号。

矩形重叠不等于掩码像素验证，更不等于篡改证明。无可靠关联时，解释必须承认不能确定定位合理性。API仍不能观察原图字体、印章、颜色或拼接边缘。

## 调试预算

`ExplanationBudget` 默认0，显式启用每个实验最多3次；在发送前扣减，失败/超时也消耗预算，不自动重试。相同摘要、提示词哈希和模型可复用缓存；同实验目录不能重新创建对象或改上限来重置预算。并发通过文件锁串行化。不同实验由操作者显式创建，不能把“每实验3次”理解为全平台账户月度额度。

工作台默认不调用外部API。新调试入口从本机任务结果组装摘要：

```sh
source ../runtime/activate.sh
../runtime/envs/ocr-runtime/bin/python scripts/image-validation/explain_review.py \
  --review-dir "$AIGC_PLATFORM_ROOT/runtime/reviews/任务ID" \
  --sample-id m1-p1 \
  --output "$AIGC_PLATFORM_ROOT/runtime/replay/新实验/explanation-dry-run.json"
```

这条命令不读取配置文件、不调用API。仅在明确进行联网调试时添加 `--send --max-calls 1` 和本机配置路径；内容从不打印。必须已有成功SEED结果，分数低于研究阈值0.5时不调用。该阈值不是中文真实业务已校准阈值。HTTP端不开放API密钥或外部解释开关。

## 本轮验证

10项独立测试覆盖默认不调用、无报警、预算耗尽、持久化缓存、提示词变更、失败不重试、未知证据引用、原文注入拒绝、位置来源绑定和不泄露原文/业务ID。另对迁移验收SEED结果做真实dry-run，状态 `not_run/debug_disabled`。

本轮真实DeepSeek调用数为 **0**，没有读取配置或密钥内容。离线替身用于验证边界，不能证明DeepSeek解释质量。待可用GPU完成新链路样本后，选择1–3个“定位与规则支持/矛盾/不足”的案例做有限实际API调试，并冻结提示词版本。独立留出集尚未建立，不作泛化成绩声明。
