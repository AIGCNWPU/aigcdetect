# DEAR-C 图片来源服务

服务在 Linux GPU 主机运行，为图片三路融合返回固定配置的 DEAR-C 原始分数。部署时将本目录与同级的 [cospy-service](../cospy-service/README.md) 一起复制，复用图片 HTTP 处理器。

## 环境与资产

使用 Python 3.10、兼容 CUDA 12.4 的 NVIDIA 驱动，以及启动时至少有 9 GiB 空闲显存的 GPU。将源码、权重和虚拟环境放在有写权限的数据盘。

```bash
export DEAR_C_ROOT=/path/to/data-disk/veritas/dear-c
mkdir -p "$DEAR_C_ROOT/weights"
python3.10 -m venv "$DEAR_C_ROOT/venv"
source "$DEAR_C_ROOT/venv/bin/activate"
python -m pip install torch==2.6.0 torchvision==0.21.0 --index-url https://download.pytorch.org/whl/cu124
python -m pip install numpy==1.26.4 Pillow==11.1.0 tqdm==4.70.1
git clone https://github.com/anti-fake/dear.git "$DEAR_C_ROOT/source"
git -C "$DEAR_C_ROOT/source" checkout --detach 5e0dc665eee24b632c03be09a27a05319abc9e7f
curl --fail --location --retry 3 \
  https://huggingface.co/k-aisi-anti-deepfake/dear-checkpoints/resolve/main/dear_c/model_best.pth \
  --output "$DEAR_C_ROOT/weights/model_best.pth"
```

权重来自 [DEAR 发布方](https://huggingface.co/k-aisi-anti-deepfake/dear-checkpoints)。服务启动时核验 `dear/` 下 Python 源码的集合摘要和权重的 SHA-256，资产沿用发布方许可。无需下载训练或评测集。

## 配置与启动

在服务脚本所在目录执行下列命令。将 `GPU-uuid` 替换为 `nvidia-smi -L` 显示的已分配 GPU UUID。

```bash
export DEAR_C_GPU=GPU-uuid
umask 077
python - <<'PY'
import json, os, secrets
from pathlib import Path

root = Path(os.environ["DEAR_C_ROOT"])
token = root / "service-token"
if not token.exists():
    token.write_text(secrets.token_urlsafe(48) + "\n")
token.chmod(0o600)
config = root / "service-config.json"
config.write_text(json.dumps({
    "source_dir": str(root / "source"),
    "checkpoint": str(root / "weights/model_best.pth"),
    "token_file": str(token),
    "gpu_uuid": os.environ["DEAR_C_GPU"],
    "memory_fraction": 0.20,
    "port": 18127,
}, indent=2) + "\n")
config.chmod(0o600)
PY
python dear_c_service.py --config "$DEAR_C_ROOT/service-config.json"
```

另开终端执行 `curl --fail --silent http://127.0.0.1:18127/health`，应返回 `ready: true`。从本机通过回环转发访问，并将令牌填入图片服务配置的 `dearC.token`。
