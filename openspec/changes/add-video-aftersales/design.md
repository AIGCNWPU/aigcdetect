# Design

## Context

需求章节：3.3 售后与退货AI视频凭证检测。工作包负责人：④ 闭耀松。

本模块使用原生JavaScript前端、本机Node服务及独立模型服务。职责与共享文件边界见[团队分工](../../../docs/TEAM_DEVELOPMENT.md)，失败、材料修订与覆盖范围遵循[公共约定](../define-shared-foundation/specs/shared-foundation/spec.md)。当前只处理本次上传，共享权限和跨场景集成保持未完成。

## Decisions

## 当前流程

填写案件与商品资料、上传原视频，提交后进入检测页。AI 来源检测由 Native-Scale 完成；商品与问题核对由 DeepSeek 完成。结果分别显示，点击依据时间可定位并暂停原视频，从“本次汇总”筛选和回看当前材料。

支持 MP4、WebM，最多 5 段、单段 200 MiB、10 分钟、最长边 4096 像素。浏览器检查可播放性，本机通过 FFprobe 检查实际容器、时长与尺寸。视频以二进制原字节上传，结果校验视频编号、版本及 SHA-256。

## 来源分析与商品核对

Native-Scale 使用 448p 配置和中心 8 帧采样，较长视频补充均匀位置，最多 9 个片段。返回采样片段最高分、各片段时间和实际覆盖说明。0.5 为当前筛查提示阈值，0.8 为较高提示值；分数未经过售后业务校准，不是欺诈概率。

商品核对从原视频取得最多 8 个带时间戳的画面，比较商品外观、款式和问题现象。DeepSeek 只可引用实际提供画面的序号；服务端映射成原视频时间。缺少款式参照时只能返回无法判断。抽样未覆盖的动作、声音与损坏原因不补写结论。

当前视频功能是来源分析与资料核对，不提供逐帧覆盖、商品像素定位、声音分析或自动退款裁决。失败、取消、无法判断与部分覆盖保持独立状态。

## 会话与接口

前缀 `/api/v1/video/aftersales`；会话创建、原字节上传、任务创建、查询、取消与关闭见 [OpenAPI](../../../docs/openapi.json)。临时会话最多 3 个、合计 1 GiB，30 分钟不活动清理；同时上传最多 2 个，分析串行排队、单项上限 5 分钟。

视频只在当前会话的临时目录中处理，关闭或过期后清理；重启清理退出进程留下的临时目录。材料修改和离开页面取消旧任务，迟到响应不会覆盖新数据。不提供历史案件回看。

## 模型与服务配置

| 能力 | 服务与部署说明 |
| --- | --- |
| 视频来源分析 | [Native-Scale 服务 README](../../../scripts/video-aftersales-service/README.md)，448p 配置，默认回环端口 18084 |
| 商品资料核对 | DeepSeek 多模态接口，仅核对实际抽取的画面与填写资料 |

本机安装 FFprobe。使用 [本模块配置示例](../../../src/modules/video/aftersales/server/config.example.json)，将实际配置保存为用户目录下 `.config/veritas/video-aftersales.json`，权限设为 `600`；也可通过 `VERITAS_VIDEO_CONFIG` 指定路径。视频配置未提供 DeepSeek 时，读取图片配置中的同名字段。服务地址、支持图片输入的模型标识和私有凭据只由服务端读取。

Native-Scale 独立运行在 Linux CUDA GPU 环境，使用 Python 3.10。源码修订、448p 权重摘要、Qwen 配置版本及依赖安装见服务 README。模型资源放在项目外，不随仓库提交；第三方代码、骨干和权重沿用发布方的许可与使用条件。该服务使用独立虚拟环境，不与图片模型混用依赖。

推理接口只监听回环地址并验证 Bearer 凭据。远程部署可使用 `ssh -N -L 127.0.0.1:18084:127.0.0.1:18084 user@gpu-host` 供本机调用，转发在分析期间保持运行。GPU 选择和显存预算按实际分配配置。模型无法读取或处理文件时返回失败，商品核对不替代来源分析。

## 数据集与演示素材

系统运行不依赖完整训练集或测试集。两组一键预设只载入原视频与商品资料，检测结果由真实服务返回。

