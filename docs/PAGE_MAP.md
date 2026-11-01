# 页面与接口目录

| 模块 | 场景 | 前端路由 | 独立页面文件 | 场景接口 |
| --- | --- | --- | --- | --- |
| AI文本检测 | AI论文与学术稿件检测 | `#/text/academic` | `src/modules/text/pages/academic.js` | `POST /api/v1/text/academic` |
| AI文本检测 | AI新闻稿与投稿内容检测 | `#/text/news` | `src/modules/text/pages/news.js` | `POST /api/v1/text/news` |
| AI文本检测 | AI网文与小说内容检测 | `#/text/novel` | `src/modules/text/pages/novel.js` | `POST /api/v1/text/novel` |
| AI图片检测 | 通用AI生成图片检测 | `#/image/general` | `src/modules/image/pages/general.js` | `POST /api/v1/image/general` |
| AI图片检测 | 仅退款与售后AI凭证检测 | `#/image/refund` | `src/modules/image/pages/refund.js` | `POST /api/v1/image/refund` |
| AI图片检测 | AI证件与票据图片检测 | `#/image/documents` | `src/modules/image/pages/documents.js` | `POST /api/v1/image/documents` |
| AI视频检测 | 通用AI生成视频检测 | `#/video/general` | `src/modules/video/pages/general.js` | `POST /api/v1/video/general` |
| AI视频检测 | 人物换脸与深度伪造检测 | `#/video/deepfake` | `src/modules/video/pages/deepfake.js` | `POST /api/v1/video/deepfake` |
| AI视频检测 | 售后与退货AI视频凭证检测 | `#/video/aftersales` | `src/modules/video/pages/aftersales.js` | `POST /api/v1/video/aftersales` |
| AI音频检测 | AI音频伪造检测 | `#/audio/forgery` | `src/modules/audio/pages/forgery.js` | `POST /api/v1/audio/forgery` |

总览 `#/`，模块路由分别为 `#/text`、`#/image`、`#/video`、`#/audio`。文本检测、学术代理、图片与视频售后及通用视频检测已接入各自工作区；未实现的检测接口返回 501。实际模型可用性取决于服务端配置。
