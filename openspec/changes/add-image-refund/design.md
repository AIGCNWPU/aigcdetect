# Design

## Context

需求章节：2.2 仅退款与售后AI凭证检测。工作包负责人：④ 闭耀松。

本模块使用原生JavaScript前端、本机Node服务及独立模型服务。职责与共享文件边界见[团队分工](../../../docs/TEAM_DEVELOPMENT.md)，失败、材料修订与覆盖范围遵循[公共约定](../define-shared-foundation/specs/shared-foundation/spec.md)。当前只处理本次上传，共享权限和跨场景集成保持未完成。

## Decisions

## 当前流程

填写案件编号、商品名称、款式、商品资料与问题描述，选择图片并提交后自动进入“检测与核对”。按需运行图片来源检测、局部篡改检测和商品与描述核对，最后在“案件汇总”查看图表、逐图依据及下载 PDF。

支持 JPG、PNG、WebP，最多 10 张、单张 5 MiB、4000 万像素。浏览器检查可读性，本机校验字段、容器、尺寸与原文件 SHA-256。图片保留原字节，来源筛查的缩放和裁剪由模型服务处理。

## 能力与结果

| 能力 | 实现 | 结果边界 |
| --- | --- | --- |
| 来源检测 | 同图调用 ForgeLens、CO-SPY ProGAN、DEAR-C，将三路原始分数输入固定 Extra Trees | 三路结果须齐全且对应当前原图。综合分数用于来源筛查和人工复核 |
| 局部定位 | 三路融合分数达到 0.47332282007791726 后调用 FLAME。已有 CO-SPY 单路配置沿用 0.5 | 整图 512×512 推理，候选掩码映射至原图，分别展示未触发、无标记和失败 |
| 商品核对 | DeepSeek 核对外观、款式与问题现象 | 缺少参照或看不清时为无法判断；结果不完整或与原图不符则拒绝 |

局部标记支持显隐与 25%—75% 强度调节。汇总环图与商品核对矩阵使用当前全部材料，筛选只影响明细。PDF 包含原图、实际标记、完整状态及核对依据，使用中文字体、自动分页和品牌斜水印。固定融合参数随运行代码发布，推理无需训练或下载评测数据。

### C2PA 来源凭证

