# 源码预览白屏修复（2026-11-12）

4173使用 `node scripts/serve.mjs` 源码模式，首页直接加载src/app.js。图片压缩包模块从fflate包导入函数，浏览器不识别裸包名，报Failed to resolve module specifier "fflate"；模块图初始化中断，#app为空。4188使用构建文件，依赖已被esbuild打包，因此不受同一问题影响。

首页添加import map，在入口模块前将fflate指向public/vendor/fflate/browser.js。该文件逐字节复制自当前安装的fflate浏览器ES模块，附MIT许可、版本和SHA256；构建脚本同步复制该目录。保持npm依赖导入，源码模式与构建模式均可使用。现有源码服务立即读取新首页与静态文件，无需重启。

真实Chromium分别验证4173与4188：图片工作台加载、选择实际ZIP并将其中PNG加入列表、材料核验上传入口正常。两个端口均无pageerror、无失败JS/CSS请求。测试没有提交推理或调用外部API。结果与截图保存在平台runtime/replay/source-preview-20261112下。

项目check、build和浏览器验收通过。原有市场API相关未提交修改保留，未纳入本次修复。

## 2026-11-20 干净检出与 CI 修复

此前的资源目录只在服务器本地存在，未提交 Git，导致两个仓库的 Framework checks 均在构建阶段报 `ENOENT public/vendor/fflate`。本机已有副本时 build 成功，不能代替干净检出验证。

现改为 `npm ci` 的 postinstall 自动从锁定的 fflate 包生成 browser.js、LICENSE 及版本/摘要说明；build 也执行准备步骤，支持安装时禁用 lifecycle scripts 后直接构建。生成资源加入 .gitignore，不提交第三方依赖副本。源码服务回归检查 import map 对应脚本及许可证可访问，防止再次出现源码预览白屏。
