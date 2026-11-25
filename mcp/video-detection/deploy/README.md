# GPU 服务器 MCP 部署

部署日期：2026-11-25。适配器部署在 mxz 的独立目录，不修改已有模型服务，也不重新加载模型。

服务器目录：`/mnt/vos-6d37s2q0/users/mxz/projects/video-mcp/`

| 模块 | MCP 本机端口 | 已有模型 API | 当前公网端点 |
|---|---|---|---|
| 通用视频 | 18610 | 8600 | https://ahead-views-powers-sci.trycloudflare.com/mcp |
| 人物换脸 | 18611 | 8601 | https://pan-follow-ratio-epic.trycloudflare.com/mcp |

两端均使用 Streamable HTTP 和独立 Bearer token。令牌保存在服务器 `general.token`、`deepfake.token`，权限为600；带令牌的百炼配置 `bailian-general.json`、`bailian-deepfake.json` 同样为600，不进入Git。接口只监听回环地址，由 Cloudflare 临时隧道提供HTTPS入口。隧道重建后地址会变化，必须同步更新百炼配置与 `VIDEO_PUBLIC_HOSTS`。当前是测试接入，不是固定域名的长期部署。

## 工具

- `get_detection_status`：检查对应模型后端就绪状态，不运行检测。
- `submit_video_detection`：提交本模块检测，参数为 `video_url` 或 `video_path`，二选一，返回 `job_id`。URL必须是公网HTTPS、443端口；每次跳转检查目标网络地址。服务器路径仅允许本目录 `uploads/` 内文件，限制100MiB。
- `get_detection_result`：查询任务状态；`include_details=true` 返回移除大图后的结构化结果。
- `get_detection_report`：获取已完成任务Markdown报告。

每模块串行推理，最多8个未完成任务，调用已有后端超时1800秒。结果持久化在 `jobs/<module>/<job_id>/`；服务重启前未完成任务返回interrupted，不自动重复检测。URL下载的视频在任务结束后删除，结果与本地上传文件仍保留，由使用者按需要清理。

## 外部模型费用

已有后端含外部视觉模型复核，可能发送采样画面并产生费用。适配器默认拒绝提交检测；仅在用户明确同意数据传输和费用后，调用方可设置 `allow_external_review=true`。本次部署只验证MCP认证、初始化、工具发现、模型健康和默认拦截，未触发付费视频推理。

## 启动

SDK：Python3.11+，`mcp==1.30.0`。独立 `.venv` 不改动模型推理环境。

```sh
cd /mnt/vos-6d37s2q0/users/mxz/projects/video-mcp
VIDEO_MODULE=general VIDEO_MCP_PORT=18610 VIDEO_PUBLIC_HOSTS=ahead-views-powers-sci.trycloudflare.com \
 nohup .venv/bin/python server.py >> logs/general.log 2>&1 < /dev/null &
VIDEO_MODULE=deepfake VIDEO_MCP_PORT=18611 VIDEO_PUBLIC_HOSTS=pan-follow-ratio-epic.trycloudflare.com \
 nohup .venv/bin/python server.py >> logs/deepfake.log 2>&1 < /dev/null &
```

启动前确认端口未被当前服务占用，避免重复启动。服务以nohup运行，可跨SSH断开存活；未配置开机自启。

隧道命令（重启后必须记录新地址并更新配置）：

```sh
nohup bin/cloudflared tunnel --no-autoupdate --protocol http2 --url http://127.0.0.1:18610 >> logs/general-tunnel.log 2>&1 < /dev/null &
nohup bin/cloudflared tunnel --no-autoupdate --protocol http2 --url http://127.0.0.1:18611 >> logs/deepfake-tunnel.log 2>&1 < /dev/null &
```

本机与公网协议验证脚本分别为服务器 `verify.py` 和 `verify_public.py`，不输出令牌。
