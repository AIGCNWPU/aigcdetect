# 3.1 通用AI生成视频检测 · Native-Scale 推理服务

方法：**Preserving Forgery Artifacts: AI-Generated Video Detection at Native Scale**（ICLR 2026）
官方实现：<https://github.com/mgiant/Qwen2.5ViT-AIGVDetection>

Qwen2.5-ViT-448p 视觉编码器（`Qwen2.5-ViT_140k_224p_448p`，约 0.669B 参数）在**原生分辨率**下保留生成视频的伪造痕迹，逐窗口输出 0–1 的 AI 生成得分；本服务在官方实现之上保留项目统一的窗口采样与结果聚合，直接对齐前端契约（`src/modules/video/general/model.js` 的 `normalizeDetectionResult`）：

- 全片均匀采样最多 12 个约 2 秒窗口（每个 24 帧），逐窗口串行推理；
- 聚合为整片风险（均值与最大值各半）、可疑时间段（相邻可疑窗口合并）、代表画面（窗口中帧 JPEG）；
- `coverage` 固定 `partial`（只覆盖采样窗口），结果 `meta.thresholdsCalibrated=false` 如实说明阈值尚未在业务数据上校准。

> 历史说明：本服务此前的检测引擎为 ReStraV（NeurIPS 2025，DINOv2 表征轨迹几何 + MLP，含自建训练管线）。按项目要求已整体替换为 Native-Scale，旧实现保留在 Git 历史（提交 `92fc432` 及更早）。接入细节见 [README-native-scale.md](README-native-scale.md)。

## 目录结构

```
services/video-general/
├── app.py                 # FastAPI：GET /health、POST /detect（multipart 字段 video）
├── native_scale_core.py   # 推理核心：多窗口采样、官方视觉编码器 + 分类头、结果聚合
├── artifacts/
│   └── config.json        # Qwen2.5-VL 配置（视觉子模块）
├── requirements.txt
├── start-demo.sh          # 一键启动推理服务 + 前端网关
└── README-native-scale.md # 官方仓库接入说明（模型来源、授权状态、集成细节）
```

## 权重准备（不入 Git）

`artifacts/Qwen2.5-ViT_140k_224p_448p.pth` 需从官方 README 的 **448p Google Drive 链接**手动下载后放入。服务器无法直连 Google 时，可从本机上传：

```bash
# 在你自己的电脑上执行（Windows PowerShell / macOS 终端均可）
scp -P 22022 "本地路径/Qwen2.5-ViT_140k_224p_448p.pth" \
  mxz@101.200.176.142:/mnt/vos-6d37s2q0/users/mxz/projects/video-general/aigcdetect/services/video-general/artifacts/
```

或在 VS Code Remote-SSH 的资源管理器里直接拖入上述 `artifacts/` 目录。放置后重启服务（或跑一次 `start-demo.sh`）即自动加载；`/health` 的 `checkpoint`/`modelReady` 字段可确认状态。

## 部署（GPU 服务器）

```bash
conda create -n video-general python=3.11 pip -y
conda activate video-general
conda install -c conda-forge "ffmpeg=8" -y        # torchcodec 解码依赖（需 4-8）
pip install -r services/video-general/requirements.txt

# 一键启动推理服务（127.0.0.1:8600）+ 前端网关（0.0.0.0:4173）
bash services/video-general/start-demo.sh
```

单独启动：

```bash
export LD_LIBRARY_PATH=$CONDA_PREFIX/lib:$LD_LIBRARY_PATH
cd services/video-general && python -m uvicorn app:app --host 127.0.0.1 --port 8600

# 仓库根目录；网关把 /api/v1/video/general 转发到推理服务
VIDEO_GENERAL_SERVICE_URL=http://127.0.0.1:8600 npm run dev
```

打开 `http://127.0.0.1:4173/#/video/general`，页面探测到 `GET /api/v1/health` 中 `services.videoGeneral.available=true` 后自动接入检测；推理服务未就绪时页面保持"未接入"、视频不上传。

环境变量：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `NATIVE_SCALE_DEVICE` | `cuda:0` | 推理设备（无 GPU 回退 CPU） |
| `NATIVE_SCALE_ARTIFACTS` | `./artifacts` | 权重与配置目录 |
| `VIDEO_TORCH_THREADS` | `4` | CPU 线程数 |
| `VIDEO_GENERAL_SERVICE_URL` | `http://127.0.0.1:8600` | Node 网关侧：推理服务地址（兼容旧名 `RESTRAV_SERVICE_URL`） |

## 风险分档

单窗口得分 ≥0.5 记为可疑窗口（进入可疑时间段）；整片综合得分 `0.5×均值 + 0.5×最大值`，`<0.5` 低风险、`<0.8` 中风险、其余高风险。**阈值为临时展示值、未做业务校准**（`meta.thresholdsCalibrated=false`），不能当作准确概率；正式上线前需用业务数据标定。

## 授权

官方检测仓库未声明明确许可；基座 Qwen2.5-VL 采用 Qwen Research License，商业使用需另行授权。当前版本仅供研究和评估，详见 [README-native-scale.md](README-native-scale.md)。
