# 负责人修改台账

长期分支：`codex/owner-maintenance`。每次修改追加记录，包括需求、涉及文件、提交或PR、验证结果和部署状态；不要记录秘密配置或用户材料。

| 编号 | 日期 | 负责人要求 / 必须保留的行为 | 主要文件 | 提交或PR | 验证与状态 |
| --- | --- | --- | --- | --- | --- |
| OWNER-000 | 2026-11-15 | 建立负责人长期修改分支；后续集成保留负责人修改 | AGENTS.md、docs/OWNER_WORKFLOW.md、本台账 | 本分支初始化提交 | 以main d52edc0建立；文档约定，不改变生产网站 |
| OWNER-001 | 2026-11-17 | 通用视频检测结果的原视频画面区最高420px且不超过视窗高度一半；原比例完整显示，保留播放与时间轴 | src/styles.css、tests/video-general.browser.mjs | 本分支「限制通用视频检测结果的播放器高度」提交 | 竖屏样本通过桌面、矮窗口及手机浏览器检查；596项自动测试通过 |
| BASE-001 | 2026-11-15 | 保留原站账号、会话、个人中心及音频/图片代理 | src/server/auth.js、db.js、src/lib/auth-client.js、src/app.js、scripts/serve.mjs | [PR #17](https://github.com/AIGCNWPU/aigcdetect/pull/17) | 已在分支基线中；部署时沿用原账号数据库 |
| BASE-002 | 2026-11-15 | 正式域名下的图片和视频售后可正常访问 | src/server/request-origin.js、售后server/api.js | [PR #18](https://github.com/AIGCNWPU/aigcdetect/pull/18) | 已在分支基线中；正式来源检查通过 |
| BASE-003 | 2026-11-15 | 所有功能页可纵向滚动，手机尺寸可到达页面底部 | src/styles.css、tests/workspace-scroll.browser.mjs | [PR #19](https://github.com/AIGCNWPU/aigcdetect/pull/19) / d52edc0 | 已在分支基线中并上线；30组滚动检查、596项测试通过 |

BASE条目用于交代初始化前已确认并上线的行为，不代表本次重新修改或重复发布这些代码。
