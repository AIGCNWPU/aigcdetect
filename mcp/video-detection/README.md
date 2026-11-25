# 视频检测 MCP

为 3.1 Native-Scale 和 3.2 VLAForge + YuNet 提供统一 MCP 接口。复用仓库 `skills/` 中的 CPU 检测客户端，不包含权重，不自动启动或修改现有后端。

## 安装和启动

Python 3.11+：

```sh
python3 -m venv .venv-mcp
.venv-mcp/bin/pip install -r mcp/video-detection/requirements.txt
```

先按两个 skill 的 `references/setup.md` 启动后端，默认地址分别为 `http://127.0.0.1:18600` 和 `http://127.0.0.1:18601`。必须使用包含 `skill.module` 健康标识的 skill 后端。

本地 MCP 客户端配置（替换绝对路径）：

```json
{
  "mcpServers": {
    "video-detection": {
      "command": "/absolute/repo/.venv-mcp/bin/python",
      "args": ["/absolute/repo/mcp/video-detection/server.py"],
      "env": {"VIDEO_INPUT_ROOT": "/absolute/videos", "VIDEO_OUTPUT_ROOT": "/absolute/reports"}
    }
  }
}
```

通过 HTTP 调用：

```sh
VIDEO_INPUT_ROOT=/absolute/videos .venv-mcp/bin/python mcp/video-detection/server.py --transport streamable-http
```

MCP 地址：`http://127.0.0.1:18700/mcp`，供支持 MCP 的 SDK/Agent 调用，使用标准 MCP 初始化、tools/list 和 tools/call；不是普通文件上传 REST 接口。本版监听本机，不直接对公网发布。

## 工具

| 工具 | 参数 | 返回 |
|---|---|---|
| get_detection_status | 无 | 两个后端健康信息 |
| submit_video_detection | video_path，module（general/deepfake/both） | job_id |
| get_detection_result | job_id | queued/running/completed/failed/interrupted，分模块结果和文件路径 |
| get_detection_report | job_id，module | Markdown 正文 |

调用顺序：提交本机视频绝对路径，保存 job_id，定期查询，完成后获取报告。JSON 证据保留在输出目录，MCP 结果不内联图片。

## 配置与边界

- `VIDEO_INPUT_ROOT` 默认 `~/Downloads`；拒绝范围外文件（包括解析符号链接后的越界路径）。
- `VIDEO_OUTPUT_ROOT` 默认仓库 `outputs/mcp`；报告持久化。重启前未完成任务标记为 interrupted，不自动重跑。
- `VIDEO_GENERAL_ENDPOINT`、`VIDEO_FACE_ENDPOINT` 可修改本机后端地址；拒绝远程上传和开启外部视觉复核的后端。
- `VIDEO_MCP_PORT` 默认 18700。单 worker 串行执行，最多 8 个未完成任务；每模块请求超时 1800 秒。
- 通用模块最大 500 MiB，人脸模块最大 100 MiB；视频时长、格式限制仍由后端检查。
- 输入文件应在任务完成前保持不变且可读取。提交的是服务器本机路径；远端客户端不能直接提交自己电脑的文件路径。
- 输出风险仅覆盖采样内容，不代表真实性认证。不会调用商用服务，也不改变模型授权条件。
