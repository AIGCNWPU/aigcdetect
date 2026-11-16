# VERITAS 智鉴 · 2.1/2.3 对外市场 API（Python）

阿里云市场风格的检测服务：`POST` + `base64`/`URL` 入参，统一信封
`{"code","msg","success","taskNo","data"}`，篡改区域返回原图像素坐标 `tamperedLocation` 与热力图 `heatmap`。
设计与任务分解见 `docs/image-workstream/market-api-and-mcp-tasks.md`（MCP 为下一阶段 P1）。

## 覆盖的功能

| 场景 | 能力 |
| --- | --- |
| 2.1 通用图片检测 | 整图 AI 生成检测（结论/分数/覆盖范围）、局部篡改检测（分数/阈值/热力图/区域框）、人像伪造分析（逐脸框与分数）、生成来源候选（闭集）、文件凭证与生成来源声明（C2PA/厂商声明） |
| 2.3 材料核验 | 多材料提交（图片/PDF/DOCX）、五种核验目的、核心材料指定、人工关联确认、模型开关、智能复核与隐私模式、逐材料字段/原文/坐标/检查结果、跨材料比对、结论统计与适用限制 |
| 2.3 字段提取 | 单份材料 OCR 字段 + 原文 + 页状态（`runModels=false` 轻量链路） |

## 启动

```sh
# 离线回放模式（联调/自动化测试；data.dataSource="fixture"，不可当真实检测结果）
AIGC_MARKET_API_MODE=fixture uvicorn app:app --host 0.0.0.0 --port 8090

# 真实引擎模式（转发平台 Node 服务）
AIGC_MARKET_API_MODE=upstream \
AIGC_MARKET_API_UPSTREAM=http://127.0.0.1:4173 \
AIGC_MARKET_API_APPCODES=你的AppCode1,你的AppCode2 \
uvicorn app:app --host 0.0.0.0 --port 8090
```

环境变量：`AIGC_MARKET_API_MODE`（upstream|fixture，默认 upstream）、`AIGC_MARKET_API_UPSTREAM`、
`AIGC_MARKET_API_APPCODES`（逗号分隔，未配置时仅接受 `dev-apicode`）、`AIGC_MARKET_API_SYNC_TIMEOUT`（默认 180s）。

## 鉴权

请求头 `Authorization: APPCODE <code>`；缺失或无效返回 HTTP 401 + `{"code":401,...}`。

## 接口

| 接口 | 方法 | 说明 |
| --- | --- | --- |
| `/health` | GET | 健康检查（含当前模式） |
| `/v1/image/general/detection` | POST | 2.1 提交检测；默认同步等待，`asyncSubmit=true` 立即返回 taskNo |
| `/v1/image/general/detection/result` | POST/GET | 按 `taskNo` 查询 2.1 结果 |
| `/v1/document/review` | POST | 2.3 提交核验（JSON 完整形态或 form 单材料快捷模式） |
| `/v1/document/review/result` | POST/GET | 按 `taskNo` 查询 2.3 结果 |
| `/v1/document/fields` | POST | 单份材料字段提取 |

### 请求参数

**2.1**（form 或 JSON）：`image`/`imageUrl` 二选一（JPG/PNG/WebP，≤20MB）；`restrictProbability`（区域置信度阈值 0~1，默认 0.5）、`maxLocations`（默认 8）、`features`（`base,tamper,face,source,provenance` 子集，默认全部）、`asyncSubmit`、`syncTimeoutSeconds`（5~300）。

**通用新增（2026-11-16，openspec refine-image-documents-workflow）**：
- `mode`（2.3）：`single`=单材料鉴伪（每份独立：篡改+单份内容核验，不做跨材料、不受理 confirmations、coreMaterialIndex 可省）；`batch`=多材料业务核验（默认）。
- `tamperScore`（0–100，未校准，参考线 60）与 `tamperVerdict`（tampered/no_obvious_tamper）：2.1 在 `data.tamper`，2.3 在 `materials[].tamperScore`（seed 分数换算）。
- `materials[].quality`：`{blurry,handwritten,photocopy,screenRecapture,screenshot,scanned}` 概率 + 中文建议（启发式提示，非结论）。
- `tamperedLocation[].probability`（2.3）：逐区域置信度（SEED 连通域均值 `mask_score_mean`）。
- `includeOverlay=true`：返回叠加可视化图（2.1 `data.tamperOverlay`，2.3 `materials[].tamperOverlay`，JPEG base64）。
- 响应信封新增 `duration`（毫秒）。
- `materialType`/`materials[].type` 支持 `auto`：以 unknown 提交，平台 OCR 分类器自动回填真实类别。

