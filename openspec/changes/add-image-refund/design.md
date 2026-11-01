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
| 来源检测 | CO-SPY ProGAN，短边 256、中心 224 视图 | 展示未校准来源分数和部分覆盖；低分不能证明整图真实 |
| 局部定位 | 同图来源分数达到 0.5 后调用 FLAME | 整图 512×512 推理，候选掩码映射至原图；未触发、无标记、失败分别展示 |
| 商品核对 | DeepSeek 核对外观、款式与问题现象 | 缺少参照或看不清时为无法判断；结果不完整或与原图不符则拒绝 |

局部标记支持显隐与 25%—75% 强度调节，不统计篡改处数。汇总环图与商品核对矩阵使用当前全部材料，筛选只影响明细。PDF 包含原图、实际标记、完整状态及核对依据，支持中文及长内容续页；界面和 PDF 不显示算法名。

## 会话与接口

前缀 `/api/v1/image/refund`。`GET /status` 返回配置能力；`POST /sessions` 创建当前材料会话；`POST /jobs` 创建逐图逐能力任务，`GET /jobs/{id}` 查询，`POST /jobs/{id}/cancel` 取消，`POST /sessions/{id}/close` 结束会话。完整协议见 [OpenAPI](../../../docs/openapi.json)。

本机仅接受同源回环请求。会话只保存在有界内存中，最多 8 个、合计 200 MiB、30 分钟不活动过期。取消或关闭后丢弃迟到结果；修改资料使旧结果失效。服务重启不恢复当前材料。

## 模型与服务配置

图片售后使用两个独立 GPU 服务和一个多模态接口：

| 能力 | 服务与部署说明 |
| --- | --- |
| 图片来源筛查 | [CO-SPY 服务 README](../../../scripts/cospy-service/README.md)，默认回环端口 18082 |
| 候选区域定位 | [FLAME 服务 README](../../../scripts/flame-service/README.md)，默认回环端口 18083 |
| 商品资料核对 | DeepSeek 多模态接口，地址、模型标识和密钥由服务端配置提供 |

使用 [本模块配置示例](../../../src/modules/image/refund/server/config.example.json)，将实际配置保存为用户目录下 `.config/veritas/image-refund.json`，权限设为 `600`；也可通过 `VERITAS_REFUND_CONFIG` 指定路径。私有凭据只由服务端读取，不进入浏览器。

两个 GPU 服务使用各自独立的 Python 3.10 环境，按服务 README 准备固定版本的源码、权重和依赖，并校验 SHA-256。源码与权重放在项目外，GPU 设备与显存预算按实际分配配置。本仓库保留接口代码、配置示例和来源，不包含模型权重；第三方代码和权重沿用发布方的许可与使用条件。

服务仅监听回环地址并校验 Bearer 凭据。远程部署时，本机通过 SSH 本地转发调用，例如 `ssh -N -L 127.0.0.1:18082:127.0.0.1:18082 -L 127.0.0.1:18083:127.0.0.1:18083 user@gpu-host`，访问转发需在分析期间保持运行。DeepSeek 的配置模型须支持图片输入；未配置、服务失联或输出缺项均显示实际状态，不生成替代结果。

## 数据集与演示素材

四个预设提供资料一致、商品错配、真实照片和 AI 编辑图片输入，载入成功后可撤销。系统运行不依赖完整训练集或测试集，预设只加载资料和原始图片，模型结论由真实请求返回；素材标签不进入模型提示。

