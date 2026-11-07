# Design

## Context

需求章节：3.3 售后与退货AI视频凭证检测。工作包负责人：④ 闭耀松。

本模块使用原生JavaScript前端、本机Node服务及独立模型服务。职责与共享文件边界见[团队分工](../../../docs/TEAM_DEVELOPMENT.md)，材料修订、失败和覆盖范围遵循[公共约定](../define-shared-foundation/specs/shared-foundation/spec.md)。只分析当前上传，完整业务验收和共享权限集成保持未完成。

## Decisions

## 当前流程

填写案件与商品资料、上传原视频，提交成功后进入检测页。Native-Scale提供视频片段来源分数，MIRROR提供关键画面及所需中心细节分数，固定多帧规则形成复核建议。来源触发复核后使用FLAME检查最多8个完整画面的候选编辑区域。DeepSeek独立核对商品与问题；原视频可暂停定位，当前结果支持PDF导出。

支持MP4、WebM，最多5段、单段200 MiB、10分钟、最长边4096像素。浏览器检查可播放性，本机使用FFprobe核对实际容器、时长和方向尺寸。视频保留原字节，结果绑定视频编号、版本及SHA-256。

## 来源核验与候选定位

Native-Scale使用448p配置、中心片段约每秒2帧和最多8帧，较长视频补充均匀位置，最多9个片段。MIRROR在8个实际可呈现画面上推理，排除片段外解码参考帧；保留发布方预处理，完整画面门槛为0.35755555331707006。来源通道独立验证，任一失败保留有效依据并标记部分完成。

启用 `keyframes.detail: true` 后，完整画面阳性始终保留。其他两路来源完整的材料追加同8帧中心至多504×504原像素细节；完整画面支持条件0.2163227200508118和细节门槛0.824063926935196保留为固定依据。再由[固定参数](../../../src/modules/video/aftersales/source-review-profile.js)核验片段分数、完整画面/细节的中位数、上下四分位数和连续双帧支持。参数只用于推理，不根据当前上传重新拟合，不输出合成造假概率。

来源复核触发后，本机FFmpeg从原视频提取最多8个完整原帧，调用FLAME。服务端核对原帧摘要、方向尺寸、模型修订及512×512二值掩码；预览单独生成，不代替推理输入。定位未触发、未配置、失败和部分失败分别呈现，均不撤销已有来源结果。标记不显示区域数量，也不认定破损成因。

## 商品核对与PDF导出

DeepSeek仅比较实际抽样画面与商品外观、款式和问题描述。模型只引用已提供画面序号，由本机映射成原视频时间；缺参照或看不清时返回无法判断，不能用来源分数代替商品核对，也不核验声音、未采样动作或退款责任。

“本次分析汇总”导出全部当前视频与结果快照。PDF复用图片报告渲染库和中文字体，保留独立来源分数、实际采样位置、原帧与真实候选标记、商品核对及未完成状态。未检测素材只有明确标注的预览；缺失分数不补零，导出不重新调用模型。支持进度、取消、中文检索和自动分页，产品不显示算法名称。

## 会话与接口

接口前缀 `/api/v1/video/aftersales`。创建会话、原字节上传、创建/查询/取消任务与关闭见[OpenAPI](../../../docs/openapi.json)。临时会话最多3个、合计1 GiB，30分钟不活动清理；上传最多2个并发，分析串行排队、单项上限5分钟。

视频只保存在当前会话的私有临时目录，结束、过期或退出后清理。材料修改取消旧任务，迟到结果不覆盖新版本，不提供历史案件回看。启动清理只处理已退出进程留下的本服务目录。

## 模型与服务配置

