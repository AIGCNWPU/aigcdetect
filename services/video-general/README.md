# 3.1 通用AI生成视频检测 · 推理服务（Native-Scale 主引擎 / ReStraV 回退）

服务同时集成两套引擎，`app.py` 按 `VIDEO_GENERAL_ENGINE` 与权重可用性自动选择：

| 引擎 | 方法 | 权重 | 说明 |
| --- | --- | --- | --- |
| **Native-Scale**（主） | Qwen2.5-ViT-448p 视觉编码器 + 线性分类头，保留原生分辨率伪造痕迹（ICLR 2026） | `artifacts/Qwen2.5-ViT_140k_224p_448p.pth`（官方 448p 链接，不入库） | 详见 [README-native-scale.md](README-native-scale.md)；权重缺失时自动回退 |
| ReStraV（回退） | DINOv2 ViT-S/14 表征轨迹的 21 维时间几何特征 + MLP | `artifacts/model.pt` 等（本仓库已训练并提交） | 见下文 |

`GET /health` 的 `engine` 字段与检测结果 `meta.method` 如实标明实际运行的引擎，页面「检测模型」字段据此显示。两套引擎共用同一套采样策略（全片均匀 2 秒/24 帧窗口，最多 12 个）、前端契约与结果聚合逻辑。

## ReStraV（回退引擎）

基于 [ReStraV](https://github.com/ChristianInterno/ReStraV)（NeurIPS 2025 *"AI-Generated Video Detection via Perceptual Straightening"*）实现的真实检测后端：视频帧经 **DINOv2 ViT-S/14** 编码后在表征空间形成轨迹，真实拍摄视频的轨迹更“直”、AI 生成视频更“弯”。逐窗口计算步进距离与转角等 **21 维时间几何特征**，用轻量 MLP 判别真伪。

相对论文原版（单窗口采样）的适配：**全片均匀采样多个约 2 秒窗口（每个 24 帧，最多 12 个）逐窗口判别**，聚合输出整片风险、可疑时间段（相邻可疑窗口合并）与代表画面，直接对齐前端契约（`src/modules/video/general/model.js` 的 `normalizeDetectionResult`）。

## 目录结构

```
services/video-general/
├── app.py               # FastAPI 服务：GET /health、POST /detect（multipart 字段 video），引擎选择
├── native_scale_core.py # Native-Scale 主引擎：官方视觉编码器 + 分类头
├── restrav_core.py      # ReStraV 回退引擎：多窗口采样、21维特征、MLP、聚合映射
├── artifacts/           # 训练产物（model.pt / mean.npy / std.npy / best_tau.npy / metrics.json）
├── requirements.txt
└── train/
    ├── download_data.py       # 下载 REAL（UCF101）与 FAKE（VidProM example）
    ├── extract_features.py    # 逐视频取中心2秒窗口 → 21维特征 → HDF5
    └── train_mlp.py           # 类别均衡 + Z-score + 分层划分 → 训练 MLP → 产物入库
```

## 部署（GPU 服务器）

```bash
# conda 环境（Python 3.11）
conda create -n video-general python=3.11 pip -y
conda activate video-general
conda install -c conda-forge ffmpeg -y          # torchcodec 视频解码依赖
pip install -r services/video-general/requirements.txt

# 启动推理服务（默认 127.0.0.1:8600，设备 cuda:0）
export TORCH_HOME=/path/to/cache/torch          # DINOv2 权重缓存目录（首次联网下载）
cd services/video-general && python -m uvicorn app:app --host 127.0.0.1 --port 8600

# 启动前端网关（仓库根目录）；网关会把 /api/v1/video/general 转发到推理服务
VIDEO_GENERAL_SERVICE_URL=http://127.0.0.1:8600 npm run dev   # 兼容旧名 RESTRAV_SERVICE_URL
```

打开 `http://127.0.0.1:4173/#/video/general`，页面探测到 `GET /api/v1/health` 中 `services.videoGeneral.available=true` 后自动接入检测；推理服务未启动时页面保持“未接入”状态。

环境变量：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `VIDEO_GENERAL_ENGINE` | `auto` | `auto`（Native-Scale 权重优先，缺失回退 ReStraV）/ `native-scale` / `restrav` |
| `VIDEO_GENERAL_SERVICE_URL` | `http://127.0.0.1:8600` | Node 网关侧：推理服务地址（兼容 `RESTRAV_SERVICE_URL`） |
| `NATIVE_SCALE_ARTIFACTS` | `./artifacts` | Native-Scale 权重目录（config.json + 448p .pth） |
| `RESTRAV_DEVICE` | `cuda:0` | 推理设备（无 GPU 回退 CPU） |
| `RESTRAV_ARTIFACTS` | `./artifacts` | 训练产物目录 |
| `TORCH_HOME` | `~/.cache/torch` | DINOv2 权重缓存 |

## 训练（复现产物）

```bash
cd services/video-general
python train/download_data.py --out /path/to/datasets/restrav_training   # REAL=UCF101（VSC官方链接已失效），FAKE=VidProM example
python train/extract_features.py --data /path/to/datasets/restrav_training --out training_features.h5
python train/train_mlp.py --features training_features.h5 --out artifacts
```

标签约定与论文一致：`1=REAL, 0=FAKE`；指标与混淆矩阵写入 `artifacts/metrics.json`。

> 数据来源说明：论文原配 REAL（VSC URL 列表）的官方下载链接已失效（S3 AccessDenied），训练改用 UCF101（13,320 段真实摄像机素材）作为 REAL，FAKE 仍为 VidProM example（ms/t2vz/cog 三个生成器子集，可用 `--fake-tars` 调整）。域差异可能影响跨数据集效果，重训时请按业务数据替换。MLP 极小（约 4K 参数），产物随仓库提交便于开箱部署；换训练数据后请重新生成并同步更新。

## 风险分档

单窗口 FAKE 概率 `p`：`p≥0.5` 记为可疑窗口（进入可疑时间段）；整片综合得分 `0.5×均值 + 0.5×最大值`，`<0.35` 低风险、`<0.65` 中风险、其余高风险。阈值在 `restrav_core.py` 顶部常量，重训后可按 `artifacts/metrics.json` 校准。

## 引用

```bibtex
@inproceedings{interno2025aigenerated,
  title={{AI}-Generated Video Detection via Perceptual Straightening},
  author={Christian Intern{\`o} and Robert Geirhos and Markus Olhofer and Sunny Liu and Barbara Hammer and David Klindt},
  booktitle={The Thirty-ninth Annual Conference on Neural Information Processing Systems},
  year={2025},
  url={https://openreview.net/forum?id=LsmUgStXby}
}
```
