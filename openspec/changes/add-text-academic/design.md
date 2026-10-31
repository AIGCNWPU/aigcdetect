# Design

## Context

范围见[proposal](proposal.md)，验收见[spec](specs/text-academic/spec.md)。业务已接通后端 EGTE 推理与报告/润色链路。

## Decisions

负责人：① 高佳楠。仅负责1.1论文场景。

### 前端

- 页面：`src/modules/text/pages/academic.js`
- 降重指南：`src/app.js` 中 `guidePage` / `setupGuidePage`
- 样式：`src/styles.css`（报告大背景浅蓝或纯白按页面约定；指标卡白底；去掉英文 kicker）
- API 基址：`src/api.js`

### 后端

- 业务 API：`backend/api_server.py`（8010）
- 共用推理：`backend/infer.py` 的 FastAPI `app`（8012，`uvicorn infer:app`）
- 解析：`pdf_layout.py`；报告：`reporting.py`；润色：`humanize.py`
- 模型路径与数据集说明：[`backend/README.md`](../../../backend/README.md)

### 打分与展示

- 风险档：≥62% 较高，≥42% 需复核，否则较低。
- 短句（&lt;约 8 字/词）、垃圾行、可选排除的元信息/参考文献不单独进模型；原文高亮中灰字为未单独打分或对齐夹缝。
- 句级分布条宽度按真实句数占比；0 句档不画色块。
- 下载报告：PDF 逐句白底 + 左侧色条；中高风险优先，低风险随后；最多约 120 句。

### 近期改补（UI / 报告）

- 大背景：检测区固定浅蓝；降重报告纯白；去掉左侧粗色边。
- 文案：去掉「AI DETECTION」「AI REDUCTION」；下载按钮「下载润色对比」同款浅蓝块。
- 建议卡片：接口返回前显示「正在分析中…」；失败提示刷新，不静默回退本地建议。
- 摘要四列并排白底，避免大块灰底留白。

## Owner Follow-up

- 句级评测数据与误报复核（EGTE README 已提示整篇指标≠句级准确率）。
- 与②对齐公共文本结果字段（如有新增）。
