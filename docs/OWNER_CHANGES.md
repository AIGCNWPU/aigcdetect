# 负责人修改台账

长期分支：`codex/owner-maintenance`。每次修改追加记录，包括需求、涉及文件、提交或PR、验证结果和部署状态；不要记录秘密配置或用户材料。

| 编号 | 日期 | 负责人要求 / 必须保留的行为 | 主要文件 | 提交或PR | 验证与状态 |
| --- | --- | --- | --- | --- | --- |
| OWNER-000 | 2026-11-15 | 建立负责人长期修改分支；后续集成保留负责人修改 | AGENTS.md、docs/OWNER_WORKFLOW.md、本台账 | 本分支初始化提交 | 以main d52edc0建立；文档约定，不改变生产网站 |
| OWNER-001 | 2026-11-17 | 通用视频检测结果以紧凑播放器显示原视频：播放器宽度不超过480px，画面高度不超过270px和视窗高度36%中的较小值；完整显示原比例，保留播放与时间轴 | src/styles.css、tests/video-general.browser.mjs | [首次高度限制](https://github.com/AIGCNWPU/aigcdetect/commit/4401ecd98b0daaa97cf82864c005f51d7e0fe3f5)，由本分支「收紧通用视频检测结果的播放器尺寸」提交补充宽度限制并替换原高度上限 | 上传竖屏样本后验证1920和1440宽屏、低视窗及手机；首次限制在1920宽屏仍为891×420px，新尺寸断言通过 |
| BASE-001 | 2026-11-15 | 保留原站账号、会话、个人中心及音频/图片代理 | src/server/auth.js、db.js、src/lib/auth-client.js、src/app.js、scripts/serve.mjs | [PR #17](https://github.com/AIGCNWPU/aigcdetect/pull/17) | 已在分支基线中；部署时沿用原账号数据库 |
| BASE-002 | 2026-11-15 | 正式域名下的图片和视频售后可正常访问 | src/server/request-origin.js、售后server/api.js | [PR #18](https://github.com/AIGCNWPU/aigcdetect/pull/18) | 已在分支基线中；正式来源检查通过 |
| BASE-003 | 2026-11-15 | 所有功能页可纵向滚动，手机尺寸可到达页面底部 | src/styles.css、tests/workspace-scroll.browser.mjs | [PR #19](https://github.com/AIGCNWPU/aigcdetect/pull/19) / d52edc0 | 已在分支基线中并上线；30组滚动检查、596项测试通过 |
| OWNER-002 | 2026-11-17 | 通用视频检测结果的原视频与中央播放按钮对齐播放器中心，竖屏两侧留白对称，延续 OWNER-001 的尺寸限制 | src/styles.css、tests/video-general.browser.mjs | 本分支「居中通用视频检测结果的原视频画面」提交 | 上传竖屏样本后检查4种视窗：画面区对齐时间轴区域，播放按钮居中，画面完整 |
| OWNER-003 | 2026-11-17 | 桌面宽屏默认缩放时，右侧主区的滚动条贴近窗口边缘，内容随可用空间加宽并保留宽度上限；学术页顶部间距不在1800px突变 | src/styles.css、tests/workspace-wide-layout.browser.mjs | 本分支「修复宽屏工作区布局与滚动条位置」提交 | Chrome 和 Edge 共10组布局检查通过；10个检测场景共30组滚动检查通过 |

BASE条目用于交代初始化前已确认并上线的行为，不代表本次重新修改或重复发布这些代码。