**2.3**（JSON 完整形态）：

```json
{
  "objective": "invoice_review",
  "jurisdiction": "CN", "region": "unspecified", "businessDate": "2026-01-30",
  "coreMaterialIndex": 0,
  "materials": [
    {"name": "发票.png", "type": "invoice", "image": "<base64>"},
    {"name": "合同.pdf", "file": "<base64>"}
  ],
  "mode": "single",
  "confirmations": [{"materialIndex": 1, "reason": "同一笔付款", "sameInvoice": true, "sameAmountScope": true}],
  "options": {"runModels": true, "semanticReview": false, "privacyMode": "redacted"},
  "includePreview": false, "includeOverlay": false, "asyncSubmit": false
}
```

form 快捷模式：`image`（或 `imageUrl`/`file`）+ `materialType` + `objective` 等；
`objective` 取值：`invoice_review | procurement_review | merchant_reconciliation | research_reimbursement | identity_consistency`。

### 返回信封与关键字段

```json
{
  "code": 200, "msg": "成功", "success": true, "taskNo": "20261111153000123456789012",
  "data": {
    "detectionResult": "suspected_ai_generated",
    "aiScore": {"score": 98.43, "semantics": "uncalibrated_model_signal", "coverage": "整图", "decisionBasis": "model_signal"},
    "tamper": {
      "status": "completed", "detectionResult": "suspicious",
      "score": 0.998346, "threshold": 0.5, "scoreSemantics": "uncalibrated",
      "heatmap": "<base64 png>", "heatmapFormat": "png", "meanConfidence": 0.945551,
      "tamperedLocation": [
        {"top": 0, "left": 0, "width": 256, "height": 256, "probability": 0.943585}
      ],
      "locationCoordinates": "exif_oriented_full_image"
    },
    "faceForgery": {"status": "completed", "analyzedFaceCount": 5, "detectionResult": "no_obvious_signal",
                     "faces": [{"index": 1, "detectionResult": "normal", "score": 0.000607, "threshold": 0.5,
                                 "box": {"top": 659, "left": 1217, "width": 122, "height": 174}}]},
    "sourceCandidates": {"status": "completed", "closedSet": true, "calibration": "uncalibrated_closed_set",
                          "candidates": [{"source": "midjourney 6", "score": 0.47}]},
    "provenance": {"c2pa": "absent", "aiDeclarationsFound": true, "declarationSummary": "…",
                    "providerChecks": [{"provider": "doubao", "name": "豆包", "status": "not_found", "declarations": []}]},
    "image": {"format": "PNG", "width": 2528, "height": 1696, "sha256": "…"},
    "engine": {"tamper": "TruFor · weights ac1d90e329a72e0d…"},
    "task": {"taskNo": "…", "platformTaskId": "…", "status": "completed", "dataSource": "engine"}
  }
}
```

2.3 `data`：`objective`、`conclusion{result,issueCount,checkStats{fail,pass,nei,notApplicable,error},summary}`、
`issues[{title,message,materials[],evidence[{field,value,page,observedText,box}]}]`、
`materials[{index,name,type,role,status,pages[{page,status,tamperedLocation[],preview?}],fields[{key,value,confidence,page,observedText,box}],checks[{title,status,explanation}],stages{…}}]`、
`crossChecks[]`、**`aiReview`（智能核验）**、`actions[]`、`limitations[]`、`engine{engineVersion,batchVersion,semanticReviewEngine}`、`task{…}`。
状态枚举全部小写下划线（`pass|fail|nei|not_applicable|error`），不含内部规则码。

### 智能核验（智能复核）

请求 `options.semanticReview=true` 时，平台把本地规则无法判定的事项（B 级待审项）交由大模型复核；
`privacyMode`（`redacted` 脱敏 / `original` 原文，默认 redacted）控制外发内容的脱敏程度。
平台侧需配置 `REVIEW_ENGINE=direct`、`DEEPSEEK_ENABLED=true`、`DEEPSEEK_API_KEY`（密钥仅存服务端，本 API 不透传）。

```json
"options": {"runModels": true, "semanticReview": true, "privacyMode": "redacted"}
```

返回 `data.aiReview`：

