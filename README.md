# VERITAS 智鉴

AI检测平台网页框架：**4 个模块、10 个空白场景页**。仓库为Private；参考 [jumu-team/jumu](https://github.com/jumu-team/jumu) 的工作包、贡献约定、OpenSpec和CI组织方式。

## 本地启动

Node.js >=20，推荐22。当前无第三方运行或构建依赖。

```sh
npm ci
npm run dev
```

打开 http://127.0.0.1:4173 。可浏览模块与场景；场景只保留导航、标题和空白工作区，不显示子功能列表。业务接口返回501，算法、上传、任务、存储、鉴权与报告均待实现。

离线预览：运行 `npm run build` 后双击 `dist/index.html`。预览采用本地CSS和SVG，无CDN或外部字体依赖。

## 开发入口

- [需求摘录](openspec/references/AI检测平台_需求摘录.md)
- [公共约定与框架映射](openspec/changes/define-shared-foundation/design.md) · [公共行为要求](openspec/changes/define-shared-foundation/specs/shared-foundation/spec.md)
- [六人分工、10个场景与必要交接](docs/TEAM_DEVELOPMENT.md) · [页面与API目录](docs/PAGE_MAP.md)
- [开发、Commit、PR与OpenSpec规则](CONTRIBUTING.md) · [接口使用约定](docs/API_CONVENTIONS.md)
- [OpenAPI快照](docs/openapi.json) · [场景接入说明](docs/接入说明.md)

| 模块 | 业务场景 |
| --- | --- |
| AI文本检测 | 论文与学术稿件、新闻稿与投稿内容、网文与小说 |
| AI图片检测 | 通用生成图片、仅退款与售后凭证、证件与票据 |
| AI视频检测 | 通用生成视频、人物换脸与深度伪造、售后与退货凭证 |
| AI音频检测 | 音频伪造 |

各场景独立页面位于 `src/modules/<模块>/pages/`；模块服务、定义和类型在同目录。两位组长提供公共底座，六位同学按分工继续10个已有工作包。具体方案与开发细任务由负责人补充；同步main后开个人分支，小步提交PR，由维护者集成。

## 检查

```sh
npm run check
npm test
npm run build
```

CI另做OpenSpec严格验证和构建版HTTP冒烟。工作包文档与空接口检查通过不等于业务已实现。

## 预览

![工作空间](docs/首页预览.png)
