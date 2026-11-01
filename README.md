# VERITAS 智鉴

平台包含四个模块、十个场景。当前实现图片售后和视频售后两个场景，其余八个场景保留接口占位。

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

## 检查

```sh
npm test
npm run check
npm run build
npx --yes --package @fission-ai/openspec@1.13.1 openspec validate --all --strict --no-interactive
```

本地验证已覆盖会话、任务、结果关联和报告导出；真实模型联调需配置上述服务，不能据此推导模型准确率。当前版本用于本机分析与演示，尚未完成多用户权限、公共跨场景集成及完整业务验收。
