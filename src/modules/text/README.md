# AI文本检测

本目录负责模块定义、独立场景页面、业务服务和类型草案。

| 场景 | 页面文件 | 接口 |
| --- | --- | --- |
| AI论文与学术稿件检测 | `pages/academic.js` | `POST /api/v1/text/academic` |
| AI新闻稿与投稿内容检测 | `pages/news.js` | `POST /api/v1/text/news` |
| AI网文与小说内容检测 | `pages/novel.js` | `POST /api/v1/text/novel` |

当前所有页面留空，服务抛出 `NOT_IMPLEMENTED`。可通过各场景工作包分别开发；修改同一 `service.js` 或公共定义前先与同模块成员对齐。完整分工见 [团队开发](../../../docs/TEAM_DEVELOPMENT.md)。
