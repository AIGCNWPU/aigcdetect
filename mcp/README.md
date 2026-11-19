# VERITAS 音频检测 · MCP Server

一个 server、一个工具，把「音频伪造检测」接进任何支持 MCP 的客户端（Claude Desktop、Cursor、Qoder、自研 Agent）。

```
MCP client ──stdio/HTTP──▶ mcp/server.mjs ──HTTP──▶ web 网关 :8080 ──▶ audio :8000
```

**只有一个工具 `detect_audio_forgery`，没有 `mode` 参数。** 单人还是双人由服务端判断：
单人返回整段结论，双人对话返回"谁被伪造"。模型和用户都不需要关心这件事。

## 快速开始（stdio）

1. 先把服务和模型起起来（见 [统一部署](../docs/统一部署.md)）：

```sh
./deploy/start-all.sh          # web :8080 + audio :8000
```

2. 客户端配置（Claude Desktop 的 `claude_desktop_config.json`）：

```json
{
  "mcpServers": {
    "veritas-audio": {
      "command": "node",
      "args": ["/绝对路径/aigcdetect-main/mcp/server.mjs"],
      "env": {
        "VERITAS_API_BASE": "http://127.0.0.1:8080",
        "VERITAS_API_KEY": ""
      }
    }
  }
}
```

也有示例文件：[claude-desktop.example.json](claude-desktop.example.json)。

3. 在客户端里问：「帮我看看 https://example.com/call.wav 这段通话有没有被 AI 伪造」——模型会自己调工具。

## 远程模式（Streamable HTTP）

```sh
node mcp/server.mjs --http 8787
# 端点是 http://<host>:8787/mcp，健康检查 /health
```

客户端填 `type: streamableHttp`、`url: http://<host>:8787/mcp`。

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `VERITAS_API_BASE` | `http://127.0.0.1:8080` | 网关地址（不是 8000，走网关才有统一鉴权/日志） |
| `VERITAS_API_KEY` | 空 | 非空时带 `Authorization: Bearer` |
| `VERITAS_TIMEOUT_MS` | `180000` | 单次检测超时；双人对话约 10–30 秒 |
| `MCP_FETCH_MAX_MB` | `40` | `audioUrl` 允许下载的大小上限 |

## 工具参数

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `audioUrl` | 二选一 | http(s) 直链；MCP server 会下载后转 base64 再送网关（服务端暂只收 base64） |
| `audioBase64` | 二选一 | 直接给音频内容 |
| `fileName` | 否 | 仅用于结果标识 |

## 返回

模型看到的是中文结论文本 + 结构化数据：

```
这段对话里 A 的声音是伪造的
- 共识别到 2 位说话人，对话时长 34.46 秒。
- A（SPEAKER_00）：伪造，本人语音 16.6 秒
- B（SPEAKER_01）：真人，本人语音 12.5 秒
```

`structuredContent` 里是原始 `data` 对象，前端/Agent 可继续加工。

## 测试

```sh
node --test tests/mcp.test.mjs     # summarize 的 7 条单测，不需要模型
```

## 上阿里云时怎么接

不用改这个 server，两条路都支持：

- **百炼「脚本部署 → 安装方式 http」**：只登记端点（`type: streamableHttp` + `url` + `headers`），不产生部署费用；
- **AI 网关**：如果不想维护 MCP 代码，可以让网关直接把 REST API 转成 MCP，这个 server 就可以不用。

细节见 [统一部署 · 为 API / MCP 包装做准备](../docs/统一部署.md#四为-api--mcp-包装做准备)。