演示使用的杯身凹陷、刀身锈迹图片来自 [FraudBench](https://huggingface.co/datasets/TristanYan/FraudBench)，修订 `27d94c1a4c4b087845f8a8e916473cdd6a5c6011`，来源记录标注 CC-BY-NC-SA-4.0。图片保留原始字节，构建只复制，不缩放或重新压缩；两个样例不能用于推导业务准确率。

逐文件来源路径、摘要和标签见 [图片来源记录](../../../public/refund-demos/provenance.json)，素材目录保留 [README](../../../public/refund-demos/README.md)。

## 本机联调步骤

部署分为两端：服务器只运行 CO-SPY 与 FLAME；本机运行网页、Node后端和DeepSeek资料核对。以下本机命令在项目根目录执行，服务器安装命令在对应服务README中执行。

### 1. 复制模型服务目录

在本机设置实际SSH连接参数；这三个变量不包含密码。

```bash
export VERITAS_SSH_HOST=your_gpu_host
export VERITAS_SSH_PORT=22
export VERITAS_SSH_USER=your_user
ssh -p "$VERITAS_SSH_PORT" "$VERITAS_SSH_USER@$VERITAS_SSH_HOST" 'mkdir -p veritas-services'
scp -P "$VERITAS_SSH_PORT" -r scripts/cospy-service scripts/flame-service \
  "$VERITAS_SSH_USER@$VERITAS_SSH_HOST:veritas-services/"
```

只复制模型服务目录，不迁移主程序。随后登录服务器，分别按 [CO-SPY部署步骤](../../../scripts/cospy-service/README.md) 和 [FLAME部署步骤](../../../scripts/flame-service/README.md) 完成环境、固定源码、权重校验、私有令牌和启动。两项服务器健康检查都应返回 `ready: true`。

### 2. 建立本机到模型的连接

在本机独立终端运行并保持开启：

```bash
ssh -N -p "$VERITAS_SSH_PORT" \
  -o ControlMaster=no -o ControlPath=none -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
  -L 127.0.0.1:18082:127.0.0.1:18082 \
  -L 127.0.0.1:18083:127.0.0.1:18083 \
  "$VERITAS_SSH_USER@$VERITAS_SSH_HOST"
```

若端口已经占用，先确认原有转发能否通过健康检查，避免重复启动。转发仅监听本机回环地址。

### 3. 准备本机私有配置

在本机另一个终端重新设置上述SSH变量，复制服务器生成的令牌。下例对应模型README的默认目录；自定义目录时同步修改来源路径。

```bash
umask 077
mkdir -p "$HOME/.config/veritas"
scp -P "$VERITAS_SSH_PORT" \
  "$VERITAS_SSH_USER@$VERITAS_SSH_HOST:.local/share/veritas/cospy/service-token" \
  "$HOME/.config/veritas/cospy-token"
scp -P "$VERITAS_SSH_PORT" \
  "$VERITAS_SSH_USER@$VERITAS_SSH_HOST:.local/share/veritas/flame/service-token" \
  "$HOME/.config/veritas/flame-token"
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
    'aiProvider': 'cospy',
    'cospy': {'url': 'http://127.0.0.1:18082', 'token': (root / 'cospy-token').read_text().strip()},
    'flame': {'url': 'http://127.0.0.1:18083', 'token': (root / 'flame-token').read_text().strip()},
    'deepseek': {'url': deepseek.get('url', 'https://api.deepseek.com'),
        'model': deepseek.get('model', 'deepseek-flash'), 'key': key},
}
path.write_text(json.dumps(config, indent=2) + '\n')
for item in [path, root / 'cospy-token', root / 'flame-token']:
    os.chmod(item, 0o600)
print('Image analysis configuration prepared')
PY
```

API密钥在终端中隐藏输入，不写入仓库示例。已有配置保留原DeepSeek地址、模型标识和密钥。当前联调使用 `deepseek-flash`；其他账号须配置实际可用且支持图片的模型。字段对照见 [配置示例](../../../src/modules/image/refund/server/config.example.json)。

### 4. 启动本机程序并验证

```bash
curl --fail --silent --show-error http://127.0.0.1:18082/health
curl --fail --silent --show-error http://127.0.0.1:18083/health
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

## 交付说明

已交付图片来源筛查、局部定位、商品核对、原图复核、汇总图表与 PDF 导出，并完成现有模型服务联调。构建、现有回归、接口、文档与 OpenSpec 检查通过，部署命令已校验。

## 使用限制

检测分数与候选区域仅供人工复核；压缩、裁剪和低分辨率可能丢失检测线索。完整业务验收、阈值校准、跨场景公共集成及生产权限验收尚未完成。

服务联调使用已部署的模型环境，尚未在全新 GPU 主机从零完成安装验收；正式环境需按服务 README 完整验证。