| 能力 | 部署说明 | 端口 |
| --- | --- | --- |
| 视频片段来源 | [Native-Scale](../../../scripts/video-aftersales-service/README.md) | 18084 |
| 图像来源推理 | [MIRROR](../../../scripts/mirror-service/README.md) | 18081 |
| 关键画面与中心细节 | [关键画面CPU服务](../../../scripts/video-aftersales-service/README.md#关键画面来源服务) | 18087 |
| 关键帧候选定位 | [FLAME](../../../scripts/flame-service/README.md) | 18083 |
| 商品与问题核对 | DeepSeek多模态接口，由本机服务端配置 | - |

模型只部署在Linux GPU服务器，主项目不迁移。源码、权重、虚拟环境和缓存按各服务README放在有权限的数据盘。模型服务只监听回环地址并验证Bearer凭据；不同模型使用各自依赖环境。来源与定位资产沿用发布方许可。

## 数据集与演示素材

系统运行不依赖完整训练或测试集。原始素材来源和摘要见[视频来源记录](../../../public/video-aftersales-demos/sources.json)及[素材README](../../../public/video-aftersales-demos/README.md)。预设只载入输入和商品资料，结论来自实际服务，样例不用于推导业务准确率。

| 用途 | 来源 | 边界 |
| --- | --- | --- |
| 陶罐破碎模拟输入 | [VideoPhy-2](https://huggingface.co/datasets/videophysics/videophy2_test) | 发布方标注AI，数据集卡为MIT，属于模拟凭证 |
| 紫砂壶报道输入 | [上观新闻](https://www.shobserver.com/wx/detail.do?id=1020808) | 仅有报道片段，缺少买家原始生成记录，不能作为严格真假标注 |
| 固定判定参数的数据来源 | [FakeParts](https://huggingface.co/datasets/hi-paris/FakeParts)，修订c39ac15f119c6b0f4b778df6b5347ec12dc1436c | 发布方标注与BSD-3-Clause说明；参数随源码分发，运行无需该数据集 |

## 本机联调步骤

### 1. 复制并部署独立服务

在本机项目目录设置实际SSH参数，复制模型封装：

```bash
export VERITAS_SSH_HOST=your_gpu_host
export VERITAS_SSH_PORT=22
export VERITAS_SSH_USER=your_user
ssh -p "$VERITAS_SSH_PORT" "$VERITAS_SSH_USER@$VERITAS_SSH_HOST" 'mkdir -p veritas-services'
scp -P "$VERITAS_SSH_PORT" -r scripts/video-aftersales-service scripts/mirror-service scripts/flame-service \
  "$VERITAS_SSH_USER@$VERITAS_SSH_HOST:veritas-services/"
```

登录服务器，按前述三份模型README完成固定源码、权重校验、私有令牌与启动，再启动关键画面CPU服务；服务端18084、18081、18087、18083健康检查均应就绪。已有FLAME服务可复用，无需重复部署。

### 2. 建立访问连接

在本机独立终端运行并保持连接：

```bash
ssh -N -p "$VERITAS_SSH_PORT" \
  -o ControlMaster=no -o ControlPath=none -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
  -L 127.0.0.1:18084:127.0.0.1:18084 \
  -L 127.0.0.1:18087:127.0.0.1:18087 \
  -L 127.0.0.1:18083:127.0.0.1:18083 \
  "$VERITAS_SSH_USER@$VERITAS_SSH_HOST"
```

MIRROR由服务器内部的关键画面服务调用，本机无需额外转发18081。已有同端口转发时复用连接，不重复绑定或停止其他服务。

### 3. 本机私有配置

在本机另一个终端重新设置SSH参数，将数据盘路径改成服务器实际的 `VERITAS_MODEL_DATA`：

```bash
export VERITAS_REMOTE_MODEL_DATA=/path/to/data-disk/veritas
umask 077
mkdir -p "$HOME/.config/veritas"
scp -P "$VERITAS_SSH_PORT" "$VERITAS_SSH_USER@$VERITAS_SSH_HOST:$VERITAS_REMOTE_MODEL_DATA/native-scale/state/service-token" "$HOME/.config/veritas/native-token"
scp -P "$VERITAS_SSH_PORT" "$VERITAS_SSH_USER@$VERITAS_SSH_HOST:$VERITAS_REMOTE_MODEL_DATA/video-keyframes/service-token" "$HOME/.config/veritas/keyframe-token"
scp -P "$VERITAS_SSH_PORT" "$VERITAS_SSH_USER@$VERITAS_SSH_HOST:$VERITAS_REMOTE_MODEL_DATA/flame/service-token" "$HOME/.config/veritas/flame-token"
python3 - <<'PY'
import getpass,json,os
from pathlib import Path
root=Path.home()/'.config/veritas';path=root/'video-aftersales.json'
previous=json.loads(path.read_text()) if path.exists() else {}
image_path=root/'image-refund.json';image=json.loads(image_path.read_text()) if image_path.exists() else {}
deepseek=previous.get('deepseek') or image.get('deepseek') or {}
key=deepseek.get('key') or getpass.getpass('DeepSeek API key: ').strip()
if not key:raise SystemExit('Configure a valid multimodal API key')
config={'native':{'url':'http://127.0.0.1:18084','token':(root/'native-token').read_text().strip()},
        'keyframes':{'url':'http://127.0.0.1:18087','token':(root/'keyframe-token').read_text().strip(),'detail':True},
        'flame':{'url':'http://127.0.0.1:18083','token':(root/'flame-token').read_text().strip()},
        'deepseek':{'url':deepseek.get('url','https://api.deepseek.com'),'model':deepseek.get('model','deepseek-flash'),'key':key}}
path.write_text(json.dumps(config,indent=2)+'\n');path.chmod(0o600)
for name in ['native-token','keyframe-token','flame-token']:(root/name).chmod(0o600)
print('Video analysis configuration prepared')
PY
```

字段见[配置示例](../../../src/modules/video/aftersales/server/config.example.json)。可用 `VERITAS_VIDEO_CONFIG` 指定私有配置文件；DeepSeek模型必须实际支持图片输入。配置只由本机Node读取，不进入浏览器。

### 4. 启动与使用

本机需要Node.js20以上和FFmpeg、FFprobe，非标准安装位置可设置 `VERITAS_FFMPEG`、`VERITAS_FFPROBE`。

```bash
ffmpeg -version
ffprobe -version
npm ci
npm run build
npm start
```

打开 `http://127.0.0.1:4173/#/video/aftersales`，载入预设并提交，运行来源与商品核对；来源触发后查看完整原帧及候选标记，点击时间定位并暂停原视频，在本次汇总导出PDF。能力接口仅反映配置存在，最终以实际请求及完整返回为准。

## 交付说明

交付包含视频片段、关键画面、固定多帧核验、来源触发后的候选定位、商品核对、当前汇总与PDF导出。回归覆盖原文件关联、协议字段、失败/取消、部分完成、采样定位和报告快照；公共构建、接口及OpenSpec检查在候选快照执行。模型流程沿用已联调服务；未在全新GPU主机从零安装验收。

来源检测只覆盖实际采样，局部标记可能覆盖背景或字幕，不等于确认篡改或损坏原因；既定来源校准以4-14秒短片为主，超出时长明确提示范围。分数不是欺诈概率，不自动裁决退款。完整业务验收、共享权限和跨场景正式集成仍未完成。
