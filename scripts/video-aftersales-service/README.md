# Native-Scale 视频来源服务部署

服务仅运行在Linux GPU服务器；主程序继续在本机运行。需要Python3.10（含venv）、Git和兼容CUDA12.4的NVIDIA驱动。先确认 `python3.10 --version`、`nvidia-smi` 可用；在分配的GPU上执行。

## 1. 独立环境与目录

将本目录复制为服务器 `~/veritas-services/video-aftersales-service` 后执行：

```bash
set -e
cd "$HOME/veritas-services/video-aftersales-service"
export VIDEO_SERVICE_ROOT="$HOME/.local/share/veritas/native-scale"
export NATIVE_GPU=0
umask 077
mkdir -p "$VIDEO_SERVICE_ROOT/upstream" "$VIDEO_SERVICE_ROOT/state"
python3.10 -m venv "$VIDEO_SERVICE_ROOT/venv"
source "$VIDEO_SERVICE_ROOT/venv/bin/activate"
python -m pip install --upgrade pip
python -m pip install torch==2.6.0 torchvision==0.21.0 --index-url https://download.pytorch.org/whl/cu124
python -m pip install -r requirements.txt
```

[requirements.txt](requirements.txt) 固定当前核心环境：Torch2.6、torchvision0.21、Transformers5.20.2、Decord0.6。使用独立虚拟环境，不与图片模型共用Transformers安装。

## 2. 固定源码

```bash
git clone https://github.com/mgiant/Qwen2.5ViT-AIGVDetection.git "$VIDEO_SERVICE_ROOT/upstream/native-scale"
git -C "$VIDEO_SERVICE_ROOT/upstream/native-scale" checkout --detach f313500bc6f75a0fc53f01609c38912f36880247
```

来源为 [Native-Scale官方实现](https://github.com/mgiant/Qwen2.5ViT-AIGVDetection)，使用448p完整SFT权重。

## 3. 下载和检查资产

```bash
python download_assets.py
```

下载器支持续传，启动前检查至少8 GiB可用磁盘；还需为Python环境预留空间。可通过 `VIDEO_DOWNLOAD_PROXY` 指定实际可用的下载代理，默认使用标准网络环境。完成后资源目录为：

```text
VIDEO_SERVICE_ROOT/
  upstream/native-scale/
  weights/native-scale-448p.pth
  weights/Qwen2.5-VL-3B-Instruct/config.json
  weights/Qwen2.5-VL-3B-Instruct/preprocessor_config.json
  state/weight-ledger.json
  state/downloads-complete
```

如发布快照包含 `video_preprocessor_config.json`，下载器也会保留。Qwen配置来自 [Qwen/Qwen2.5-VL-3B-Instruct](https://huggingface.co/Qwen/Qwen2.5-VL-3B-Instruct)，固定修订 `66285546d2b821cf421d4f5eb2576359d3770cd3`。检测权重入口使用官方仓库发布的文件ID，SHA-256为 `80d17c909120a5d025fa03fa7d8c6ac70df313115cab3d5f82fc57a1ce772429`；该摘要是下载文件的审计记录，不是发布方签名。

完整SFT权重覆盖视觉网络和检测头，因此只准备Qwen模型结构与处理配置，无需底座初始化分片。源码与模型资源沿用发布方的使用条件。下载失败查看 `state/download-progress.json`；修复网络后重跑，只有全部校验通过才继续启动。

## 4. 私有令牌

```bash
python - <<'PY'
import os, secrets
from pathlib import Path
path = Path(os.environ['VIDEO_SERVICE_ROOT']) / 'state/service-token'
if not path.exists():
    with path.open('x') as output:
        output.write(secrets.token_urlsafe(48) + '\n')
os.chmod(path, 0o600)
print('Native-Scale service token prepared')
PY
```

令牌至少32字符，权限0600；本机调用服务时使用同一个令牌。令牌和模型目录均不放入仓库。

## 5. 启动与确认

```bash
CUDA_VISIBLE_DEVICES="$NATIVE_GPU" python inference_service.py --kind native --port 18084
```

日志出现 `ready` 后，在服务器另一终端执行：

```bash
curl --fail --silent --show-error http://127.0.0.1:18084/health
```

应返回 `ready: true`、`kind: native`、`strict_checkpoint: true`。服务启动严格加载完整参数；缺失或多余参数会失败。显存预算为所选GPU总显存的0.45，推理串行执行。

需要后台运行时，先结束前台进程，再执行：

```bash
CUDA_VISIBLE_DEVICES="$NATIVE_GPU" nohup "$VIDEO_SERVICE_ROOT/venv/bin/python" -u inference_service.py \
  --kind native --port 18084 > "$VIDEO_SERVICE_ROOT/service.log" 2>&1 &
```

服务只监听回环18084。`POST /v1/analyze` 与 `POST /v1/frames` 要求Bearer凭据，接收原视频二进制；输入上限200 MiB、10分钟、最长边4096像素。临时文件在请求结束后清理，异常退出遗留材料在重启时清理。正常推理不再需要下载代理。

## 6. 本机连接与结果

本机的服务目录复制、SSH转发、FFprobe、私有配置和网页验证见 [视频工作包设计](../../openspec/changes/add-video-aftersales/design.md#本机联调步骤)。

中心片段约每秒2帧、最多8帧；长视频增加均匀位置，最多9个片段。来源接口返回实际采样时间和最高片段分数；画面接口提供最多8个带时间戳的画面供本机DeepSeek核对。只分析采样范围，分数不是造假概率；商品核对不产生退款裁决。
