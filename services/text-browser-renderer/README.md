# 新闻/小说浏览器渲染服务

本服务只属于新闻和小说链接导入模块，默认监听`127.0.0.1:8014`。主服务常规提取失败时，才会请求本服务执行公开页面脚本；渲染后的HTML仍交给现有保守正文规则或8013 MinerU代理识别。

服务不携带用户Cookie，不绕过登录、付费、验证码或访问限制。每个主文档及其HTTP(S)子资源都会进行公网地址校验；图片、视频和字体会被阻止，以减少资源消耗。

## 首次安装（不需要sudo）

```bash
cd ~/projects/aigcdetect && npm install --prefix services/text-browser-renderer
```

默认安装Playwright自带的Chromium：

```bash
cd ~/projects/aigcdetect && npx --prefix services/text-browser-renderer playwright install chromium
```

如果服务器不能下载浏览器，但已有Chrome或Chromium，可跳过第二条，并在`services/text-browser-renderer/.env`设置其绝对路径：

```env
TEXT_BROWSER_RENDERER_EXECUTABLE_PATH=/absolute/path/to/chromium
```

## 启动

复制配置并启动：

```bash
cd ~/projects/aigcdetect && cp -n services/text-browser-renderer/.env.example services/text-browser-renderer/.env && npm run start:text-browser-renderer
```

健康检查：

```bash
curl -i --max-time 10 http://127.0.0.1:8014/health
```

主服务`.env`使用：

```env
TEXT_IMPORT_BROWSER_ENABLED=1
TEXT_IMPORT_BROWSER_URL=http://127.0.0.1:8014/api/v1/render
TEXT_IMPORT_BROWSER_TIMEOUT_MS=60000
```

正常页面不会调用8014。动态页的识别顺序是“浏览器渲染 → 现有正文规则 → 必要时8013 MinerU”；其他页面仍保持“现有规则 → 8013 MinerU → 必要时浏览器渲染”。
