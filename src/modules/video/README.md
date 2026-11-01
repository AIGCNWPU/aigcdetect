# AI视频检测

本目录负责模块定义、独立场景页面、业务服务和类型草案。

| 场景 | 页面文件 | 接口 |
| --- | --- | --- |
| 通用AI生成视频检测 | `pages/general.js` | `POST /api/v1/video/general` |
| 人物换脸与深度伪造检测 | `pages/deepfake.js` | `POST /api/v1/video/deepfake` |
| 售后与退货AI视频凭证检测 | `pages/aftersales.js` | `POST /api/v1/video/aftersales` |

3.3提供当前视频上传与播放、Native-Scale 来源分析、DeepSeek 商品资料核对及时间位置复核。只汇总当前材料，并提供一键演示预设。运行说明见 [视频售后接入](../../../openspec/changes/add-video-aftersales/design.md)。3.1 已接入 Native-Scale，配置见 [通用视频检测说明](../../../docs/video-general-integration.md)；3.2 已接入 [VLAForge 与 YuNet](../../../services/video-deepfake/README.md)；共享文件归属见 [团队分工](../../../docs/TEAM_DEVELOPMENT.md)。
