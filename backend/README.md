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
# HTTP 服务（默认 GPU0、端口 8000）
./run_server.sh start
./run_server.sh status
./run_server.sh stop

# 命令行
python detect.py samples/wav1.wav
python detect.py --dir /path/to/audios --jsonl out.jsonl --threshold 0.6
```

启动时加载模型约 8 秒，显存占用约 18 GiB。

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
