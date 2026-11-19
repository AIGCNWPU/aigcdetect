# 推理服务

HoliAntiSpoof（Qwen2.5-Omni-7B + DoRA 适配器）的推理封装：一套引擎，同时提供 HTTP 与命令行入口。

## 文件

| 文件 | 用途 |
| --- | --- |
| `engine.py` | 推理引擎：模型加载、单段推理、长音频切窗、视频抽音轨 |
| `server.py` | FastAPI 服务，`POST /api/v1/audio/forgery` |
| `detect.py` | 命令行批量检测 |
| `verify.py` | 迁移/升级后的自检脚本（比对固定样例分数） |
| `run_server.sh` | 启动 / 停止 / 状态 / 日志 |

## 环境

```
torch 2.9.1 (cu128) · transformers 4.57.6 · peft 0.18.1 · accelerate 1.15.0
qwen-omni-utils 0.0.9 · soundfile · librosa · av
fastapi · uvicorn
```

```sh
pip install -r requirements.txt
```

## 权重

需要两份权重，通过 `MODEL_ROOT` 指定目录，其下应包含：

```
$MODEL_ROOT/Qwen2.5-Omni-7B    # 基座（约 22 GB）
$MODEL_ROOT/HoliAntiSpoof      # DoRA 适配器（约 1.3 GB）
```

```sh
export MODEL_ROOT=/path/to/models
```

## 运行

```sh
# 一键运维（推荐）：状态 / 启动 / 自检 / 守护
./ops.sh status        # 服务、磁盘读速、负载、GPU
./ops.sh start         # 磁盘低于阈值时直接报错
./ops.sh start --wait 30   # 最多等 30 分钟，磁盘恢复即启动
./ops.sh verify        # 四条样例自检，比对迁移前的分数
./ops.sh all           # 启动 + 等就绪 + 自检
./ops.sh watch         # 后台守护：等磁盘恢复后自动启动并自检
                       #   WATCH_HOURS=48 nohup ./ops.sh watch > ops-watch.log 2>&1 &

# 底层脚本
./run_server.sh start
./run_server.sh status
./run_server.sh stop

# 命令行
python detect.py samples/wav1.wav
python detect.py --dir /path/to/audios --jsonl out.jsonl --threshold 0.6
```

启动时加载模型约 8 秒，显存占用约 18 GiB。

> `ops.sh` 启动前会先测模型分片的读速度：低于 `IO_MIN_MBPS`（默认 20 MB/s）说明共享盘被其他租户占满，
> 此时直接启动只会卡在 `D` 状态（不可中断磁盘等待）。这个阈值判断是踩坑之后加的——磁盘被打满时，
> Python 连依赖都导入不了，表现是进程活着、端口不监听、日志空白。

## 行为说明

- **≤ 30 秒**：整段一次推理；`fakeRegion` 直接取模型生成的区间（`"all"` 或 `[[s,e]]`）；
- **> 30 秒**：按 10 秒窗、5 秒步长滑窗，逐窗评分，合并超过阈值的窗口得到绝对区间；
- **视频**：用 PyAV 抽取第一条音轨、重采样到 16 kHz 单声道，再走同一条链路；
- **上限**：文件 ≤ 80 MB、时长 ≤ 120 秒，超限在探测阶段直接返回 413。

## 已知限制

- 阈值 0.5 为模型默认值，未按业务场景校准；
- 无鉴权、CORS 全开，仅限内网；
- 同步接口，长音频会长时间占用请求；
- 单进程全局锁，并发请求串行执行。

## 学术检测独立后端（远程部署）

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

本仓库的 `api.implemented` 标记描述 Node 本地场景服务。学术检测依赖上述独立后端，因此该标记为 `false`；启用 `PROXY_BACKEND=1` 并配置 `BACKEND_URL` 后，学术检测请求转发到独立后端，页面能力不受该标记影响。
