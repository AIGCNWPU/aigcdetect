# 阿里云百炼视频检测 MCP 调用接口文档

更新时间：2026-11-25

本文面向通过阿里云调用视频检测的业务系统、脚本和 MCP 客户端，不涉及服务器部署。

## 1. 接口地址

| 功能 | 服务名称 | MCP 地址 |
|---|---|---|
| 3.1 通用 AI 视频检测 | `veritas-video-general` | `https://dashscope.aliyuncs.com/api/v1/mcps/mcp-Nzc4MzA0ZDRhZWY5/mcp` |
| 3.2 人物换脸检测 | `veritas-video-deepfake` | `https://dashscope.aliyuncs.com/api/v1/mcps/mcp-ZTMyYmIzZTcwNmU4/mcp` |

通信协议为 **MCP Streamable HTTP**。两个服务提供相同名称的四个工具，通过不同地址区分检测模块。

这些地址不是普通 REST 接口，不能直接向其上传文件，也不能在地址后追加 `/detect`。推荐使用 MCP SDK，由 SDK 处理初始化、协议协商及工具调用。

## 2. 鉴权

使用拥有上述 MCP 服务访问权限的百炼账号的 **DashScope API Key**：

```http
Authorization: Bearer <YOUR_DASHSCOPE_API_KEY>
```

密钥通过环境变量 `DASHSCOPE_API_KEY` 提供。不要使用 GPU 服务器密码或服务器内部 MCP 令牌，也不要将密钥写入视频链接或提交到代码仓库。

以下示例默认使用创建服务的同一阿里云账号。其他账号的 Key 是否可访问，需要另行确认授权，不能直接假定跨账号可用。

## 3. 调用流程

1. 连接对应模块的 MCP 地址并初始化。
2. 调用 `get_detection_status`，确认模型就绪。
3. 调用 `submit_video_detection`，获得 `job_id`。
4. 间隔调用 `get_detection_result`，直到任务完成或失败。
5. 调用 `get_detection_report`，获取 Markdown 报告。

检测同一视频的两个模块时，分别连接两套服务、分别提交任务，保存各自的 `job_id`。

## 4. 工具接口

以下 JSON 为 `tools/call` 中的 **arguments 参数**，不是直接 POST 到 MCP 地址的完整请求体。Python SDK 的调用方式为：

```python
result = await session.call_tool("工具名称", arguments)
```

### 4.1 查询服务状态：`get_detection_status`

请求参数：

```json
{}
```

通用视频返回的数据示例：

```json
{
  "module": "general",
  "backend": {
    "status": "ok",
    "service": "native-scale-video-general",
    "engine": "native-scale",
    "modelReady": true,
    "checkpoint": true,
    "error": null
  },
  "external_review_notice": "Existing backend may call external vision models during detection. Explicit authorization is required."
}
```

人物换脸返回的数据示例：

```json
{
  "module": "deepfake",
  "backend": {
    "ready": true,
    "model": "智鉴",
    "device": "cuda",
    "parameters": 435967305,
    "visionReview": {
      "enabled": true,
      "mode": "low",
      "model": "deepseek-flash"
    }
  },
  "external_review_notice": "Existing backend may call external vision models during detection. Explicit authorization is required."
}
```

就绪判断：通用模块检查 `backend.modelReady`；换脸模块检查 `backend.ready`。健康查询不提交视频，不触发视觉复核。

### 4.2 提交检测：`submit_video_detection`

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|---|---|---|---|---|
| `video_url` | string | 与 video_path 二选一 | `""` | 可直接下载视频的公网 HTTPS 链接，推荐使用对象存储链接 |
| `video_path` | string | 与 video_url 二选一 | `""` | 已放入 GPU 服务器指定 uploads 目录的绝对路径；不是调用方电脑路径 |
| `allow_external_review` | boolean | 实际提交需为 true | `false` | 允许现有后端进行外部视觉复核；需事先取得画面传输及费用授权 |

推荐请求：

```json
{
  "video_url": "https://your-storage.example/videos/sample.mp4",
  "allow_external_review": true
}
```

`your-storage.example` 为占位地址，使用时替换为实际视频链接。

返回示例：

```json
{
  "job_id": "0123456789abcdef0123456789abcdef",
  "module": "general",
  "status": "queued"
}
```

输入要求：

- 文件最大 100 MiB；人物换脸视频最长 120 秒。建议使用 MP4，最终格式支持情况由后端解码器决定。
- URL 必须为公网 HTTPS、443 端口，不能含用户名、密码；不支持内网链接。每次重定向均检查目标地址。
- 视频链接应直接返回视频文件，不能是需要交互登录的分享页面。可使用仍在有效期内的 HTTPS 签名链接；当前接口没有自定义下载请求头参数。
- 若使用 `video_path`，文件必须位于 `/mnt/vos-6d37s2q0/users/mxz/projects/video-mcp/uploads/` 内。
- `allow_external_review=false` 会拒绝提交，当前接口不提供“跳过外部复核后检测”的选项。设置为 true 不表示每次一定调用外部模型。

