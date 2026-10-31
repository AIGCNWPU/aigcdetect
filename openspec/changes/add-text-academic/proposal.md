# Proposal

需求章节：1.1 AI论文与学术稿件检测。负责人：① 高佳楠。状态：**业务已实现（持续打磨 UI / 报告）**。

## Why

为AI文本检测提供独立的「AI论文与学术稿件检测」业务能力，并衔接降重指南与可下载报告。

## What Changes

- 论文提交与内容选择：粘贴或上传；MinerU/解析切章；可选章节与排除参考文献。
- AI生成风险识别：EGTE `cred`（中）/`raid`（英）打分；整篇分 + 句级分；可读性/句子结构辅助指标。
- 可疑段落标注：原文高亮与右侧疑似片段双向定位；灰字为未单独打分或对齐夹缝。
- 检测报告：在线报告 + 下载 PDF/HTML；中高风险句优先列出，低风险句仍收录。
- 降重指南：`#/text/academic/ai-reduction` 带入检测结果、建议卡片、整段/仅风险润色、对照与「下载润色对比」。
- 非目标：其他场景业务、成员邀请、生产部署；不在前端存储密钥。
- 完整需求见[需求摘录](../../references/AI检测平台_需求摘录.md)第 3 页。
- 模型与数据集说明见仓库 [`backend/README.md`](../../../../backend/README.md) 及 EGTE 包 README。

## Capabilities

### New Capabilities

- `text-academic`：AI论文与学术稿件检测（含报告导出与降重衔接）。

### Modified Capabilities

无。

## Impact

场景 `#/text/academic`，接口 `POST /api/v1/text/academic` 及报告 / humanize 相关 API。复用[公共约定](../define-shared-foundation/specs/shared-foundation/spec.md)。

职责与交接：仅负责1.1论文场景。与②统一文本结果和原文位置格式，不把论文处理流程作为其他文本场景的前置条件。
