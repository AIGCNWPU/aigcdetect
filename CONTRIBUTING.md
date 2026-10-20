# 开发与提交约定

## 协作流程

同步main → 创建个人功能分支 → 阅读公共映射和自己的OpenSpec → 开发并自检 → 推送分支 → 提PR → 维护者检查后合并。

- 建议分支名 `codex/<模块>-<场景>`，如 `codex/text-news`、`codex/video-deepfake`；不预先替成员创建分支。
- 一次PR围绕一个可检查的功能，不必等整个模块完成。公共字段、服务与构建变更先和相关成员对齐。
- 由维护者合并main是团队约定，当前不宣称GitHub已强制分支保护。

## Commit与PR

采用Conventional Commits形式：`type(scope): 中文说明（署名）`。例如 `feat(text): 接入新闻稿提交（GitHub账号）`。署名使用本人真实姓名或GitHub账号，不猜测他人姓名；Git作者配置保留真实可追溯身份，邮箱可用本人GitHub noreply地址。

常用type：feat、fix、docs、refactor、test、build、ci、chore。PR标题沿用此格式；PR说明列出用户行为、接口影响、关联工作包、验证结果和未完成项。页面变更附截图。

仅提交本次工作相关文件，不提交 `.env`、凭据、依赖、dist、日志、缓存和临时输出。`package-lock.json` 随实际依赖变动提交。

## OpenSpec工作包

- 六位同学分担10个已有场景工作包，具体归属见[团队分工](docs/TEAM_DEVELOPMENT.md)；公共入口在 `openspec/changes/define-shared-foundation/`。同一人负责的两个工作包分别维护，不重复建同名规格。
- `proposal.md` 写范围，`specs/*/spec.md` 写行为与关键验收，`design.md` 写对接方向，`tasks.md` 保留三项交接里程碑；具体技术与细任务由负责人补充。
- 业务范围以 `openspec/references/AI检测平台_需求摘录.md`、其修订说明与最新用户要求为准；本轮仅对齐分工与文档，现有页面仍为空。负责人可按已分配工作包自行实现，不把空白框架当作永久产品限制。
- 只有实际实现并验证才勾选业务任务、同步正式specs并归档。501空接口和文档检查通过不代表检测算法完成。

项目携带参考仓库同套6个OpenSpec官方技能，位于 `.agents/skills`：explore、propose、apply-change、update-change、sync-specs、archive-change。成员在项目会话中使用对应 `$openspec-*`；先继续已有工作包，新增需求再创建新变更。

OpenSpec校验版本与参考仓库一致，固定1.13.1；可以自行安装CLI，或使用：

```sh
npx --yes --package @fission-ai/openspec@1.13.1 openspec validate --all --strict --no-interactive
```

## 提交前检查

Node.js 20及以上，推荐22。项目当前无第三方运行或构建依赖。

```sh
npm ci
npm run check
npm test
npm run build
npm start
# 另开终端
npm run smoke
```

CI执行代码与工作包检查、接口测试、OpenSpec严格验证、构建及HTTP冒烟。仅通过占位测试不等于业务实现。

## 仓库访问

仓库为私有。当前按用户要求不发送成员邀请。后续管理员在Settings的Collaborators入口邀请指定GitHub账号，成员接受后再开发，无需共享密码。这里不预填成员或授予额外权限。