### 4.3 查询检测结果：`get_detection_result`

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|---|---|---|---|---|
| `job_id` | string | 是 | 无 | 提交返回的任务 ID |
| `include_details` | boolean | 否 | `false` | 是否返回精简后的结构化检测详情 |

请求示例：

```json
{
  "job_id": "0123456789abcdef0123456789abcdef",
  "include_details": true
}
```

完成返回示例，分数和文字仅示意：

```json
{
  "job_id": "0123456789abcdef0123456789abcdef",
  "module": "general",
  "status": "completed",
  "risk": "high",
  "summary": "检测摘要由后端生成",
  "details": {
    "risk": "high",
    "summary": "检测摘要由后端生成"
  }
}
```

`details` 的具体字段依模块及检测结果而变化；图片等大型内容不通过此接口完整返回。风险标签包括 `low`、`medium`、`high`、`unknown`，不是准确率或真实性认证。

| status | 含义 | 处理方式 |
|---|---|---|
| `queued` | 排队中 | 继续查询 |
| `running` | 下载或推理中 | 继续查询 |
| `completed` | 完成 | 读取结果、获取报告 |
| `failed` | 失败 | 读取 error，判断原因后再决定是否重新提交 |
| `interrupted` | 服务重启导致未完成 | 不会自动恢复，确认后重新提交 |

建议每 5 秒查询一次。客户端停止查询不会自动取消服务器任务，不要因短暂超时重复提交同一视频。

### 4.4 获取报告：`get_detection_report`

请求示例：

```json
{
  "job_id": "0123456789abcdef0123456789abcdef"
}
```

返回 **Markdown 字符串**，包含模块、风险、摘要和结果解释范围。任务未完成或报告尚未生成时返回工具错误。当前接口不返回 PDF。

## 5. MCP 响应如何读取

工具返回遵循 MCP 的 `CallToolResult` 结构：

```json
{
  "isError": false,
  "content": [
    {
      "type": "text",
      "text": "{\"module\":\"general\",\"status\":\"queued\",\"job_id\":\"...\"}"
    }
  ]
}
```

应先检查 `isError`。前三个工具的文本内容可按 JSON 解析；`get_detection_report` 的文本内容为 Markdown，不进行 JSON 解析。

工具错误与检测失败不同：前者体现为 `isError=true`；任务已受理后发生的下载或推理失败体现为 `status=failed`，并带 `error`。

## 6. Python 完整调用示例

安装：

```bash
python -m pip install 'mcp==1.30.0'
```

将下面代码保存为 `call_video_mcp.py`。默认仅查询健康状态；只有传入实际视频 URL 并明确添加外部复核授权参数后，才提交检测。

```python
import argparse
import asyncio
import json
import os
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

IDS = {
    "general": "mcp-Nzc4MzA0ZDRhZWY5",
    "deepfake": "mcp-ZTMyYmIzZTcwNmU4",
}


def json_result(result):
    if result.isError:
        raise RuntimeError(str(result.content))
    return json.loads(result.content[0].text)


async def main(args):
    endpoint = f"https://dashscope.aliyuncs.com/api/v1/mcps/{IDS[args.module]}/mcp"
    headers = {"Authorization": "Bearer " + os.environ["DASHSCOPE_API_KEY"]}
    async with streamablehttp_client(endpoint, headers=headers) as (reader, writer, _):
        async with ClientSession(reader, writer) as session:
            await session.initialize()
            health = json_result(await session.call_tool("get_detection_status", {}))
            print(json.dumps(health, ensure_ascii=False, indent=2))
            if not args.video_url:
                return
            backend = health.get("backend", {})
            if not (backend.get("modelReady") or backend.get("ready")):
                raise RuntimeError("模型未就绪")
            if not args.allow_external_review:
                raise RuntimeError("提交前需取得外部复核授权")

            job = json_result(await session.call_tool("submit_video_detection", {
                "video_url": args.video_url,
                "allow_external_review": True,
            }))
            job_id = job["job_id"]
            print("job_id:", job_id, flush=True)
            for _ in range(720):
                result = json_result(await session.call_tool("get_detection_result", {
                    "job_id": job_id,
                    "include_details": True,
                }))
                if result["status"] == "completed":
                    print(json.dumps(result, ensure_ascii=False, indent=2))
                    report = await session.call_tool("get_detection_report", {
                        "job_id": job_id,
                    })
                    if report.isError:
                        raise RuntimeError(str(report.content))
                    print(report.content[0].text)
                    return
                if result["status"] in ("failed", "interrupted"):
                    raise RuntimeError(result.get("error", result["status"]))
                await asyncio.sleep(5)
            raise TimeoutError(f"查询已停止，可使用任务ID继续查询：{job_id}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("module", choices=IDS)
    parser.add_argument("--video-url")
    parser.add_argument("--allow-external-review", action="store_true")
    asyncio.run(main(parser.parse_args()))
```

