# 正式服务器访问入口（2026-11-19）

服务器内网地址：`192.168.100.3`（同网段/VPN 内可直接访问）。

| 用途 | 地址 | 说明 |
| --- | --- | --- |
| **平台页面（2.1 / 2.3 工作台）** | http://192.168.100.3:4184/ | 浏览器打开；`#/image/general`、`#/image/documents` |
| **对外 REST API** | http://192.168.100.3:8090 | 阿里云市场风格，需 `Authorization: APPCODE <code>`；文档见 `services/market-api/README.md` |
| 健康检查（平台） | http://192.168.100.3:4184/api/v1/health | 无需鉴权 |
| 健康检查（API） | http://192.168.100.3:8090/health | 返回 code/msg/data |
| 常驻推理服务 | `127.0.0.1:8617`（仅本机） | DDA-H+/SEED/TruFor/VLAForge/RPA/翻拍 常驻，供平台内部调用 |

跨网段访问（服务器只在内网时）：
```sh
ssh -L 4184:127.0.0.1:4184 -L 8090:127.0.0.1:8090 -p 22022 ljw@<服务器地址>
# 然后本地访问 http://127.0.0.1:4184 与 http://127.0.0.1:8090
```

## 常驻推理（消除冷启动）

| 服务 | systemd unit | 常驻模型 |
| --- | --- | --- |
| 推理守护 | `aigc-inference.service`（GPU2，≈6–9GB） | DDA-H+（自研骨干）、SEED、TruFor、VLAForge+YuNet、RPA OpenFake27、翻拍分类器 |
| 平台 | `aigc-platform.service`（4184） | 通过 `AIGC_INFERENCE_URL=http://127.0.0.1:8617` 调用常驻推理；不可达自动回退按任务启动 |
| 市场 API | `aigc-market-api.service`（8090） | upstream → 平台 |

实测（发票 invoice-b，2.3 单材料模式）：**12–16 秒**完成整图/篡改/OCR/质量/规则全阶段（此前每次 40–90 秒，含模型冷加载）。

## OCR

- `smoke_ocr.py` 默认 `AIGC_OCR_DEVICE=auto`：检测到 paddle CUDA 构建即用 GPU，否则回退 CPU；
- 正式服务器 `ocr-runtime` 已安装 `paddlepaddle-gpu 3.3.0`（CUDA 12.6），实测 `device=gpu`、单页 47 区域 1.27s；
- 显式指定：`AIGC_OCR_DEVICE=gpu|cpu`。
