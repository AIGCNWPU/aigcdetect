# 多人开发与工作包

维护者负责公共框架、接口协调和集成；10个场景可分别认领，不预先填成员姓名，也不提前创建个人分支。

| 编号 | 负责人 | 需求场景 | OpenSpec | 独立页面 |
| --- | --- | --- | --- | --- |
| 01 | 待认领 | 1.1 AI论文与学术稿件检测 | [工作包](../openspec/changes/add-text-academic/proposal.md) | `src/modules/text/pages/academic.js` |
| 02 | 待认领 | 1.2 AI新闻稿与投稿内容检测 | [工作包](../openspec/changes/add-text-news/proposal.md) | `src/modules/text/pages/news.js` |
| 03 | 待认领 | 1.3 AI网文与小说内容检测 | [工作包](../openspec/changes/add-text-novel/proposal.md) | `src/modules/text/pages/novel.js` |
| 04 | 待认领 | 2.1 通用AI生成图片检测 | [工作包](../openspec/changes/add-image-general/proposal.md) | `src/modules/image/pages/general.js` |
| 05 | 待认领 | 2.2 仅退款与售后AI凭证检测 | [工作包](../openspec/changes/add-image-refund/proposal.md) | `src/modules/image/pages/refund.js` |
| 06 | 待认领 | 2.3 AI证件与票据图片检测 | [工作包](../openspec/changes/add-image-documents/proposal.md) | `src/modules/image/pages/documents.js` |
| 07 | 待认领 | 3.1 通用AI生成视频检测 | [工作包](../openspec/changes/add-video-general/proposal.md) | `src/modules/video/pages/general.js` |
| 08 | 待认领 | 3.2 人物换脸与深度伪造检测 | [工作包](../openspec/changes/add-video-deepfake/proposal.md) | `src/modules/video/pages/deepfake.js` |
| 09 | 待认领 | 3.3 售后与退货AI视频凭证检测 | [工作包](../openspec/changes/add-video-aftersales/proposal.md) | `src/modules/video/pages/aftersales.js` |
| 10 | 待认领 | 4.1 AI音频伪造检测 | [工作包](../openspec/changes/add-audio-forgery/proposal.md) | `src/modules/audio/pages/forgery.js` |

## 公共归属与冲突处理

- 各自优先修改自己的 `src/modules/<模块>/pages/<场景>.js` 和工作包文档。
- 同一模块的 `definition.js`、`service.js`、`contracts.d.ts` 由该模块成员协调；负责人可在开发时再拆分服务文件。
- `src/app.js`、`src/styles.css`、`src/catalog.js`、注册器、HTTP服务与构建脚本由维护者统筹。新增文件时同步客户端打包清单，服务端和密钥文件不得加入浏览器包。
- 现有接口为501空实现。上传、算法、数据库、权限、任务与报告待实现；工作包准备好不等于功能交付。
- 推荐顺序：公共契约最小确认 → 各场景独立开发和自检 → 小PR → 维护者集成联调。
- 业务实现按最初需求摘录推进；当前网页仍保持10个空白场景，不提前展开子功能。

流程见[贡献规范](../CONTRIBUTING.md)，公共映射见[统一设计](../openspec/changes/define-shared-foundation/design.md)。