通过终端安全设置环境变量，不将真实密钥粘贴到示例文件。以 Bash 为例：

```bash
read -rsp 'DashScope API Key: ' DASHSCOPE_API_KEY
export DASHSCOPE_API_KEY
printf '\n'
```

仅检查服务：

```bash
python call_video_mcp.py general
python call_video_mcp.py deepfake
```

已取得外部复核授权后，检测实际视频：

```bash
python call_video_mcp.py general \
  --video-url 'https://your-storage.example/videos/sample.mp4' \
  --allow-external-review

python call_video_mcp.py deepfake \
  --video-url 'https://your-storage.example/videos/sample.mp4' \
  --allow-external-review
```

示例使用 SDK 1.30.0 的接口。此完整脚本已做语法检查，尚未使用账号 DashScope API Key执行完整视频任务；不要将示例视为已完成实际视频调用验证。

## 7. 百炼控制台直接测试

1. 打开对应服务详情页：
   - [通用视频 MCP](https://bailian.console.aliyun.com/cn-beijing/flow-agent/mcp-manage/detail/mcp-Nzc4MzA0ZDRhZWY5/custom)
   - [人物换脸 MCP](https://bailian.console.aliyun.com/cn-beijing/flow-agent/mcp-manage/detail/mcp-ZTMyYmIzZTcwNmU4/custom)
2. 在工具列表展开 `get_detection_status`，点击“运行”，检查模型就绪状态。
3. 在目标百炼智能体中添加对应 MCP，便可由智能体调用上述工具。

截至 2026-11-25，两个服务的控制台健康查询均已“运行成功”。本次接入验证未通过百炼提交实际视频，也未触发收费外部复核。

## 8. 限制与错误处理

| 情况 | 处理建议 |
|---|---|
| HTTP 401 / 403 | 检查 DashScope API Key、账号及服务访问权限 |
| 无法连接 / 502 | 检查服务是否启用及其内部 HTTPS 隧道是否有效 |
| 工具返回 isError=true | 读取工具错误；优先检查参数、授权标志、路径和链接 |
| Queue full | 每模块最多8个未完成任务，等待后再提交 |
| 任务失败且后端返回429 | 后端正忙，确认任务状态后再决定重试 |
| 视频链接返回登录页 | 改用可直接下载视频的 HTTPS 链接 |
| 查询超时 | 保存 job_id 后继续查询，不自动重复提交 |
| 任务 interrupted | 服务曾重启，确认后重新提交 |

当前提交接口没有幂等键或任务取消；新增文件上传能力见第10节，待远端部署。相同视频重复提交会创建不同任务，可能重复消耗计算资源和外部模型费用。当前内部隧道为临时域名，重建后需维护方更新百炼连接配置。

## 9. 费用说明

百炼 HTTP 接入模式在创建页面标明“无部署资源消耗，服务无需计费”。这不意味着完整检测链路免费：GPU计算、视频存储与流量、现有后端外部视觉复核，以及智能体自身模型调用可能分别产生费用。本文不提供尚未确认的单次总价；批量调用前应确认各项预算。

## 10. 调用端直接上传视频（新增，待部署）

部署适配器新增 `POST /files`，随后可通过 MCP 的 `file_id` 参数提交。两个模块共用同一实现。以下能力已完成本地验证，尚未部署到远程服务器，百炼工具参数也需部署后刷新。

```text
调用端视频 → POST /files → file_id → submit_video_detection → job_id
```

上传接口使用对应服务器 MCP 的 Bearer 令牌，不使用 DashScope Key。`UPLOAD_BASE_URL` 指适配器的 HTTPS 域名根地址，不能填百炼 `/mcp` 地址；百炼不转发任意 `/files` 路径。令牌仅供可信后端使用，不要放进公开网页代码。

```bash
curl --fail-with-body "$UPLOAD_BASE_URL/files" \
  -H "Authorization: Bearer $VIDEO_UPLOAD_TOKEN" \
  -H 'Content-Type: video/mp4' \
  --data-binary '@./sample.mp4'
```

本接口接收原始视频字节，不使用 `-F` multipart 格式。返回 HTTP 201：

```json
{"file_id":"0123456789abcdef0123456789abcdef","module":"general","size_bytes":123456}
```

随后通过原有百炼 MCP 会话调用：

```python
result = await session.call_tool("submit_video_detection", {
    "file_id": "0123456789abcdef0123456789abcdef",
    "allow_external_review": True,
})
```

`file_id`、`video_url`、`video_path` 必须且只能提供一个。后续查询与获取报告不变。文件最大100MiB；空文件400、未鉴权401、过大413、不支持的上传类型415、上传目录配额不足507。上传目录默认总配额1GiB，上传串行进行。文件扩展名不等于格式验证，能否解码由检测后端决定。

上传本身不触发模型推理。当前文件会留在服务器，尚未自动过期，维护方需管理空间；`file_id` 是文件标识而非独立访问凭据。两个服务采用模块令牌鉴权，未实现多用户文件所有权隔离，不应作为公开多租户上传平台。
