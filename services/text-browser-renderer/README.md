# 新闻/小说浏览器渲染服务

本服务只属于新闻和小说链接导入模块，默认监听`127.0.0.1:8014`。主服务常规提取失败时，才会请求本服务执行公开页面脚本；渲染后的HTML仍交给现有保守正文规则或8013 MinerU代理识别。

服务不携带用户Cookie，不绕过登录、付费、验证码或访问限制。每个主文档及其HTTP(S)子资源都会进行公网地址校验；图片、视频和字体会被阻止，以减少资源消耗。

渲染结果会额外提供从可见文章容器（含开放Shadow DOM）提取的纯文本候选。新闻导入会先过滤Cookie、隐私授权和广告界面；候选可靠时不再把整页交给MinerU，避免把弹窗正文误当成新闻。

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

无sudo服务器若把Chromium依赖解压到个人目录，可直接写入本服务的`.env`，无需每次启动手写环境变量：

```env
TEXT_BROWSER_RENDERER_LIBRARY_PATH=/home/wyt/.local/share/veritas-browser-libs/root/usr/lib/x86_64-linux-gnu
TEXT_BROWSER_RENDERER_FONTCONFIG_FILE=/home/wyt/.local/share/veritas-browser-libs/fonts.conf

# 最多同时渲染2个页面，额外排队8个；超过后立即返回429，避免进程被长队列拖垮
TEXT_BROWSER_RENDERER_MAX_CONCURRENCY=2
TEXT_BROWSER_RENDERER_MAX_QUEUE=8
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

## 免费章节单页实验探测

教师验收或站点兼容性排查时，可以运行项目根目录的独立探测脚本。它先执行现有静态规则，再渲染公开页面；若正文只存在于可见Canvas，会保存Canvas截图并尝试交给本机MinerU做OCR：

```bash
cd ~/projects/aigcdetect && npm run probe:free-chapter -- 'https://公开单章节地址' --out output/free-chapter-test
```

输出目录包含`diagnostic.json`、可用时的`result.md`以及一张或多张`capture-*.png`。脚本不接入正式导入接口，不自动翻页，不携带Cookie，也不处理登录、付费、验证码或仍停留“加载中”的客户端页面。OCR结果固定标记为实验性和完整性待人工核对。
