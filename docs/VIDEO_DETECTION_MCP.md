# 视频检测 MCP 接口与部署文档

| 项目 | 内容 |
|---|---|
| 文档日期 | 2026-11-25 |
| 适用模块 | 3.1 通用 AI 生成视频检测；3.2 人物换脸与深度伪造检测 |
| 当前实现 | 本地 CPU 统一服务；服务器端两个独立 MCP 服务 |
| 通信协议 | 本地支持 stdio、Streamable HTTP；服务器使用 Streamable HTTP |
| 代码版本 | 初始 MCP 实现已提交至 `czy/video-detection-skills`，提交 `fa16ed2` |

## 1. 功能概述

MCP 服务为 AI 助手、百炼智能体及支持 MCP 的客户端提供视频检测工具。服务接收检测请求、调度已有模型后端、保存结果，并提供状态查询和报告读取。

- **通用视频检测**：采用 Native-Scale，分析视频采样窗口中的生成痕迹。
- **人物换脸检测**：采用 VLAForge + YuNet，对采样人脸进行深度伪造检测。

MCP 适配层本身不加载模型、不直接使用 GPU。模型推理由已有检测后端完成。检测结果仅覆盖实际采样内容，风险分数不等同于真实性概率或准确率。

## 2. 系统架构

```text
百炼智能体 / MCP 客户端
        │
        │ Streamable HTTP + 百炼账号 API Key
        ▼
百炼 MCP 接入层
        │
        │ HTTPS + 独立服务 Bearer token
        ▼
Cloudflare 临时 HTTPS 隧道
        │
        ├─ 通用视频 MCP：127.0.0.1:18610
        │       └─ HTTP API：127.0.0.1:8600 → Native-Scale
        │
        └─ 人物换脸 MCP：127.0.0.1:18611
                └─ HTTP API：127.0.0.1:8601 → VLAForge + YuNet
```

服务器目录：

```text
/mnt/vos-6d37s2q0/users/mxz/projects/video-mcp/
├── server.py                MCP 适配服务
├── run.sh                   单模块启动脚本
├── .venv/                   MCP 独立 Python 环境
├── general.token            通用视频服务令牌，权限 600
├── deepfake.token           人物换脸服务令牌，权限 600
├── bailian-general.json     通用视频百炼配置，含令牌
├── bailian-deepfake.json    人物换脸百炼配置，含令牌
├── uploads/                 允许提交的服务器本地视频
├── jobs/<module>/<job_id>/  任务状态、结果和报告
├── logs/                    服务、隧道与验证日志
├── bin/cloudflared          HTTPS 隧道程序
├── verify.py                本机 MCP 验证脚本
└── verify_public.py         公网 MCP 验证脚本
```

上述令牌和带令牌的配置文件不进入 Git。部署使用独立 Python 环境，未修改或重启原有模型后端。

## 3. 服务地址与鉴权

### 3.1 百炼服务

