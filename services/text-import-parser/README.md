# 新闻/小说静态HTML解析代理

本服务属于新闻和小说链接导入模块，不依赖学术检测的8010接口。它接收主服务已经完成公网地址校验并下载的HTML，在临时目录中调用MinerU CLI，再以稳定JSON协议返回正文。

## 配置

复制`.env.example`为`.env`，把`MINERU_COMMAND_JSON`指向本模块自己的MinerU命令。推荐使用独立Python环境，并把该环境中的`mineru`可执行文件写成绝对路径：

```env
MINERU_COMMAND_JSON=["/absolute/path/to/mineru"]
MINERU_ARGS_JSON=["parse","{input}","-o","{output_file}"]
```

参数使用占位符配置。MinerU 4.x默认调用`mineru parse source.html -o result.md`；旧版CLI可以把`MINERU_ARGS_JSON`改成`["-p","{input}","-o","{output_dir}"]`。MinerU升级导致命令变化时只需调整本代理，不需要修改新闻、小说或学术模块。

## 启动

```bash
cd ~/projects/aigcdetect && node services/text-import-parser/server.mjs
```

健康检查：

```bash
curl -i --max-time 10 http://127.0.0.1:8013/health
```

主服务`.env`使用：

```env
TEXT_IMPORT_PARSER_ENABLED=1
TEXT_IMPORT_PARSER_URL=http://127.0.0.1:8013/api/v1/html/parse
TEXT_IMPORT_PARSER_TIMEOUT_MS=90000
```

代理只解析传入HTML，不自行访问URL，不绕过验证码、登录或付费限制。临时文件在每次请求结束后删除。