可在本机安装 [c2patool](https://opensource.contentauthenticity.org/docs/c2patool/)（联调版本 0.28.6），执行 `c2patool --version` 确认。若程序不在 PATH，可设置 `VERITAS_C2PATOOL` 指向可执行文件。开始分析后从当前上传的原文件读取内嵌声明，在来源结果和 PDF 中呈现可获取的生产方及 AI 相关声明。工具不可用或文件无凭证时仍运行模型。凭证作为独立来源依据，融合分数与定位门槛按模型结果计算。远程凭证和在线签名状态查询均关闭。

## 会话与接口

前缀 `/api/v1/image/refund`。`GET /status` 返回配置能力；`POST /sessions` 创建当前材料会话；`POST /jobs` 创建逐图逐能力任务，`GET /jobs/{id}` 查询，`POST /jobs/{id}/cancel` 取消，`POST /sessions/{id}/close` 结束会话。完整协议见 [OpenAPI](../../../docs/openapi.json)。

本机仅接受同源回环请求。会话只保存在有界内存中，最多 8 个、合计 200 MiB、30 分钟不活动过期。取消或关闭后丢弃迟到结果；修改资料使旧结果失效。服务重启不恢复当前材料。

## 模型与服务配置

图片售后使用以下服务。

| 能力 | 服务与部署说明 |
| --- | --- |
| 三路来源筛查 | [ForgeLens](../../../scripts/forgelens-service/README.md)（18085）、[CO-SPY](../../../scripts/cospy-service/README.md)（18082）、[DEAR-C](../../../scripts/dear-c-service/README.md)（18127） |
| 候选区域定位 | [FLAME 服务 README](../../../scripts/flame-service/README.md)，默认回环端口 18083 |
| 商品资料核对 | DeepSeek 多模态接口，地址、模型标识和密钥由服务端配置提供 |

使用 [本模块配置示例](../../../src/modules/image/refund/server/config.example.json)，将实际配置保存为用户目录下 `.config/veritas/image-refund.json`，权限设为 `600`；也可通过 `VERITAS_REFUND_CONFIG` 指定路径。私有凭据只由服务端读取，不进入浏览器。

各 GPU 服务使用独立的 Python 环境，按服务 README 准备固定版本的源码、权重和依赖。源码、权重和环境放在项目外的数据盘。多路服务会并行接收同一张图，应按实际分配的 GPU 和显存部署。

GPU 服务监听回环地址并校验 Bearer 凭据，通过下文的 SSH 本地转发访问。DeepSeek 的配置模型须支持图像输入。服务失联、缺少模型配置或输出缺项时，页面显示实际运行状态。

## 数据集与演示素材

四个预设提供资料一致、商品错配、真实照片和 AI 编辑图片输入，载入成功后可撤销。系统运行不依赖完整训练集或测试集，预设只加载资料和原始图片，模型结论由真实请求返回；素材标签不进入模型提示。

演示使用的杯身凹陷、刀身锈迹图片来自 [FraudBench](https://huggingface.co/datasets/TristanYan/FraudBench)，修订 `27d94c1a4c4b087845f8a8e916473cdd6a5c6011`，来源记录标注 CC-BY-NC-SA-4.0。图片保留原始字节，构建只复制，不缩放或重新压缩；两个样例不能用于推导业务准确率。

逐文件来源路径、摘要和标签见 [图片来源记录](../../../public/refund-demos/provenance.json)，素材目录保留 [README](../../../public/refund-demos/README.md)。

## 本机联调步骤

Linux GPU 主机运行三个来源检测服务和 FLAME。本机运行网页、Node 后端和商品资料核对。以下本机命令在项目根目录执行，服务器命令见各服务 README。

### 1. 复制模型服务目录

在本机设置实际SSH连接参数；这三个变量不包含密码。

```bash
export VERITAS_SSH_HOST=your_gpu_host
export VERITAS_SSH_PORT=22
export VERITAS_SSH_USER=your_user
ssh -p "$VERITAS_SSH_PORT" "$VERITAS_SSH_USER@$VERITAS_SSH_HOST" 'mkdir -p veritas-services'
scp -P "$VERITAS_SSH_PORT" -r scripts/cospy-service scripts/forgelens-service scripts/dear-c-service scripts/flame-service \
  "$VERITAS_SSH_USER@$VERITAS_SSH_HOST:veritas-services/"
```

在 GPU 主机按上面的四份服务 README 完成环境、固定源码、权重、私有令牌与启动。四项健康检查均应返回 `ready: true`。

### 2. 建立本机到模型的连接

在本机独立终端运行并保持开启：

```bash
ssh -N -p "$VERITAS_SSH_PORT" \
  -o ControlMaster=no -o ControlPath=none -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
  -L 127.0.0.1:18082:127.0.0.1:18082 \
  -L 127.0.0.1:18083:127.0.0.1:18083 \
  -L 127.0.0.1:18085:127.0.0.1:18085 \
  -L 127.0.0.1:18127:127.0.0.1:18127 \
  "$VERITAS_SSH_USER@$VERITAS_SSH_HOST"
```

若端口已经占用，先确认原有转发能否通过健康检查，避免重复启动。转发仅监听本机回环地址。

### 3. 准备本机私有配置

在本机另一个终端重新设置上述SSH变量，复制服务器生成的令牌。下例从数据盘复制令牌；VERITAS_REMOTE_MODEL_DATA须与模型README中的VERITAS_MODEL_DATA一致。

```bash
export VERITAS_REMOTE_MODEL_DATA=/path/to/data-disk/veritas
umask 077
mkdir -p "$HOME/.config/veritas"
for service in forgelens cospy dear-c flame; do
  scp -P "$VERITAS_SSH_PORT" \
    "$VERITAS_SSH_USER@$VERITAS_SSH_HOST:$VERITAS_REMOTE_MODEL_DATA/$service/service-token" \
    "$HOME/.config/veritas/$service-token"
done
python3 - <<'PY'
import getpass, json, os
from pathlib import Path
root = Path.home() / '.config/veritas'
path = root / 'image-refund.json'
previous = json.loads(path.read_text()) if path.exists() else {}
deepseek = previous.get('deepseek', {})
key = deepseek.get('key') or getpass.getpass('DeepSeek API key: ').strip()
if not key:
    raise SystemExit('A valid API key is required for product comparison')
config = {
    'aiProvider': 'forgelens',
    'forgelens': {'url': 'http://127.0.0.1:18085', 'token': (root / 'forgelens-token').read_text().strip()},
    'cospy': {'url': 'http://127.0.0.1:18082', 'token': (root / 'cospy-token').read_text().strip()},
    'dearC': {'url': 'http://127.0.0.1:18127', 'token': (root / 'dear-c-token').read_text().strip()},
    'flame': {'url': 'http://127.0.0.1:18083', 'token': (root / 'flame-token').read_text().strip()},
    'deepseek': {'url': deepseek.get('url', 'https://api.deepseek.com'),
        'model': deepseek.get('model', 'deepseek-flash'), 'key': key},
}
path.write_text(json.dumps(config, indent=2) + '\n')
for item in [path, *(root / f'{service}-token' for service in ('forgelens', 'cospy', 'dear-c', 'flame'))]:
    os.chmod(item, 0o600)
print('Image analysis configuration prepared')
PY
```

API密钥在终端中隐藏输入，不写入仓库示例。已有配置保留原DeepSeek地址、模型标识和密钥。当前联调使用 `deepseek-flash`；其他账号须配置实际可用且支持图片的模型。字段对照见 [配置示例](../../../src/modules/image/refund/server/config.example.json)。

### 4. 启动本机程序并验证

```bash
for port in 18082 18083 18085 18127; do
  curl --fail --silent --show-error "http://127.0.0.1:$port/health"
done
npm ci
npm run build
npm start
```

打开 `http://127.0.0.1:4173/#/image/refund`，加载AI编辑图片预设并提交，勾选来源检测、局部检测和商品核对后运行，确认三项有真实结果、原图标记可查看、汇总与PDF可用。再使用真实照片和商品错配预设核对状态与说明。服务能力接口 `GET /api/v1/image/refund/status` 只说明配置存在，不能替代实际请求验证。

### 5. 故障定位

| 现象 | 检查位置 |
| --- | --- |
| 本机健康接口连接失败 | 服务器模型日志、端口监听和本机SSH转发 |
| 模型返回401 | 本机配置token与服务器令牌文件是否一致 |
| 模型启动时摘要或源码版本错误 | 固定Git提交、权重路径和SHA-256，不能跳过校验 |
| GPU内存不足 | 实际分配GPU、空闲显存和配置中的显存比例 |
| 商品核对失败或不完整 | DeepSeek地址、图片能力、额度与完整JSON返回 |
| 更改配置后仍使用旧值 | 重启本机Node服务；模型配置变化时重启对应模型进程 |

## 来源与局部任务联动

选择来源检测且局部能力可用时，自动关联局部任务。局部任务依据同图固定来源门槛决定是否执行定位；未触发、失败和取消保持独立状态。原图对照、25%-75%显示强度和标记显隐只改变展示，不改变模型掩码。

## 交付说明

当前交付包括三路来源筛查、按同图分数触发候选定位、商品核对、来源凭证、原图复核及带斜水印的 PDF。

## 使用限制

检测分数与候选区域仅供人工复核；压缩、裁剪和低分辨率可能丢失检测线索。完整业务验收、阈值校准、跨场景公共集成及生产权限验收尚未完成。

服务联调使用已部署的模型环境，尚未在全新 GPU 主机从零完成安装验收；正式环境需按服务 README 完整验证。
