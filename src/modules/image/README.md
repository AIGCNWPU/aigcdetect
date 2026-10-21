# AI图片检测

本目录负责模块定义、独立场景页面、业务服务和类型草案。

| 场景 | 页面文件 | 接口 |
| --- | --- | --- |
| 通用AI生成图片检测 | `pages/general.js` | `POST /api/v1/image/general` |
| 仅退款与售后AI凭证检测 | `pages/refund.js` | `POST /api/v1/image/refund` |
| AI证件与票据图片检测 | `pages/documents.js` | `POST /api/v1/image/documents` |

2.2已提供案件资料填写、图片添加/预览/移除和提交适配入口，其他图片页面留空；所有服务仍抛出 `NOT_IMPLEMENTED`。材料仅在当前页面保留，未上传服务器，见[售后图片接入说明](../../../docs/image-refund-integration.md)。修改同一 `service.js` 或公共定义前先与同模块成员对齐。完整分工见 [团队开发](../../../docs/TEAM_DEVELOPMENT.md)。
