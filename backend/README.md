# 后端与模型 / 数据集说明

本目录是「AI 论文与学术稿件检测」业务 API 与推理编排。运行步骤见仓库根目录 [运行指南.md](../运行指南.md)。

## 模型与数据集（EGTE）

检测打分使用共享包 **EGTE C-ReD + RAID**（不在本仓库内拷贝权重）：

| 项 | 说明 |
| --- | --- |
| 路径 | `/mnt/vos-6d37s2q0/users/yh/models/EGTE_CRED_RAID_20261023/` |
| 完整说明 | 共享模型目录中的 `README.md` 与 `SHARED_USAGE.md` |
| 中文分类器 | `cred` ← C-ReD 数据训练的随机森林（`models/cred/model.joblib`） |
| 英文分类器 | `raid` ← RAID 数据训练的随机森林（`models/raid/model.joblib`） |
| 特征底座 | Falcon-7B 提取 74 维 EGTE 特征（`pretrain_model/falcon-7b/`） |
| 本仓库入口 | `infer.py` → `MODEL_ROOT`；`uvicorn infer:app`（8012）对外 `/api/v1/infer` |

自动选分类器：正文汉字占比高用 `cred`，否则用 `raid`（见 `classifier_for`）。

句级结果：分句后按块调用模型；不足约 8 字/词、垃圾行、可选排除的元信息/参考文献不单独进分。页面灰字多为未单独打分或对齐夹缝，详见 OpenSpec design。

## 服务分工

| 端口 | 脚本 | 职责 |
| --- | --- | --- |
| 8012 | `run_infer.sh` | 共用推理（预加载 cred/raid + Falcon） |
| 8010 | `run_api.sh` | PDF/章节解析、检测编排、报告、润色（调 8012；润色走 DeepSeek） |

配置：`backend/.env`（`DEEPSEEK_*`、`MODEL_INFER_URL`、`MINERU_*` 等）。降重技能：`backend/skills/`。

## 主要模块

- `api_server.py`：HTTP API（检测 / 解析 / 报告 / humanize）
- `infer.py`：EGTE 加载、打分与共用推理 HTTP
- `pdf_layout.py`：文档解析与章节
- `reporting.py`：检测 / 降重报告 JSON、HTML、PDF
- `humanize.py`：学术润色与建议卡片（DeepSeek）

## 改补摘要

- 检测页：上传/粘贴、章节选择、全文或指定章检测、左右定位高亮、句级分布条、可读性/句子结构指标。
- 报告：下载 PDF/HTML；逐句中高风险优先；白底黑字 + 左侧色条；低风险句仍列出。
- 降重指南：带入检测结果 → 建议卡片（加载中提示）→ 整段/仅风险润色 → 对照报告与「下载润色对比」。
- UI：大背景浅蓝或纯白按页面约定；去掉英文 kicker；指标卡白底；分布条按真实占比（零档不画色块）。

说明：后端源码、模型权重、原始数据集和 `.env` 仍部署在远程服务器，不提交到本仓库。
