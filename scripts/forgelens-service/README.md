# ForgeLens 图片来源服务

服务在 Linux GPU 主机运行，提供图片三路融合的 ForgeLens 分数。主程序和其他两路通过各自的回环端口访问。部署时将本目录与同级的 [cospy-service](../cospy-service/README.md) 一起复制，复用图片 HTTP 处理器。

## 环境与资产

使用 Python 3.10、兼容 CUDA 12.4 的 NVIDIA 驱动，以及启动时至少有 8 GiB 空闲显存的 GPU。将源码、权重和虚拟环境放在有写权限的数据盘。

```bash
export FORGELENS_ROOT=/path/to/data-disk/veritas/forgelens
mkdir -p "$FORGELENS_ROOT/weights"
python3.10 -m venv "$FORGELENS_ROOT/venv"
source "$FORGELENS_ROOT/venv/bin/activate"
python -m pip install torch==2.6.0 torchvision==0.21.0 --index-url https://download.pytorch.org/whl/cu124
python -m pip install numpy==1.26.4 Pillow==11.1.0 ftfy==6.3.1 regex==2024.11.6 tqdm==4.70.1 \
  PyYAML==6.0.2 setuptools==75.8.0 scikit-learn==1.6.1 scipy==1.13.1
git clone https://github.com/Yingjian-Chen/ForgeLens.git "$FORGELENS_ROOT/source"
git -C "$FORGELENS_ROOT/source" checkout --detach 9660c91d0c40dcdf3bef5155bd1c38ec866db13e
```

将发布方的 [GenImage 检查点](https://drive.google.com/file/d/1ZGmFPDJFtiJBxe3_mQGP_ZKPO_XXzjWc/view) 保存为 `weights/GenImage.pth`，将 [OpenAI ViT-L/14](https://openaipublic.azureedge.net/clip/models/b8cca3fd41ae0c99ba7e8951adf17d267cdb84cd88be6f7c2e0eca1737a03836/ViT-L-14.pt) 保存为 `weights/ViT-L-14.pt`。服务启动会验证源码提交与两份权重的 SHA-256。权重和数据集各自沿用发布方许可，运行只需这两份权重。

## 配置与启动

在服务脚本所在目录执行下列命令。将 `GPU-uuid` 替换为 `nvidia-smi -L` 显示的已分配 GPU UUID。

```bash
export FORGELENS_GPU=GPU-uuid
umask 077
python - <<'PY'
import json, os, secrets
from pathlib import Path

root = Path(os.environ["FORGELENS_ROOT"])
token = root / "service-token"
if not token.exists():
    token.write_text(secrets.token_urlsafe(48) + "\n")
token.chmod(0o600)
config = root / "service-config.json"
config.write_text(json.dumps({
    "source_dir": str(root / "source"),
    "checkpoint": str(root / "weights/GenImage.pth"),
    "clip_checkpoint": str(root / "weights/ViT-L-14.pt"),
    "token_file": str(token),
    "gpu_uuid": os.environ["FORGELENS_GPU"],
    "memory_fraction": 0.15,
    "port": 18085,
}, indent=2) + "\n")
config.chmod(0o600)
PY
python forgelens_service.py --config "$FORGELENS_ROOT/service-config.json"
```

另开终端执行 `curl --fail --silent http://127.0.0.1:18085/health`，应返回 `ready: true`。从本机通过回环转发访问，并将令牌填入图片服务配置的 `forgelens.token`。安排 GPU 时留出启动与推理峰值所需的显存。
