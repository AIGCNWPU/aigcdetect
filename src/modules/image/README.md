# AI图片检测

本目录负责模块定义、独立场景页面、业务服务和类型草案。

| 场景 | 页面文件 | 接口 |
| --- | --- | --- |
| 通用AI生成图片检测 | `pages/general.js` | `POST /api/v1/image/general` |
| 仅退款与售后AI凭证检测 | `pages/refund.js` | `POST /api/v1/image/refund` |
| AI证件与票据图片检测 | `pages/documents.js` | `POST /api/v1/image/documents` |

当前所有页面留空，服务抛出 `NOT_IMPLEMENTED`。可通过各场景工作包分别开发；修改同一 `service.js` 或公共定义前先与同模块成员对齐。完整分工见 [团队开发](../../../docs/TEAM_DEVELOPMENT.md)。
