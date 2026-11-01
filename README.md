# VERITAS 智鉴

AI检测平台网页框架：**4 个模块、10 个业务场景页**。新闻与小说场景已有前端工作台、公开网页正文导入、EGTE句级AI检测，以及服务端新闻三审三校和小说重复/水稿检测适配层；学术检测通过独立后端代理接入，图片与视频售后支持当前材料分析。仓库为Private；参考 [jumu-team/jumu](https://github.com/jumu-team/jumu) 的工作包、贡献约定、OpenSpec和CI组织方式。

## 本地启动

Node.js >=20，推荐22。运行时不依赖第三方包；构建使用 esbuild 隔离各场景模块，先运行 `npm ci` 安装构建依赖。

```sh
npm ci
npm run dev
```

打开 http://127.0.0.1:4173 。可浏览模块与场景。新闻和小说分别使用独立的`POST /api/v1/text/news/import`、`POST /api/v1/text/novel/import`获取公开可读网页，不绕过登录、付费、验证码或访问限制。两个检测接口均支持前端切句后的EGTE逐句AI检测；新闻另支持三审三校，小说另支持重复/水稿检测。其余检测业务接口仍返回501。上传、持久化跨章记忆、鉴权与正式报告仍待实现。

## 服务端模型配置

模型凭据只能通过服务端环境变量设置，不能出现在`src/api.js`、浏览器请求、检测响应、日志或提交记录中。当前默认供应商为DeepSeek：设置`TEXT_MODEL_PROVIDER=deepseek`和`TEXT_MODEL_API_KEY`后，服务端自动使用`https://api.deepseek.com/chat/completions`、`deepseek-v4-pro`、JSON Output及`high`推理强度。端点、模型、推理强度、输出上限和超时仍可通过`.env.example`列出的变量覆盖。

本地开发直接编辑项目根目录的`.env`，填写DeepSeek Key；句级AI检测通过服务器本机的HTTP服务调用：

```env
TEXT_MODEL_PROVIDER=deepseek
TEXT_MODEL_API_KEY=
EGTE_API_URL=http://127.0.0.1:8011
```

然后正常运行`npm run dev`。服务端会自动读取根目录`.env`，且只接受`TEXT_MODEL_*`与`EGTE_*`字段；部署平台提供的环境变量优先于本地文件。`.env`已被Git忽略，`.env.example`只保留无密钥模板。未配置DeepSeek Key时，三审三校和水稿检测返回`MODEL_NOT_CONFIGURED`；EGTE不可用时句级检测返回`AI_DETECTOR_UNAVAILABLE`，均不会生成模拟结果。

## 服务器部署与EGTE调用

目标项目目录为`/home/wyt/projects/aigcdetect`。项目不会把算法服务地址或API Key发送到浏览器；Node服务执行句级检测时向`EGTE_API_URL`发送服务端HTTP请求，默认使用`http://127.0.0.1:8011`。请求体包含`classifier`和`segments`，算法服务负责加载并复用`cred`或`raid`模型。

仓库提供无需额外Web框架的回环HTTP适配器。在已安装EGTE依赖的Python环境中执行`python scripts/egte_api.py --host 127.0.0.1 --port 8011`即可前台启动，按`Ctrl+C`停止；模型在第一次检测请求时加载。

上传后在项目目录执行：

```sh
cd /home/wyt/projects/aigcdetect
cp .env.example .env
# 用编辑器填写 .env 中的 TEXT_MODEL_API_KEY，并确认 EGTE_API_URL
npm ci
npm run build
npm run verify:egte
HOST=127.0.0.1 PORT=4173 npm start
```

`npm run verify:egte`会向`EGTE_API_URL`真实提交一个中文测试句；看到`"status": "ok"`才说明Node到算法服务的HTTP链路及模型推理均可用。服务进程示例见`deploy/aigcdetect.service.example`；算法服务默认仅监听服务器回环地址，不应通过公网反向代理直接暴露。

前端对每篇稿件或章节按句切分，并提交`segmentId/sentenceIndexes/start/end/text`；少于20字符的句子会与同段相邻句组成最多两句的评分片段，后端重新分句并核对编号、段落边界和`content.slice(start,end)===text`后才调用算法。结果返回`AI`、`疑似AI`、`人工`或`无法评分`，列表可切换“全部显示”和“仅疑似AI”，筛选不改变总体统计。两句合并结果明确标为“合并评分”，得分属于整体片段，不能认定其中某一句具有相同结论。`aiScore`可换算成百分比显示为“AI类得分”，但它是未校准分数，不能称为AI几率或确定概率。两句合并后仍不满足算法最低条件时不会补成0分；长句保持完整，整组结果和单条长原文均提供滚动查看。

当前跨章能力仅比较同一次请求中提交的多个章节。一次只提交一章时会明确标记未执行跨章比较；作品级持久化记忆仍需后续存储与向量索引。

离线预览：运行 `npm run build` 后双击 `dist/index.html`。预览采用本地CSS和SVG，无CDN或外部字体依赖。

## 开发入口

- [需求摘录](openspec/references/AI检测平台_需求摘录.md)
- [公共约定与框架映射](openspec/changes/define-shared-foundation/design.md) · [公共行为要求](openspec/changes/define-shared-foundation/specs/shared-foundation/spec.md)
- [六人分工、10个场景与必要交接](docs/TEAM_DEVELOPMENT.md) · [页面与API目录](docs/PAGE_MAP.md)
- [开发、Commit、PR与OpenSpec规则](CONTRIBUTING.md) · [接口使用约定](docs/API_CONVENTIONS.md)
- [OpenAPI快照](docs/openapi.json) · [场景接入说明](docs/接入说明.md)

| 模块 | 业务场景 |
| --- | --- |
| AI文本检测 | 论文与学术稿件、新闻稿与投稿内容、网文与小说 |
| AI图片检测 | 通用生成图片、仅退款与售后凭证、证件与票据 |
| AI视频检测 | 通用生成视频、人物换脸与深度伪造、售后与退货凭证 |
| AI音频检测 | 音频伪造 |

各场景独立页面位于 `src/modules/<模块>/pages/`；模块服务、定义和类型在同目录。两位组长提供公共底座，六位同学按分工继续10个已有工作包。具体方案与开发细任务由负责人补充；同步main后开个人分支，小步提交PR，由维护者集成。

## 检查

```sh
npm run check
npm test
npm run build
```

CI另做OpenSpec严格验证和构建版HTTP冒烟。工作包文档与空接口检查通过不等于业务已实现。

## 预览

![工作空间](docs/首页预览.png)

## 图片与视频售后凭证分析

- 图片售后：CO-SPY 来源筛查、FLAME 候选区域定位、DeepSeek 商品资料核对、当前结果汇总及 PDF 导出。
- 视频售后：Native-Scale 来源分析、DeepSeek 带时间戳的画面资料核对、原视频定位及当前结果汇总。
- 演示预设只填入材料和资料，分析结果由真实服务返回。
- 页面仅分析当前上传，不提供历史案件回看。产品界面使用功能名称，模型分数不代表退款责任。

## 启动

本机需要 Node.js 20 及以上（推荐 22）；视频上传校验需要 FFprobe。安装 FFmpeg 后运行 `ffprobe -version` 确认，或用 `VERITAS_FFPROBE` 指定可执行文件路径。

```sh
npm ci
npm run build
npm start
```

访问 `http://127.0.0.1:4173/#/image/refund` 或 `http://127.0.0.1:4173/#/video/aftersales`。
`npm run dev` 提供源码模式。双击构建 HTML 只可查看静态界面；真实分析需要本机服务、模型服务及有效配置。

服务端配置保存在用户目录 `.config/veritas/`，不放入浏览器。参照 [图片配置示例](src/modules/image/refund/server/config.example.json) 和 [视频配置示例](src/modules/video/aftersales/server/config.example.json) 填写服务地址及私有凭据，并将配置文件权限设置为 `600`。
可分别通过 `VERITAS_REFUND_CONFIG`、`VERITAS_VIDEO_CONFIG` 指定配置文件。未配置或服务失联时显示实际失败，不返回替代结论。

模型独立运行在 Linux GPU 主机，主程序通过本机回环地址调用。部署、模型资源和素材来源分别见 [图片售后说明](openspec/changes/add-image-refund/design.md) 与 [视频售后说明](openspec/changes/add-video-aftersales/design.md)。

## 部署入口

主项目在本机运行。先按对应工作包的本机联调步骤复制模型服务目录、在GPU服务器完成安装，再建立SSH转发和本机私有配置：

- [图片部署与本机联调](openspec/changes/add-image-refund/design.md#本机联调步骤)
- [视频部署与本机联调](openspec/changes/add-video-aftersales/design.md#本机联调步骤)

三个模型服务分别有可顺序执行的安装README，工作包中的链接可直接进入。

## 使用与接口

- [图片售后](openspec/changes/add-image-refund/design.md)
- [视频售后](openspec/changes/add-video-aftersales/design.md)
- [页面与接口目录](docs/PAGE_MAP.md) · [OpenAPI](docs/openapi.json)
- [团队分工](docs/TEAM_DEVELOPMENT.md) · [协作约定](CONTRIBUTING.md)
- [图片工作包](openspec/changes/add-image-refund/proposal.md) · [视频工作包](openspec/changes/add-video-aftersales/proposal.md)


## 通用视频检测

已接入 Native-Scale 推理服务，启动和接口见 [通用视频检测说明](docs/video-general-integration.md)。

## 人物换脸与深度伪造检测

VLAForge 与 YuNet 服务配置见 [服务说明](services/video-deepfake/README.md)，上传和健康检查由独立本机网关处理。
