# 安装、启动和权重

## 可移植安装

需要Python 3.11/3.12。在用户选定的工作目录创建虚拟环境，安装 `assets/runtime/requirements.txt`。`scripts/detect.py` 客户端仅使用Python标准库，运行模型的解释器则需要这些依赖。

- Linux CPU环境先从PyTorch CPU源安装 `torch==2.9.0 torchvision==0.24.0`，再安装requirements，避免不必要的CUDA依赖。
- macOS可用相同版本的普通PyTorch轮子；本包运行时明确选择CPU。
- torchcodec需要可发现的FFmpeg共享库；若导入失败先修复FFmpeg/ABI，不要退回随机权重或样例结果。
- 虚拟环境和权重不放入skill目录，避免复制skill时打包大文件或密钥。

## 权重

从 [官方模型链接](https://github.com/mgiant/Qwen2.5ViT-AIGVDetection#model-checkpoints)下载448p权重，用户指定目录需同时包含：

- `Qwen2.5-ViT_140k_224p_448p.pth`，约1.2GiB；
- 对应Qwen2.5-VL-3B视觉架构的 `config.json`。当前包不附带完整语言模型，不需要下载3B语言模型权重。

```bash
python3 scripts/detect.py start --python /path/to/venv/bin/python --weights-dir /path/to/native-scale-weights
```

`start` 前台运行uvicorn，默认仅监听127.0.0.1:18600，不占用网页原端口。启动后在另一个会话执行health和detect。停止本次启动的服务用其会话Ctrl+C，不使用全局pkill。

## 当前机器已验证路径（只作为发现线索）

- Python：`/Users/sxswz/Documents/Codex/2026-10-25/git-clone-https-github-com-aigcnwpu/work/video-general/.venv/bin/python`
- 权重目录：`/Users/sxswz/Documents/Codex/2026-10-25/git-clone-https-github-com-aigcnwpu/work/native-scale-weights`

更换电脑后重新定位或安装，不把这些绝对路径作为运行前提。

## 外部复核

随包运行代码包含上游可选视觉复核功能，但本包添加了明确的配置读取开关，默认禁用。需要时先确认用户授权的 `DEEPSEEK_BASE_URL`、所上传的代表帧及费用范围，再通过环境设置Key并为start/detect添加 `--allow-external-review`。不自动从旧项目复制 `.env`。

## 授权

Native-Scale官方仓库的明确代码/检测权重许可尚未确认；其Qwen2.5-VL-3B基座使用Qwen Research License，商业使用需另行申请。此封装不代表商用授权；基座许可：https://huggingface.co/Qwen/Qwen2.5-VL-3B-Instruct/blob/main/LICENSE 。
