# AI视频检测

本目录负责模块定义、独立场景页面、业务服务和类型草案。

| 场景 | 页面文件 | 接口 |
| --- | --- | --- |
| 通用AI生成视频检测 | `pages/general.js` | `POST /api/v1/video/general` |
| 人物换脸与深度伪造检测 | `pages/deepfake.js` | `POST /api/v1/video/deepfake` |
| 售后与退货AI视频凭证检测 | `pages/aftersales.js` | `POST /api/v1/video/aftersales` |

3.2 已提供前端工作台与独立适配入口（`deepfake/detection.js`），检测服务未接入时展示明确标注的样例，并可通过 `window.Veritas.videoDeepfakeDetection` 接入真实服务；接入说明见 [人物换脸与深度伪造检测说明](../../../docs/video-deepfake-integration.md)。其余两个页面留空，服务仍抛出 `NOT_IMPLEMENTED`。可通过各场景工作包分别开发；修改同一 `service.js` 或公共定义前先与同模块成员对齐。完整分工见 [团队开发](../../../docs/TEAM_DEVELOPMENT.md)。
