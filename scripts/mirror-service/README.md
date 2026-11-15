# MIRROR 关键画面来源服务

仅部署独立模型服务，主项目继续在本机运行。接口为 `GET /health` 和 Bearer 鉴权的 `POST /v1/detect`，默认监听 `127.0.0.1:18081`。本服务返回图片来源信号；视频的完整画面、中心细节及时间关联由[关键画面服务](../video-aftersales-service/README.md#关键画面来源服务)处理。

## 1. 环境与数据盘

Linux、Python 3.10、Git、兼容 CUDA 12.4 的 NVIDIA 驱动。先确认 `python3.10 --version`、`nvidia-smi` 可用，并选择分配的 GPU。以下示例路径必须改成有写权限的数据盘目录，模型、环境和缓存不放在项目目录。

将本目录复制到服务器 `~/veritas-services/mirror-service`，在该目录执行：

```bash
export VERITAS_MODEL_DATA=/path/to/data-disk/veritas
export MIRROR_ROOT="$VERITAS_MODEL_DATA/mirror"
export MIRROR_GPU=0
umask 077
mkdir -p "$MIRROR_ROOT/upstream" "$MIRROR_ROOT/models" "$MIRROR_ROOT/state" "$MIRROR_ROOT/cache"
python3.10 -m venv "$MIRROR_ROOT/venv"
source "$MIRROR_ROOT/venv/bin/activate"
export XDG_CACHE_HOME="$MIRROR_ROOT/cache"
export HF_HOME="$MIRROR_ROOT/cache/huggingface"
python -m pip install torch==2.6.0 torchvision==0.21.0 --index-url https://download.pytorch.org/whl/cu124
python -m pip install -r requirements.txt
python -m pip install 'gdown>=5.2,<6'
```

MIRROR 固定 Transformers 4.57.1，与 Native-Scale 的环境分开。显存预算通过配置中的 `gpu_memory_fraction` 设置；启动检查所选 GPU 至少有 10 GiB 空闲。多模型部署须按实际设备分配 GPU 和预算。

## 2. 固定源码和检测权重

```bash
git clone https://github.com/handsome-rich/MIRROR.git "$MIRROR_ROOT/upstream/MIRROR"
git -C "$MIRROR_ROOT/upstream/MIRROR" checkout --detach 7f108fdd5c132e205df6f24954045cc9ba533361
python - <<'PY'
import gdown,os
from pathlib import Path
target=Path(os.environ['MIRROR_ROOT'])/'models/checkpoint-h-cur.pth'
if not gdown.download(id='1gos1QgZA4Xuj706oa5i5E6vsOAoaLyr3',output=str(target),use_cookies=False,resume=True):
    raise SystemExit('MIRROR checkpoint download failed')
PY
python - <<'PY'
import hashlib,json,os
from pathlib import Path
root=Path(os.environ['MIRROR_ROOT']);path=root/'models/checkpoint-h-cur.pth'
expected='829ef07b52caa26c1cb3917e603a275cfd1c7f494f7b750f86fb218710ac66d5'
digest=hashlib.sha256()
with path.open('rb') as stream:
    for block in iter(lambda:stream.read(8*1024**2),b''):digest.update(block)
assert digest.hexdigest()==expected,'Checkpoint checksum mismatch'
(root/'state/checkpoint-ledger.json').write_text(json.dumps({'target':str(path.resolve()),'sha256':expected},indent=2)+'\n')
print('MIRROR checkpoint verified')
PY
```

下载入口来自[发布方固定源码说明](https://github.com/handsome-rich/MIRROR/tree/7f108fdd5c132e205df6f24954045cc9ba533361)。代码、权重及骨干沿用发布方的许可和使用条件。源码目录须处于固定提交且无额外修改，模型资源放在该 Git 目录之外。

## 3. 准备推理初始化骨干

完整检测权重包含骨干张量。本目录的转换工具从固定检查点导出 HF 格式初始化骨干，严格核对全部骨干参数；检测服务随后再次加载完整检查点，包括其检测头、记忆与适配参数。该步骤不训练模型，也不重新初始化缺失权重。

```bash
python extract_backbone.py \
  --checkpoint "$MIRROR_ROOT/models/checkpoint-h-cur.pth" \
  --ledger "$MIRROR_ROOT/state/checkpoint-ledger.json" \
  --output "$MIRROR_ROOT/models/backbone-h-plus" \
  --report "$MIRROR_ROOT/state/backbone-extraction.json"
```

输出目录必须尚不存在，防止覆盖已运行的模型资产。磁盘需同时容纳检查点、转换骨干和独立 Python 环境。

## 4. 私有配置与启动

```bash
python - <<'PY'
import json,os,secrets
from pathlib import Path
root=Path(os.environ['MIRROR_ROOT']);token=root/'service-token'
if not token.exists():token.write_text(secrets.token_urlsafe(48)+'\n')
token.chmod(0o600)
config={'source_dir':str(root/'upstream/MIRROR'),'checkpoint':str(root/'models/checkpoint-h-cur.pth'),
        'backbone':str(root/'models/backbone-h-plus'),'gpu':os.environ['MIRROR_GPU'],
        'gpu_memory_fraction':0.25,'host':'127.0.0.1','port':18081,'token_file':str(token)}
path=root/'service.json';path.write_text(json.dumps(config,indent=2)+'\n');path.chmod(0o600)
print('MIRROR configuration prepared')
PY
python mirror_service.py --config "$MIRROR_ROOT/service.json"
```

在另一个终端运行 `curl --fail --silent --show-error http://127.0.0.1:18081/health`，确认 `ready: true`。字段参见[配置示例](config.example.json)。凭据只在服务器与本机后端之间使用，不进入前端包。

预处理保留方向校正、透明背景白底、发布方缩放与中心裁剪，以及 PNG 的内部 JPEG96 转换，使用 FP32 推理。来源分数未经业务概率校准；本接口不输出商品损坏位置，也不自动裁决退款。
