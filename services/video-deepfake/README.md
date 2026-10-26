# 3.2 VLAForge 本地推理试运行（GPU 优先）

复用已有深度伪造工作台，提供真实模型推理、YuNet人脸提取、方向尝试、镜头内几何关联、代表人脸和采样点风险。仅支持本机开发；共享部署所需鉴权、持久化、异步任务和独立效果评测未实现。

## 启动

Python 3.11/3.12，Node.js >=20。首次需要联网下载依赖和约966MB官方检测权重；模型权重、环境和测试视频不进入Git。

```sh
cd services/video-deepfake
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python download_weights.py
.venv/bin/python -m uvicorn app:app --host 127.0.0.1 --port 8601
```

服务器（A100）上可复用共享conda环境里已装好的CUDA版torch，避免重复下载几个GB的CUDA轮子：

```sh
cd services/video-deepfake
~/conda/envs/video-general/bin/python -m venv --system-site-packages .venv
.venv/bin/python -m pip install -r requirements.txt   # 只补装少量小依赖
```

国内网络通常无法直连 Google Drive，`download_weights.py` 会失败。此时可在能访问的网络下载 `model.pth`，放到本目录 `artifacts/` 下，并按 `weights.json` 中的 SHA-256 自行校验（`sha256sum model.pth` 应为 `2bc0c1e33d08a241386f88e3a9bc0ee4a504def129be0b4a9197b33f6feaff1f`，大小 965834563 字节）。YuNet 权重来自 GitHub，可直接用下载器获取。

A100 实测（CUDA 12.8、torch 2.9.0）：模型加载约 8.8 秒，435,967,305 参数常驻显存；单段 3.9 秒视频、12 张采样人脸端到端约 1.9 秒。CPU 路径仍可用（`VLAFORGE_DEVICE=cpu`），但每条人脸推理需要数秒。

另开终端，在仓库根目录启动网页：

```sh
PORT=4174 npm run dev
```

打开 http://127.0.0.1:4174/#/video/deepfake 。服务未就绪时页面保持未接入，每5秒重试健康检查；就绪后自动配置适配器。离线file://预览不会连接算法。

可覆盖的服务端变量：`VLAFORGE_SERVICE_URL`（Node网关，默认http://127.0.0.1:8601）、`VLAFORGE_DEVICE`（`cuda`或`cuda:0`等；缺省时GPU可用自动选CUDA，否则CPU）、`VLAFORGE_CHECKPOINT`、`YUNET_CHECKPOINT`（Python权重绝对路径）。默认权重位于本目录的artifacts/。模型常驻约0.436B参数；多GPU时用`CUDA_VISIBLE_DEVICES`选择显卡。

## 接口与边界

- `POST /api/v1/video/deepfake`：multipart字段video，代理到Python的`POST /detect`；返回data与requestId。
- `GET /api/v1/video/deepfake/health`：返回ready、model、device、parameters。
- 视频最多100MiB、120秒；网关另允许1MiB multipart开销。检测任务单任务串行，忙时429。请求中断只终止HTTP等待，不保证中断已开始的推理。
- 最多12个均匀采样位置、24张合格人脸，全部结果标注partial；不是逐帧分析，不承诺发现极短伪造。
- YuNet检查框与五官结构；方向按首个可用采样画面尝试0/90/270/180度。首帧无脸会继续尝试后续采样，镜头中途旋转尚未处理。
- 人物仅通过镜头内位置/IoU作保守关联；不做人脸身份识别，不保证跨镜头、遮挡或人物交叉时关联正确。同一人可能有多个轨迹。
- 人脸等比例正方形裁剪并保留边缘；小脸、遮挡、侧脸、模糊仍可能漏检。
- 0.5/0.8为试运行分档阈值，尚未业务校准；原始分数不是真实伪造概率。无人脸返回unknown，失败不返回低风险。
- 时间标记只对应实际采样帧，不将整段未采样区域扩成伪造区间。分类器不提供可核验的具体视觉缺陷解释。
- 原视频在请求临时文件中处理，结束清理；报告沿用浏览器本地保存。无服务端历史。

## 来源及兼容改动

VLAForge源码固定为mala-lab/VLAForge提交`5ec3b2b4333a8b4140b1d5de18f80faae0789813`，必要源码及MIT许可放在vendor/VLAForge。参考 https://github.com/mala-lab/VLAForge 。权重来源与SHA-256见weights.json。公开代码许可不能替代模型和训练数据授权，当前仅用于本地验证。

兼容修改：旧pkg_resources导入改为packaging；使用相同CLIP BPE词表的tokenize，避免加载无关open_clip训练依赖；修正batch=1时squeeze丢失批维；移除未使用的matplotlib导入。入口从检测检查点重建CLIP并strict加载完整状态，不使用随机分类权重，不更改网络结构。冻结骨干也需要加载。推理设备自动选择（GPU优先，`VLAFORGE_DEVICE`可强制CPU）。

YuNet为OpenCV官方2023mar模型，来源 https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet 。下载器核对已验证版本的SHA-256，不静默接受权重更新。

## 验证

仓库根目录执行npm run check、npm test、npm run build。Python测试使用scikit-image内置公开照片构造方向、双人脸位置和无脸控制样本（不是换脸正样本）：

```sh
services/video-deepfake/.venv/bin/python -m pip install scikit-image
services/video-deepfake/.venv/bin/python -m unittest discover -s services/video-deepfake/tests
```

人脸测试需要已下载YuNet权重；缺失时明确跳过。真实模型端到端还需启动服务并上传授权测试视频。通过控制样本或接口测试不代表检测准确率已验证。