```json
{
  "status": "completed",
  "summary": "本次仅对两张发票及二者关联作内容核查：…",
  "privacyMode": "redacted",
  "reason": null,
  "findings": [
    {
      "verdict": "issues_found",
      "explanation": "m1内部金额口径不一致：不含税金额1999.99、税额259.99，但价税合计…",
      "warning": "m1价税合计与不含税金额相同却另列税额259.99，金额口径矛盾…",
      "recommendation": "核实发票金额栏位及税额计算…",
      "materials": ["invoice-a.jpg"],
      "evidence": [
        {"field": "gross_amount", "value": "1999.99", "confidence": 0.982,
         "page": 1, "observedText": "¥1999.99", "box": {"top": 738, "left": 1231, "width": 132, "height": 31}}
      ]
    }
  ],
  "disclaimer": "智能复核为辅助参考，不构成新增鉴伪证据；本地确定结论不因复核改变。"
}
```

`findings[].evidence` 由平台的证据指针（字段/文本块 ID）解析为实值；未执行时 `status="not_run"` 且
`reason` 给出原因（`disabled` / `provider_disabled` / `provider_not_configured` / `no_pending_items` 等）。

### 错误码（HTTP 200 业务信封，鉴权错误 HTTP 401）

| code | 含义 |
| --- | --- |
| 200 | 成功（含任务仍在排队/处理中的同步超时返回，`data.task.status` 为 `queued/running`） |
| 400 | 参数错误（缺图、base64 无效、URL 拉取失败、枚举非法等，`detail` 给出细节） |
| 401 | APPCODE 缺失或无效 |
| 404 | taskNo 不存在 |
| 413 | 文件超限（图片 20MB / 文档 12MB） |
| 500 | 平台处理失败 |
| 503 | 平台服务不可达（upstream 模式） |

## 调用示例

### Python（urllib3，与阿里云市场示例同构）

```python
import base64, urllib.parse, urllib3

host = 'http://127.0.0.1:8090'
appcode = '你的AppCode'
http = urllib3.PoolManager()
headers = {'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
           'Authorization': 'APPCODE ' + appcode}

# 2.1 通用图片检测（同步）
image_b64 = base64.b64encode(open('doubao.png', 'rb').read()).decode()
post_data = urllib.parse.urlencode({
    'image': image_b64,
    'restrictProbability': '0.5',
    'maxLocations': '8',
    'features': 'base,tamper,face,source,provenance',
}).encode('utf-8')
response = http.request('POST', host + '/v1/image/general/detection', body=post_data, headers=headers)
print(response.data.decode('utf-8'))   # data.detectionResult / data.tamper.tamperedLocation …

# 2.3 多材料核验（JSON）
import json
payload = {
    'objective': 'invoice_review', 'coreMaterialIndex': 0,
    'materials': [
        {'name': '发票.png', 'type': 'invoice', 'image': base64.b64encode(open('发票.png','rb').read()).decode()},
        {'name': '合同.pdf', 'file': base64.b64encode(open('合同.pdf','rb').read()).decode()},
    ],
    'confirmations': [{'materialIndex': 1, 'reason': '同一笔付款', 'sameInvoice': True}],
}
response = http.request('POST', host + '/v1/document/review', body=json.dumps(payload).encode('utf-8'),
                        headers={**headers, 'Content-Type': 'application/json; charset=UTF-8'})
print(response.data.decode('utf-8'))   # data.conclusion / data.issues / data.materials …

# 异步提交 + 轮询
response = http.request('POST', host + '/v1/image/general/detection',
                        body=urllib.parse.urlencode({'image': image_b64, 'asyncSubmit': 'true'}).encode('utf-8'),
                        headers=headers)
task_no = json.loads(response.data.decode('utf-8'))['taskNo']
response = http.request('POST', host + '/v1/image/general/detection/result',
                        body=urllib.parse.urlencode({'taskNo': task_no}).encode('utf-8'), headers=headers)
```

### curl

```sh
curl -s -X POST http://127.0.0.1:8090/v1/image/general/detection \
  -H 'Authorization: APPCODE dev-apicode' \
  --data-urlencode "image=$(base64 -w0 doubao.png)" \
  --data-urlencode 'restrictProbability=0.5' | python3 -m json.tool

curl -s -X POST http://127.0.0.1:8090/v1/document/fields \
  -H 'Authorization: APPCODE dev-apicode' \
  -H 'Content-Type: application/json' \
  -d '{"image":"'$(base64 -w0 发票.png)'","materialType":"invoice"}'
```

## 测试

```sh
python3 -m pytest tests/ -q          # 18 项：映射（真实保存结果）+ 接口（fixture 模式）
# 服务级自测：另起 fixture 服务后按上文 curl / Python 示例调用
```

依赖：`fastapi uvicorn httpx pillow numpy scipy`（见 requirements.txt；服务器 anaconda 环境已内置）。
