# FLAME 图片局部定位服务部署

在 Linux GPU 服务器运行独立服务，主项目留在本机。需要Python3.10（含venv）、Git、curl、兼容CUDA12.4的NVIDIA驱动。先确认 `python3.10 --version`、`nvidia-smi` 可用；以下使用分配GPU的编号示例0。

## 1. 独立环境

把本目录复制为服务器 `~/veritas-services/flame-service`，然后执行：

```bash
set -e
cd "$HOME/veritas-services/flame-service"
# Replace this example with a writable directory on a large data disk.
export VERITAS_MODEL_DATA=/path/to/data-disk/veritas
export FLAME_ROOT="$VERITAS_MODEL_DATA/flame"
export FLAME_GPU=0
umask 077
mkdir -p "$FLAME_ROOT/upstream" "$FLAME_ROOT/models/flame" "$FLAME_ROOT/models/sam2"
python3.10 -m venv "$FLAME_ROOT/venv"
source "$FLAME_ROOT/venv/bin/activate"
python -m pip install --upgrade pip
python -m pip install torch==2.6.0 torchvision==0.21.0 --index-url https://download.pytorch.org/whl/cu124
python -m pip install -r requirements.txt
```

## 2. 固定源码和安装骨干

```bash
git clone https://github.com/phoenixnir/FLAME.git "$FLAME_ROOT/upstream/flame"
git -C "$FLAME_ROOT/upstream/flame" checkout --detach 5d3d42f32934d64a898fd4fd05a815a9a3e32ebf
git clone https://github.com/facebookresearch/sam2.git "$FLAME_ROOT/upstream/sam2"
git -C "$FLAME_ROOT/upstream/sam2" checkout --detach 2b90b9f5ceec907a1c18123530e92e794ad901a4
SAM2_BUILD_CUDA=0 python -m pip install --no-build-isolation --no-deps -e "$FLAME_ROOT/upstream/sam2"
```

SAM2是本配置的必要骨干。上述安装禁用SAM2可选扩展编译，主体模型仍使用Torch CUDA推理。两份源码保持固定提交且没有已跟踪修改。来源：[FLAME](https://github.com/phoenixnir/FLAME)、[SAM2](https://github.com/facebookresearch/sam2)。已有目录应核对版本后复用，不覆盖正在运行的源码。

## 3. 资源下载与校验

```bash
curl --fail --location --retry 3 --continue-at - \
  https://github.com/phoenixnir/FLAME/releases/download/v0.1.0/flame_g2_ladmulti_sam2.pth \
  --output "$FLAME_ROOT/models/flame/flame_g2_ladmulti_sam2.pth"
curl --fail --location --retry 3 \
  https://github.com/phoenixnir/FLAME/releases/download/v0.1.0/model_params.json \
  --output "$FLAME_ROOT/models/flame/model_params.json"
curl --fail --location --retry 3 --continue-at - \
  https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_base_plus.pt \
  --output "$FLAME_ROOT/models/sam2/sam2.1_hiera_base_plus.pt"
python - <<'PY'
import hashlib, os
from pathlib import Path
root = Path(os.environ['FLAME_ROOT']) / 'models'
expected = {
    'flame/model_params.json': 'e46391983ca732313d1dc306e14ef3799c67a5bdf899a54a5fac8fef7e87ed42',
    'flame/flame_g2_ladmulti_sam2.pth': '9b6c67e3c35f647a3c9207275b1f1406c36780a2a3e0ee6b0f696d82161991bb',
    'sam2/sam2.1_hiera_base_plus.pt': 'a2345aede8715ab1d5d31b4a509fb160c5a4af1970f199d9054ccfb746c004c5',
}
for name, sha in expected.items():
    digest = hashlib.sha256()
    with (root / name).open('rb') as source:
        for block in iter(lambda: source.read(8 * 1024 * 1024), b''):
            digest.update(block)
    assert digest.hexdigest() == sha, f'Checksum mismatch: {name}'
print('FLAME assets verified')
PY
```

FLAME权重和配置来自 [v0.1.0发布页](https://github.com/phoenixnir/FLAME/releases/tag/v0.1.0)，SAM2骨干来自其官方检查点下载地址。源码和权重沿用各发布方许可。

## 4. 令牌与配置

```bash
python - <<'PY'
import json, os, secrets
from pathlib import Path
root = Path(os.environ['FLAME_ROOT'])
token = root / 'service-token'
if not token.exists():
    with token.open('x') as output:
        output.write(secrets.token_urlsafe(48) + '\n')
os.chmod(token, 0o600)
config = {'host': '127.0.0.1', 'port': 18083,
    'assets_root': str(root), 'token_file': str(token),
    'gpu_uuid': os.environ['FLAME_GPU'], 'memory_fraction': 0.12}
path = root / 'service.json'
path.write_text(json.dumps(config, indent=2) + '\n')
os.chmod(path, 0o600)
print('FLAME configuration prepared')
PY
```

字段见 [config.example.json](config.example.json)。显存预算是GPU总显存的比例，最大0.15，启动至少需要4 GiB空闲；实际可运行容量还取决于所选GPU与其他占用。令牌至少32字符、权限0600。

## 5. 启动与确认

```bash
python flame_service.py --config "$FLAME_ROOT/service.json"
```

出现 `ready` 后，在服务器另一终端执行：

```bash
curl --fail --silent --show-error http://127.0.0.1:18083/health
```

应返回 `ready: true`。后台运行先结束前台进程，再执行：

```bash
nohup "$FLAME_ROOT/venv/bin/python" -u flame_service.py \
  --config "$FLAME_ROOT/service.json" > "$FLAME_ROOT/service.log" 2>&1 &
```

服务只监听回环18083；`POST /v1/localize` 要求Bearer鉴权和原图字节，返回原图摘要、方向尺寸及512×512掩码。采用FP16推理和0.5像素阈值；本机后端在同图CO-SPY来源分数达到0.5后调用，标记只供人工复核。

本机连接、配置及端到端验证见 [图片工作包设计](../../openspec/changes/add-image-refund/design.md#本机联调步骤)。连接失败先查 `service.log`、GPU余量和资源摘要，再检查SSH转发与令牌是否一致。
