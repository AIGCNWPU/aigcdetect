# 正式服务器：通用图片检测「卡住」故障诊断与修复（2026-11-17）

## 现象

负责人反馈：正式服务器上「通用图片检测」接口被占用、一直卡着。

## 结论（三问逐条）

| 疑问 | 事实 |
| --- | --- |
| 服务是否随时可用、是否独占固定端口？ | **常驻可用**。`aigc-platform.service`（user 级 systemd）自启动，监听 `127.0.0.1:4184`，`GET /api/v1/health` 持续返回 200。端口是**唯一实例**（不是被别的进程抢占），但不是"固定占死"——是同一时刻只处理一批：2.1 排队串行，2.3 忙时明确返回 `429 REVIEW_BUSY`。 |
| 服务器容量是否不够？ | **不是**。CPU 64 核、内存 188GB（修复后可用 106GB）、4×A100-40GB。任务失败时 GPU1/2 空闲 25GB+/利用率 0%。 |
| 是否显存要求太高导致起不来？ | **不是**。该服务门槛由环境变量设定为 `AIGC_GPU_MIN_FREE_MB=12288`（12GB）、`AIGC_GPU_MEMORY_LIMIT_MB=8192`（8GB 上限）；失败任务的 `dda-gpu.csv` 显示已成功选中 GPU1（空闲 25GB、util 0%）。 |

## 真正原因

三个失败任务（`87047b01`/`bef4e98b`/`372ae4cb`）特征一致：
`process.log` 为 **0 字节**、无 `result.json`、log 时间 = 提交时间 + 约 5–6 分钟，任务终态 `failed / analysis_failed`。

即推理子进程**跑满 300s 超时被 SIGKILL**，队列串行 → 后面的提交全部排队，用户看到"一直卡着"。

定位到耗时来源（在服务器实测）：

| 步骤 | 网络盘冷缓存 | 预热后 |
| --- | --- | --- |
| `import torch` | **51.9s** | — |
| CUDA 初始化 + 首次 matmul | **18.1s** | — |
| `import analyze` | 3.8s | — |
| 读取 `dda_hplus_fp32.pth`（3.2GB） | **3m49s ≈ 229s** | 秒级 |
| **torch + CUDA 合计** | **≈70s** | **2.7s** |

根因链路：conda 环境与权重都在 vos 网络盘（`/mnt/vos-6d37s2q0`，实测 **≈14MB/s**，磁盘已用 96%），
页缓存冷时仅 3.2GB 的 DDA 权重就要 3m49s，加上 torch/CUDA 初始化 ≈70s，总耗时超过旧 300s 超时。

对比：开发机（本地盘、热缓存）同链路仅 18–80s，所以本地一直正常，掩盖了该问题。

附带发现：`aigc-forensics-runtime` 实为 venv，`torch` 实际落在 `aigc-mirror-runtime`。

## 修复

1. **超时对齐**：`src/modules/image/general/service.js` 中 2.1 推理超时 `300000ms → 900000ms`，
   并支持 `AIGC_GENERAL_TIMEOUT_MS` 覆盖（与 2.3 的 900s 一致）。
2. **模型页缓存预热**：新增 `deploy/warm-model-cache.sh`（同副本 `runtime/tools/bin/`），
   读取 weights/{dda_hplus,trufor,vlaforge,rpa,mirror,seed,ocr} 与 torch 等大体积 `.so/.pth` 入页缓存；
   systemd user timer `aigc-model-warm.timer`：启动后 3 分钟首跑，之后每 10 分钟一次，
   `IOSchedulingClass=idle`、`CPUWeight=10`，不干扰推理。日志：`runtime/logs/model-warm.log`。
   实测一次预热读取 **7859MB / 11–71s**；预热后 torch+CUDA 导入 **2.7s**。

## 修复后验证（正式服务器真机）

| 用例 | 耗时 | 结果 |
| --- | --- | --- |
| invoice-a.jpg | **45.1s** | completed，DDA/TruFor/RPA 全 completed |
| invoice-a.jpg（复测） | **40.1s** | completed，`no_obvious_ai` |
| doubao/original.jpg | **50.3s** | completed，`likely_ai` |

## 运维备注

- 若网络盘仍抖动：确认 timer 在跑 `systemctl --user list-timers aigc-model-warm.timer`，
  手动立即预热 `systemctl --user start aigc-model-warm.service`。
- 预热常驻约 8–10GB 页缓存（内存 188GB，安全）。
- 后续可优化方向：把 weights 与 conda env 迁至本地盘（需评估 46GB 可用空间与部署一致性）；
  或改为常驻推理进程（加载一次多次推理），可省掉每次 ~20–30s 的加载开销。
- 2.1 是**串行队列**：多人同时提交会排队（非故障）。需要并发时可评估并发度或预加载常驻进程。
