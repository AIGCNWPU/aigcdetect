# AI图片检测

本目录负责模块定义、独立场景页面、业务服务和类型草案。

| 场景 | 页面文件 | 接口 |
| --- | --- | --- |
| 通用AI生成图片检测 | `pages/general.js` | `POST /api/v1/image/general` |
| 仅退款与售后AI凭证检测 | `pages/refund.js` | `POST /api/v1/image/refund` |
| AI证件与票据图片检测 | `pages/documents.js` | `POST /api/v1/image/documents` |

2.2提供当前图片材料整理、CO-SPY 来源筛查、FLAME 局部定位、DeepSeek 商品核对和 PDF 导出；只处理当前材料，并提供一键演示预设。运行说明见 [图片售后接入](../../../openspec/changes/add-image-refund/design.md)。其他图片场景保持占位。共享文件归属见 [团队分工](../../../docs/TEAM_DEVELOPMENT.md)。
