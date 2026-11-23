# 安装、启动和权重

## 可移植安装

需要Python 3.11/3.12。在用户选定的工作目录创建虚拟环境，安装 `assets/runtime/requirements.txt`。`scripts/detect.py` 客户端仅使用Python标准库，运行模型的解释器则需要这些依赖。

- Linux CPU环境先从PyTorch CPU源安装 `torch==2.9.0 torchvision==0.24.0`，再安装requirements，避免不必要的CUDA依赖。
- macOS可用相同版本的普通PyTorch轮子；本包运行时明确选择CPU。
- YuNet使用OpenCV ONNX推理；VLAForge使用timm、einops、CLIP相关依赖。
- 虚拟环境和权重不放入skill目录，避免复制skill时打包大文件或密钥。

## 权重

- VLAForge官方检查点约966MB：由 [官方仓库](https://github.com/mala-lab/VLAForge)的Google Drive链接获取。下载器为 `assets/runtime/download_weights.py`，使用前查看其默认写入位置；可把下载结果移动到用户指定权重目录。
- YuNet：OpenCV官方 `face_detection_yunet_2023mar.onnx`，随同官方权重校验记录见 `assets/runtime/weights.json`。
- 不要将ImageNet骨干或随机分类头当作伪造检测检查点。

```bash
python3 scripts/detect.py start --python /path/to/venv/bin/python --weights /path/to/model.pth --face-model /path/to/face_detection_yunet.onnx
```

`start` 前台运行uvicorn，默认仅监听127.0.0.1:18601，不占用网页原端口。启动后在另一个会话执行health和detect。停止本次启动的服务用其会话Ctrl+C，不使用全局pkill。

## 当前机器已验证路径（只作为发现线索）

- Python：`/Users/sxswz/Documents/Codex/2026-10-25/git-clone-https-github-com-aigcnwpu/work/video-general/.venv/bin/python`
- VLAForge：`/Users/sxswz/Documents/Codex/2026-10-25/git-clone-https-github-com-aigcnwpu/work/vlaforge-official-weights`（文件而非目录）
- YuNet：`/Users/sxswz/Documents/Codex/2026-10-25/git-clone-https-github-com-aigcnwpu/work/vlaforge-local/face_detection_yunet.onnx`

更换电脑后重新定位或安装，不把这些绝对路径作为运行前提。

## 外部复核

随包运行代码包含上游可选视觉复核功能，但本包添加了明确的配置读取开关，默认禁用。需要时先确认用户授权的 `DEEPSEEK_BASE_URL`、所上传的代表帧及费用范围，再通过环境设置Key并为start/detect添加 `--allow-external-review`。不自动从旧项目复制 `.env`。

## 授权

VLAForge上游源码采用MIT，随包保留vendor内LICENSE；官方检测权重的独立商用授权尚未确认。YuNet官方模型目录采用MIT。此封装不授予模型/数据的商业权利。
