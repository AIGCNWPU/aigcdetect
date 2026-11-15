# CO-SPY 图片来源服务部署

在 Linux GPU 服务器执行以下步骤。本目录包含独立模型服务；主项目继续在本机运行。准备 Python 3.10（含 venv）、Git、curl 和可用的 NVIDIA 驱动，先确认 `python3.10 --version`、`nvidia-smi` 正常。以下目录均在仓库之外，GPU编号示例为0，应改为实际分配设备。

## 1. 环境和目录

本机将本目录复制到服务器 `~/veritas-services/cospy-service` 后，在服务器执行：

```bash
set -e
cd "$HOME/veritas-services/cospy-service"
# Replace this example with a writable directory on a large data disk.
export VERITAS_MODEL_DATA=/path/to/data-disk/veritas
export COSPY_ROOT="$VERITAS_MODEL_DATA/cospy"
export COSPY_GPU=0
umask 077
mkdir -p "$COSPY_ROOT/upstream" "$COSPY_ROOT/weights/progan" "$COSPY_ROOT/weights/clip"
python3.10 -m venv "$COSPY_ROOT/venv"
source "$COSPY_ROOT/venv/bin/activate"
python -m pip install --upgrade pip
python -m pip install torch==2.6.0 torchvision==0.21.0 --index-url https://download.pytorch.org/whl/cu124
python -m pip install -r requirements.txt
```

已运行环境为Python3.10、Torch2.6、torchvision0.21、CUDA12.4；核心依赖固定在 [requirements.txt](requirements.txt)。CUDA12.4轮子要求兼容的驱动。与其他模型使用不同虚拟环境。

## 2. 固定源码

首次部署执行；已有目录应先核对版本，不覆盖正在使用的文件。

```bash
git clone https://github.com/Megum1/CO-SPY.git "$COSPY_ROOT/upstream/CO-SPY"
git -C "$COSPY_ROOT/upstream/CO-SPY" checkout --detach 310d048387edaf11f236ed1c7180d0e1e823250f
```

源码来自 [CO-SPY 官方仓库](https://github.com/Megum1/CO-SPY)，本服务采用ProGAN配置。

## 3. 权重与骨干

仅准备推理资产，无需下载完整数据集。下载发布方 [ProGAN 权重](https://huggingface.co/ruojiruoli/Co-Spy-Pretrained-Weights)：

```bash
curl --fail --location --retry 3 --continue-at - \
  https://huggingface.co/ruojiruoli/Co-Spy-Pretrained-Weights/resolve/main/progan.zip \
  --output "$COSPY_ROOT/progan.zip"
python - <<'PY'
import os, shutil, hashlib, zipfile
from pathlib import Path, PurePosixPath
from huggingface_hub import snapshot_download
root = Path(os.environ['COSPY_ROOT'])
expected = {
    'artifact_weights.pth': '76b4c13d37ee6a03d43986a3b9c76775e4cf5543c2b104bbde58ba7553929c26',
    'fusion_weights.pth': '791ce1beecb95899c856056a55526f0e1054db8ddaebb3983af5ff43ea8cdb83',
    'semantic_weights.pth': 'd4076d7e0522bfb4c5921ea85b63ba22b2d4d96a3d6d0d676fc247d502a30b7a',
}
def digest(path):
    with path.open('rb') as source:
        value = hashlib.sha256()
        for block in iter(lambda: source.read(8 * 1024 * 1024), b''):
            value.update(block)
        return value.hexdigest()
with zipfile.ZipFile(root / 'progan.zip') as archive:
    for name, sha in expected.items():
        matches = [i for i in archive.infolist() if not i.is_dir() and PurePosixPath(i.filename).name == name and '__MACOSX' not in i.filename]
        assert len(matches) == 1, f'Unexpected archive layout: {name}'
        target = root / 'weights/progan' / name
        with archive.open(matches[0]) as source, target.open('wb') as output:
            shutil.copyfileobj(source, output)
        assert digest(target) == sha, f'Checksum mismatch: {name}'
snapshot_download('openai/clip-vit-large-patch14',
    revision='32bd64288804d66eefd0ccbe215aa642df71cc41',
    allow_patterns=['config.json', 'preprocessor_config.json', 'model.safetensors'],
    local_dir=str(root / 'weights/clip'))
assert digest(root / 'weights/clip/model.safetensors') == 'a2bf730a0c7debf160f7a6b50b3aaf3703e7e88ac73de7a314903141db026dcb'
print('CO-SPY assets verified')
PY
```

CLIP来自 [openai/clip-vit-large-patch14](https://huggingface.co/openai/clip-vit-large-patch14)。上述摘要与服务代码一致；服务启动还会核对源码修订和实际加载参数。源码、骨干、权重分别沿用发布方许可。

## 4. 令牌与配置

```bash
python - <<'PY'
import json, os, secrets
from pathlib import Path
root = Path(os.environ['COSPY_ROOT'])
token = root / 'service-token'
if not token.exists():
    with token.open('x') as output:
        output.write(secrets.token_urlsafe(48) + '\n')
os.chmod(token, 0o600)
config = {
    'host': '127.0.0.1', 'port': 18082,
    'source_dir': str(root / 'upstream/CO-SPY'),
    'weights_dir': str(root / 'weights/progan'),
    'clip_dir': str(root / 'weights/clip'),
    'token_file': str(token), 'gpu_uuid': os.environ['COSPY_GPU'],
    'memory_fraction': 0.15,
}
path = root / 'service.json'
path.write_text(json.dumps(config, indent=2) + '\n')
os.chmod(path, 0o600)
print('CO-SPY configuration prepared')
PY
```

配置字段见 [config.example.json](config.example.json)。令牌至少32字符；本机后端使用同一个令牌。显存预算为所选GPU总显存的比例，最大0.25；启动要求至少3 GiB空闲显存，须按实际设备容量验证。

## 5. 启动与确认

```bash
python cospy_service.py --config "$COSPY_ROOT/service.json"
```

终端出现 `ready` 后，在服务器另一个终端确认：

```bash
curl --fail --silent --show-error http://127.0.0.1:18082/health
```

应返回 `ready: true`。需要后台运行时，先结束前台进程，再执行：

```bash
nohup "$COSPY_ROOT/venv/bin/python" -u cospy_service.py \
  --config "$COSPY_ROOT/service.json" > "$COSPY_ROOT/service.log" 2>&1 &
```

日志位于模型目录的 `service.log`。`POST /v1/detect` 接收原始JPEG/PNG/WebP字节，要求Bearer鉴权；预处理为方向校正、透明背景归一化、短边256和中心224裁剪。只返回来源信号及部分覆盖，不提供局部位置。

本机的文件复制、SSH转发、私有配置和网页联调见 [图片工作包设计](../../openspec/changes/add-image-refund/design.md#本机联调步骤)。下载失败可在可访问发布地址的机器准备相同资产后安全复制到上述路径，仍须通过摘要校验。