| 服务名称 | 服务 ID | 控制台 |
|---|---|---|
| `veritas-video-general` | `mcp-Nzc4MzA0ZDRhZWY5` | [通用视频 MCP](https://bailian.console.aliyun.com/cn-beijing/flow-agent/mcp-manage/detail/mcp-Nzc4MzA0ZDRhZWY5/custom) |
| `veritas-video-deepfake` | `mcp-ZTMyYmIzZTcwNmU4` | [人物换脸 MCP](https://bailian.console.aliyun.com/cn-beijing/flow-agent/mcp-manage/detail/mcp-ZTMyYmIzZTcwNmU4/custom) |

百炼对外 MCP 端点：

```text
通用视频：
https://dashscope.aliyuncs.com/api/v1/mcps/mcp-Nzc4MzA0ZDRhZWY5/mcp

人物换脸：
https://dashscope.aliyuncs.com/api/v1/mcps/mcp-ZTMyYmIzZTcwNmU4/mcp
```

外部客户端访问以上端点时，使用该百炼账号自己的 DashScope API Key：

```http
Authorization: Bearer <YOUR_DASHSCOPE_API_KEY>
```

### 3.2 服务器直连端点

截至部署时，服务器的临时公网端点如下：

| 模块 | 临时端点 |
|---|---|
| 通用视频 | `https://ahead-views-powers-sci.trycloudflare.com/mcp` |
| 人物换脸 | `https://pan-follow-ratio-epic.trycloudflare.com/mcp` |

直连端点使用对应的服务器服务令牌，而不是 DashScope API Key。未携带有效令牌的请求返回 HTTP 401。

**两类密钥不能混用。** 百炼配置中的服务令牌用于百炼访问 GPU 服务器；客户端的 DashScope API Key 用于访问百炼接入层。

临时隧道重建后域名会变化。即使百炼对外地址不变，也必须更新其内部服务配置，否则无法继续转发至 GPU 服务器。当前尚未配置固定域名和开机自启。

## 4. 服务器版工具接口

两个服务器版 MCP 各提供以下四个工具，工具名称相同，但只操作各自模块。工具调用必须先完成 MCP 初始化，不能将 `/mcp` 当作普通 REST 文件上传接口使用。

### 4.1 `get_detection_status`

查询当前模块及后端模型状态，无参数，不执行检测。

通用视频返回示例：

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

人物换脸就绪状态使用 `backend.ready`，并可返回 `device`、`parameters` 和 `visionReview`。后端不可达时，工具返回 `ready=false` 和错误类型；调用方必须检查就绪状态，不能仅以 MCP 请求成功判断模型可用。

### 4.2 `submit_video_detection`

提交任务后立即返回 `job_id`，通过结果工具查询执行进度。

| 参数 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `video_url` | string | 空字符串 | 可直接下载视频的公网 HTTPS 地址 |
| `video_path` | string | 空字符串 | GPU 服务器 `uploads/` 目录内的视频绝对路径 |
| `allow_external_review` | boolean | `false` | 明确允许现有后端进行外部视觉复核 |

输入约束：

1. `video_url` 与 `video_path` 必须且只能提供一个。
2. URL 只支持 HTTPS、443 端口，不允许 URL 用户名和密码；解析地址需为公网地址，重定向目标同样受检查。不支持需要交互登录、Cookie 或额外下载请求头的链接。
3. 本地路径解析符号链接后仍必须位于服务器 `uploads/` 目录内。客户端电脑上的路径不能直接作为服务器路径使用。
4. 两个服务器版接口均限制最大 100 MiB；人物换脸后端另有限制，视频最长 120 秒。支持的视频格式仍由后端和解码器决定，建议使用 MP4。
5. 每模块串行执行，最多保留 8 个未完成任务，包含运行中和排队任务。两个模块可分别运行；已有前端请求仍可能占用同一模型后端。
6. 当前服务器后端可能调用外部视觉模型。默认 `allow_external_review=false` 会拒绝提交，不是“自动关闭复核后继续检测”。必须先取得用户对视频画面传输和费用的授权，再设为 `true`。

以下为已取得外部复核授权后的请求示例，域名仅为占位：

```json
{
  "video_url": "https://your-storage.example/videos/sample.mp4",
  "allow_external_review": true
}
```

提交服务器本地视频：

```json
{
  "video_path": "/mnt/vos-6d37s2q0/users/mxz/projects/video-mcp/uploads/sample.mp4",
  "allow_external_review": true
}
```

返回示例：

```json
{
  "job_id": "0123456789abcdef0123456789abcdef",
  "module": "general",
  "status": "queued"
}
```

### 4.3 `get_detection_result`

| 参数 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `job_id` | string | 必填 | 提交时返回的 32 位任务 ID |
| `include_details` | boolean | `false` | 是否附带精简后的结构化检测结果 |

```json
{
  "job_id": "0123456789abcdef0123456789abcdef",
  "include_details": true
}
```

完成时返回 `job_id`、`module`、`status`、`risk` 和 `summary`；请求详情时附加 `details`。详情的字段取决于对应模型后端，可能包括人物、片段或检测线索。大图及部分大型字段被移除或替换，完整原始响应保存在服务器 `result.json`。

任务状态：

| 状态 | 含义 | 调用方处理 |
|---|---|---|
| `queued` | 等待执行 | 间隔查询，避免高频轮询 |
| `running` | 下载或检测中 | 继续等待 |
| `completed` | 检测完成 | 读取结果或报告 |
| `failed` | 下载、后端请求或结果处理失败 | 检查 `error`，修复原因后决定是否重新提交 |
| `interrupted` | 服务重启前的任务未完成 | 不会自动恢复；确认后重新提交 |

`low`、`medium`、`high`、`unknown` 为后端风险标签，不是任务状态。`failed` 不应被解释为低风险。

### 4.4 `get_detection_report`

参数为必填的 `job_id`。成功返回 Markdown 字符串，内容包括模块、风险、摘要和解释范围。报告未生成时返回工具错误。

```json
{
  "job_id": "0123456789abcdef0123456789abcdef"
}
```

当前服务器版生成的是简要 Markdown 报告，不提供 PDF 导出、证据文件公网下载或空间热力图接口。

## 5. 推荐调用流程

```text
查询模型状态
  → 确认输入视频及外部复核授权
  → 提交检测，保存 job_id
  → 每隔数秒查询状态
  → completed：读取结果和报告
  → failed / interrupted：记录原因，按需重新提交
```

同一个视频需要检测两个模块时，分别调用两套 MCP 服务，并分别保存任务 ID。服务器版的提交参数没有 `module=both`。

建议给智能体配置以下调用规则：

> 先查询模型是否就绪；未就绪时返回原因。提交前确认视频地址可访问，并取得外部视觉复核所需的数据传输及费用授权。提交后保留任务ID，间隔查询。只根据实际返回的检测证据回答，不将未检出表述为已证明真实。不要自动反复提交失败任务。

## 6. 客户端接入示例

### 6.1 在百炼智能体中使用

在百炼 MCP 管理中找到两个已启用服务，再在目标智能体的 MCP 工具配置中添加所需服务。可先运行无参数的 `get_detection_status`，确认模型就绪，再测试授权的视频任务。

本次仅创建并验证 MCP 服务，未创建新的百炼智能体。

### 6.2 Python MCP SDK

安装本项目采用的 SDK 版本：

```bash
python -m pip install 'mcp==1.30.0'
```

下例默认只查询健康状态。仅在已经取得授权、同时配置 `VIDEO_URL` 和 `ALLOW_EXTERNAL_REVIEW=true` 时，才会提交实际检测。API Key 从环境变量读取，不写入源码。

```python
import asyncio
import json
import os
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

SERVICE_IDS = {
    "general": "mcp-Nzc4MzA0ZDRhZWY5",
    "deepfake": "mcp-ZTMyYmIzZTcwNmU4",
}


def decode(result):
    if result.isError:
        raise RuntimeError(str(result.content))
    return json.loads(result.content[0].text)


async def main():
    module = os.environ.get("VIDEO_MODULE", "general")
    url = (
        "https://dashscope.aliyuncs.com/api/v1/mcps/"
        + SERVICE_IDS[module] + "/mcp"
    )
    headers = {"Authorization": "Bearer " + os.environ["DASHSCOPE_API_KEY"]}
    async with streamablehttp_client(url, headers=headers) as (reader, writer, _):
        async with ClientSession(reader, writer) as session:
            await session.initialize()
            status = decode(await session.call_tool("get_detection_status", {}))
            print(status)
            backend = status.get("backend", {})
            if not (backend.get("ready") or backend.get("modelReady")):
                raise RuntimeError("Detection backend is not ready")

            video_url = os.environ.get("VIDEO_URL")
            if not video_url:
                return  # 默认仅检查服务状态
            if os.environ.get("ALLOW_EXTERNAL_REVIEW") != "true":
                raise RuntimeError("Obtain external-review authorization first")

            job = decode(await session.call_tool("submit_video_detection", {
                "video_url": video_url,
                "allow_external_review": True,
            }))
            job_id = job["job_id"]
            print("job_id:", job_id)  # 保存该ID，便于客户端重连后继续查询
            for _ in range(720):
                result = decode(await session.call_tool("get_detection_result", {
                    "job_id": job_id,
                    "include_details": False,
                }))
                if result["status"] == "completed":
                    print(result)
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
            raise TimeoutError("Polling stopped; keep job_id to query later")


asyncio.run(main())
```

上述 SDK 示例为接口使用示例，未使用账号 DashScope API Key执行实测。已完成的百炼验证使用控制台工具测试，见第 10 节。

## 7. 本地 CPU 版与服务器版的区别

仓库保留两个入口，不应混用参数和端口。

| 项目 | 本地 CPU 统一版 | 当前 GPU 服务器版 |
|---|---|---|
| 入口 | `mcp/video-detection/server.py` | `mcp/video-detection/deploy/server.py` |
| 服务形式 | 一个 MCP 选择两个模块 | 每模块独立 MCP |
| MCP 端口 | 默认 18700 | 18610 / 18611 |
| 检测后端 | skill 后端 18600 / 18601 | 已有后端 8600 / 8601 |
| 输入 | 允许目录内的本机路径 | 公网 HTTPS URL 或服务器 uploads 路径 |
| 提交参数 | `video_path`、`module` | `video_url` 或 `video_path`、`allow_external_review` |
| 双模块检测 | `module=both` | 分别调用两套服务 |
| 获取报告 | `job_id`、`module` | `job_id` |
| 最大文件 | 通用 500 MiB；人脸 100 MiB | 两模块均 100 MiB |
| 外部复核 | 拒绝开启外部复核的后端 | 明确授权后才允许提交 |
| 对外访问 | 默认仅本机使用，无 Bearer 包装 | Bearer 鉴权 + HTTPS 隧道 |

本地版安装、后端启动和客户端配置详见 [本地 MCP 说明](../mcp/video-detection/README.md)。服务器版维护说明详见 [部署说明](../mcp/video-detection/deploy/README.md)。

## 8. 服务器部署与维护

### 8.1 依赖与配置

服务器版使用 Python 3.11+、独立虚拟环境和 `mcp==1.30.0`。模型后端必须提前运行，MCP 不负责启动模型。

| 环境变量 | 说明 |
|---|---|
| `VIDEO_MODULE` | 必填，`general` 或 `deepfake` |
| `VIDEO_MCP_PORT` | 默认按模块使用 18610 或 18611 |
| `VIDEO_PUBLIC_HOSTS` | 允许的公网 Host，多个值用英文逗号分隔，仅填写域名 |

令牌读取自入口目录的 `<module>.token`。当前代码的模型 API 地址固定为本机 8600 / 8601，修改模型端口时需要同步调整源码。

### 8.2 启动与检查

先检查端口，避免重复启动：

```bash
ss -lntp | grep -E ':8600|:8601|:18610|:18611'
```

在现有部署目录启动相应模块：

```bash
cd /mnt/vos-6d37s2q0/users/mxz/projects/video-mcp
nohup bash run.sh general >> logs/general.log 2>&1 < /dev/null &
nohup bash run.sh deepfake >> logs/deepfake.log 2>&1 < /dev/null &
```

`run.sh` 从对应 `bailian-<module>.json` 读取公网 Host。以上启动命令只应用于尚未运行的服务。停止或重启时先核对本账号的具体 PID，不批量终止共享服务器上的 Python、Uvicorn 或 Cloudflare 进程。

验证命令：

```bash
.venv/bin/python verify.py
.venv/bin/python verify_public.py
```

### 8.3 隧道和域名变更

当前隧道使用 Cloudflare 临时域名，进程通过 nohup 启动。隧道重建后需要：

1. 从对应 `logs/<module>-tunnel.log` 确认新 HTTPS 域名。
2. 更新服务器 `bailian-<module>.json` 中的 URL，保留正确令牌。
3. 使用更新后的 Host 重启对应 MCP 适配服务，使 Host 校验配置生效。
4. 在百炼“编辑服务”中更新连接配置。
5. 重新验证工具发现与健康查询。

不得通过关闭鉴权或关闭 Host 校验来解决域名配置错误。长期使用建议配置固定域名和进程托管；这些尚未包含在当前部署中。

### 8.4 结果存储

成功任务目录包含：

```text
jobs/<general|deepfake>/<job_id>/
├── status.json   任务状态与摘要
├── result.json   后端原始响应，可能含图片证据
├── compact.json  精简后的结构化结果
└── report.md     简要 Markdown 报告
```

通过 URL 下载的临时输入视频在任务结束后清理；本地 uploads 文件、结果和日志保留。当前没有自动过期策略、分页任务列表、任务取消接口或自动恢复队列，需要按业务要求维护磁盘空间。

## 9. 常见问题

| 现象 | 检查与处理 |
|---|---|
| HTTP 401 | 检查访问的是百炼端点还是服务器端点，并使用相应密钥；确认 Bearer 请求头格式 |
| 404 / 502 / 无法连接 | 检查 URL、`/mcp` 路径、隧道进程和模型端口；临时域名可能已变化 |
| Host 校验失败 | 确认 `VIDEO_PUBLIC_HOSTS` 与当前隧道域名一致 |
| 百炼已启用但工具调用失败 | “已启用”不代表模型可用，应运行 `get_detection_status` 并核对日志 |
| 默认提交被拒绝 | 当前服务器版要求外部视觉复核授权；`false` 不会自动关闭后端复核 |
| 本地文件找不到 | 服务器无法读取客户端电脑路径；使用可下载 URL 或先上传至服务器 uploads 目录 |
| URL 下载失败 | 检查链接是否直接返回视频、是否需要登录、是否过期及目标是否为公网 HTTPS |
| Queue full | 等待已有任务结束；不应连续重试提交相同视频 |
| 后端 HTTP 429 | 模型后端可能正被前端或其他请求占用，确认原任务状态后再决定重试 |
| 任务 failed | 检查 `error` 和模块日志，不能将失败视为检测通过 |
| 任务 interrupted | MCP 服务曾重启；保存旧任务记录，确认后重新提交 |
| 只返回部分帧或片段 | 当前模型为采样检测，不代表全帧覆盖或完整时空定位 |

单次后端请求超时设置为 1800 秒，视频下载使用独立超时。客户端停止轮询或请求超时不会自动取消服务器任务，重复提交可能造成重复计算及费用。

## 10. 已完成验证与当前边界

截至 2026-11-25，已完成：

- 本地 CPU 版：MCP 初始化、工具发现、目录边界检查和模拟任务流程；另使用真实与换脸视频完成两模块端到端功能验证。
- 服务器版：两个独立 MCP 进程和 HTTPS 隧道正常运行，未授权请求返回 401。
- 服务器本机及公网：MCP 初始化、四个工具发现和对应模型健康查询通过。
- 百炼：两个服务显示“已启用”，各识别四个工具；`get_detection_status` 均“运行成功”。通用视频返回 `modelReady=true`，人物换脸返回 `ready=true`、`device=cuda`。
- 服务器与本地部署适配源码的 SHA256 已核对一致。

**本次服务器接入验证未提交实际视频检测，也未触发付费外部视觉复核。** 因此，不将健康查询通过等同于服务器版完整视频任务已验证。URL 视频提交、长任务轮询及服务器报告生成仍需在授权后补充端到端实测。

当前为测试部署，尚不具备固定域名、开机自启、跨进程任务队列、用户级任务隔离、调用配额和自动清理策略。两个服务令牌仅适合当前受控接入，不能直接视为多租户产品的权限方案。