| 素材 | 来源 | 标签与使用范围 |
| --- | --- | --- |
| 陶罐破碎模拟视频 | [VideoPhy-2 测试集](https://huggingface.co/datasets/videophysics/videophy2_test) | 明确标注为 AI 生成的模拟素材；数据集卡标注 MIT |
| 紫砂壶报道片段 | [上观新闻报道](https://www.shobserver.com/wx/detail.do?id=1020808) | 报道场景演示，未取得原始生成记录，不能作为严格真假标注；版权与使用条件由原发布方保留 |

逐文件来源、SHA-256 和演示资料见 [视频来源记录](../../../public/video-aftersales-demos/sources.json)，素材目录保留 [README](../../../public/video-aftersales-demos/README.md)。构建只复制原文件，不重新编码；样例不能用于推导业务准确率。

## 本机联调步骤

服务器只运行Native-Scale及原视频抽帧；本机运行网页、Node后端、FFprobe校验和DeepSeek商品核对。以下本机步骤在项目根目录执行。

### 1. 复制并部署模型服务

```bash
export VERITAS_SSH_HOST=your_gpu_host
export VERITAS_SSH_PORT=22
export VERITAS_SSH_USER=your_user
ssh -p "$VERITAS_SSH_PORT" "$VERITAS_SSH_USER@$VERITAS_SSH_HOST" 'mkdir -p veritas-services'
scp -P "$VERITAS_SSH_PORT" -r scripts/video-aftersales-service \
  "$VERITAS_SSH_USER@$VERITAS_SSH_HOST:veritas-services/"
```

登录服务器并完整执行 [Native-Scale部署步骤](../../../scripts/video-aftersales-service/README.md)：建立独立环境、检出固定源码、下载并校验448p权重和Qwen配置、创建令牌，再启动模型服务。服务器 `http://127.0.0.1:18084/health` 应返回 `ready: true`。

### 2. 建立本机连接

在本机独立终端运行并保持开启：

```bash
ssh -N -p "$VERITAS_SSH_PORT" \
  -o ControlMaster=no -o ControlPath=none -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
  -L 127.0.0.1:18084:127.0.0.1:18084 \
  "$VERITAS_SSH_USER@$VERITAS_SSH_HOST"
```

已有可用转发时不重复绑定同一端口。应用与模型都通过回环地址通信，服务器不需要启动整个主项目。

### 3. 配置本机服务

在另一个本机终端重新设置SSH变量，复制令牌并生成配置：

```bash
umask 077
mkdir -p "$HOME/.config/veritas"
scp -P "$VERITAS_SSH_PORT" \
  "$VERITAS_SSH_USER@$VERITAS_SSH_HOST:.local/share/veritas/native-scale/state/service-token" \
  "$HOME/.config/veritas/native-token"
python3 - <<'PY'
import getpass, json, os
from pathlib import Path
root = Path.home() / '.config/veritas'
path = root / 'video-aftersales.json'
previous = json.loads(path.read_text()) if path.exists() else {}
image_path = root / 'image-refund.json'
image = json.loads(image_path.read_text()) if image_path.exists() else {}
deepseek = previous.get('deepseek') or image.get('deepseek') or {}
key = deepseek.get('key') or getpass.getpass('DeepSeek API key: ').strip()
if not key:
    raise SystemExit('A valid API key is required for product comparison')
config = {
    'native': {'url': 'http://127.0.0.1:18084', 'token': (root / 'native-token').read_text().strip()},
    'deepseek': {'url': deepseek.get('url', 'https://api.deepseek.com'),
        'model': deepseek.get('model', 'deepseek-flash'), 'key': key},
}
path.write_text(json.dumps(config, indent=2) + '\n')
for item in [path, root / 'native-token']:
    os.chmod(item, 0o600)
print('Video analysis configuration prepared')
PY
```

已有图片配置时会复用DeepSeek设置。API密钥隐藏输入，文件权限0600；[配置示例](../../../src/modules/video/aftersales/server/config.example.json) 仅含占位值，不含实际凭据。

### 4. 本机依赖与启动

本机需要Node.js20及以上和FFprobe。macOS已安装Homebrew时可执行 `brew install ffmpeg`，然后确认 `ffprobe -version` 正常；其他安装位置通过 `VERITAS_FFPROBE` 指向可执行文件。

```bash
ffprobe -version
curl --fail --silent --show-error http://127.0.0.1:18084/health
npm ci
npm run build
npm start
```

打开 `http://127.0.0.1:4173/#/video/aftersales`，载入陶罐模拟视频并提交，运行来源分析与商品核对。确认两项均取得实际结果，点击采样位置能定位并暂停原视频，再到本次汇总复核。也可加载报道片段观察模型实际响应，不预设检测结论。`GET /api/v1/video/aftersales/status` 只检查配置状态，最终仍以真实请求为准。

### 5. 故障定位

| 现象 | 检查位置 |
| --- | --- |
| 上传时提示无法读取元数据 | 本机FFprobe路径、视频容器、时长、尺寸与完整性 |
| 来源服务无法连接 | 服务器日志、18084监听和本机SSH转发 |
| 返回401 | 本机native token与服务器令牌文件是否一致 |
| 不能加载权重或出现缺失参数 | 固定Git版本、448p权重摘要和Qwen配置目录 |
| 商品核对失败 | DeepSeek图片能力、地址、额度及输出完整性 |
| 配置修改未生效 | 重启本机Node服务；模型环境变化时重启服务器模型进程 |

## 交付说明

已交付视频来源分析、商品核对、原视频时间定位与当前汇总，并完成现有模型服务联调。构建、现有回归、接口、文档与 OpenSpec 检查通过，部署命令已校验。

## 使用限制

来源分析与商品核对仅覆盖实际采样范围，不能据此认定整段视频真实或直接作出退款决定。完整业务验收、阈值校准、跨场景公共集成及生产权限隔离尚未完成。

服务联调使用已部署的模型环境，尚未在全新 GPU 主机从零完成安装验收；正式环境需按服务 README 完整验证。
