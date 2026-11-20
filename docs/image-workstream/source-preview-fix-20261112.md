# 源码预览白屏修复（2026-11-12）

4173使用 `node scripts/serve.mjs` 源码模式，首页直接加载src/app.js。图片压缩包模块从fflate包导入函数，浏览器不识别裸包名，报Failed to resolve module specifier "fflate"；模块图初始化中断，#app为空。4188使用构建文件，依赖已被esbuild打包，因此不受同一问题影响。

首页添加import map，在入口模块前将fflate指向public/vendor/fflate/browser.js。该文件逐字节复制自当前安装的fflate浏览器ES模块，附MIT许可、版本和SHA256；构建脚本同步复制该目录。保持npm依赖导入，源码模式与构建模式均可使用。现有源码服务立即读取新首页与静态文件，无需重启。

真实Chromium分别验证4173与4188：图片工作台加载、选择实际ZIP并将其中PNG加入列表、材料核验上传入口正常。两个端口均无pageerror、无失败JS/CSS请求。测试没有提交推理或调用外部API。结果与截图保存在平台runtime/replay/source-preview-20261112下。

项目check、build和浏览器验收通过。原有市场API相关未提交修改保留，未纳入本次修复。

## 2026-11-20 干净检出与 CI 修复

此前的资源目录只在服务器本地存在，未提交 Git，导致两个仓库的 Framework checks 均在构建阶段报 `ENOENT public/vendor/fflate`。本机已有副本时 build 成功，不能代替干净检出验证。

现改为 `npm ci` 的 postinstall 自动从锁定的 fflate 包生成 browser.js、LICENSE 及版本/摘要说明；build 也执行准备步骤，支持安装时禁用 lifecycle scripts 后直接构建。生成资源加入 .gitignore，不提交第三方依赖副本。源码服务回归检查 import map 对应脚本及许可证可访问，防止再次出现源码预览白屏。

验证结果（修复提交 `a95d722`）：

- 干净 Git 树安装：npm ci 自动生成资源；233 个 JS 文件静态检查通过，553 项本机测试通过，构建及构建版冒烟通过，13 个 OpenSpec 工作包严格校验通过。
- 真实浏览器：干净目录源码模式的整图页面、ZIP 中 PNG 解压加入列表、文档页面均正常，无浏览器模块异常；未提交推理或调用大模型。
- [自建仓库 Actions 成功记录](https://github.com/doctorwho111213/aigc-image-review/actions/runs/44671224864)：所有工作流步骤成功。
- [官方仓库 Actions 成功记录](https://github.com/AIGCNWPU/aigcdetect/actions/runs/44671227047)：所有工作流步骤成功。
- 两个仓库均同步 `ljw/image-review-20261102`，自建仓库此前遗漏的前端修复提交一并补齐；未修改主分支。正式服务器同步并构建，平台常驻服务继续运行。

此前失败的记录保留作为历史，不能用历史邮件判断最新提交。今后提交前除当前工作目录验证外，还应对仅包含待提交文件的干净 Git 树执行安装、构建和资源访问验收。GitHub 无权重环境的 CI 不替代正式服务器模型推理验收。
