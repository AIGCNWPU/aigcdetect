# AI文本检测

本目录负责模块定义、独立场景页面、业务服务和类型草案。

| 场景 | 页面文件 | 接口 | 状态 |
| --- | --- | --- | --- |
| AI论文与学术稿件检测 | `pages/academic.js` | `POST /api/v1/text/academic` | **已实现**（①） |
| AI新闻稿与投稿内容检测 | `pages/news.js` | `POST /api/v1/text/news` | 待实现（②） |
| AI网文与小说内容检测 | `pages/novel.js` | `POST /api/v1/text/novel` | 待实现（②） |

论文场景说明：OpenSpec `openspec/changes/add-text-academic/`；模型与数据集见仓库 `backend/README.md`。降重指南路由 `#/text/academic/ai-reduction`（逻辑在 `src/app.js`）。

完整分工见 [团队开发](../../../docs/TEAM_DEVELOPMENT.md)。
