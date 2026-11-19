# 2.1 / 2.3 对外 API 与 MCP 任务分解（2026-11-11）

参照阿里云市场图像类检测产品的调用形态（简洁 POST、base64/URL 入参、`{code,msg,taskNo,data}` 信封、
篡改区域像素坐标 `tamperedLocation`、热力图 `heatmap`），为平台 2.1（通用 AI 生成图片检测）与
2.3（证件与票据材料核验）设计对外 API 与 MCP。**不直接复刻示例字段**，以本平台真实能力为准：

- 请求必须覆盖功能：2.1 的整图检测、局部篡改、人像伪造、生成来源、文件标识/凭证；2.3 的多材料提交、
  核验目的、核心材料、关联确认、模型开关、隐私模式、脱敏智能复核。
- 回复必须明晰并正确：字段语义化命名、坐标为原图像素、分数附校准语义、失败/未执行显式给出、
  非真机数据必须标注 `dataSource`。

## 一、架构

```
调用方 ──APPCODE──▶ services/market-api（Python FastAPI，本目录）
                      │  统一信封 {code,msg,success,taskNo,data}、参数校验、错误码
                      │  mappers.py：平台结果 → 市场schema（纯函数）
                      │  boxes.py：篡改热力图 → tamperedLocation 连通域像素框
                      ├─ upstream 模式：转发平台 Node 服务（/api/v1/image/general|documents）真实引擎
                      └─ fixture 模式：回放 runtime/reviews 保存结果（离线开发/测试，data.dataSource="fixture"）
```

生产走 upstream（真实引擎与队列）；测试与演示可走 fixture（同一套映射代码，仅数据源不同）。

## 二、API 设计（P0，本轮实现）

### 2.1 通用图片检测

| 接口 | 方法 | 说明 |
| --- | --- | --- |
| `/v1/image/general/detection` | POST | 提交检测；默认同步等待，`asyncSubmit=true` 立即返回 taskNo |
| `/v1/image/general/detection/result` | POST/GET | 按 taskNo 查询（同步超时或异步提交后轮询） |

请求参数（form-urlencoded 或 JSON 均可）：

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `image` / `imageUrl` | 二选一 | 图片 base64（≤20MB，不带 data: 前缀）/ 可下载 URL |
| `restrictProbability` | 否 | 区域框置信度过滤阈值 0~1，默认 0.5（对应平台篡改阈值口径） |
| `maxLocations` | 否 | tamperedLocation 最多返回框数，默认 8 |
| `features` | 否 | 返回内容裁剪：`base,tamper,face,source,provenance` 逗号分隔，默认全部 |
| `asyncSubmit` | 否 | `true` 立即返回 taskNo；默认同步（最长 `syncTimeoutSeconds`，默认 180s） |
| `syncTimeoutSeconds` | 否 | 同步等待上限 5~300s |

返回 `data`（关键字段）：

```
detectionResult        suspected_ai_generated | no_obvious_ai_evidence | ai_generated_declared
aiScore                {score 0-100, semantics:"uncalibrated", coverage}
tamper                 {detectionResult: suspicious|no_obvious_signal|inconclusive,
                       score, threshold, heatmap(base64 png), heatmapUrl?(未配置存储则缺省),
                       meanConfidence,
                       tamperedLocation:[{top,left,width,height,probability}]}   // 原图像素坐标
faces                  [{index, detectionResult, score, box:{top,left,width,height}}]
sourceCandidates       [{source, score}]（closedSet=true，闭集参考）
provenance             {c2pa, aiDeclarations, providerChecks:[{provider,status,declarations}]}
image                  {format,width,height,sha256}
timing/engine          耗时与模型/版本（含权重指纹截断）
```

### 2.3 证件票据材料核验

| 接口 | 方法 | 说明 |
| --- | --- | --- |
| `/v1/document/review` | POST | 提交整批核验（JSON 结构化或 form 单材料快捷模式） |
| `/v1/document/review/result` | POST/GET | 按 taskNo 查询 |
| `/v1/document/fields` | POST | 单份材料轻量提取（OCR 字段 + 原文 + 页图状态），复用核验链路 `runModels=false` |

请求（JSON 完整形态）：

```
{ "objective": "invoice_review",          // invoice_review|procurement_review|merchant_reconciliation|
                                           // research_reimbursement|identity_consistency
  "jurisdiction": "CN", "region": "unspecified", "businessDate": "2026-01-30",
  "coreMaterialIndex": 0,
  "materials": [ { "name": "发票.png", "type": "invoice",
                   "image": "<base64>" | "imageUrl": "https://…" |
                   "file": "<pdf/docx base64>" } ],
  "confirmations": [ {"materialIndex":1, "reason":"同一笔付款", "sameInvoice":true, "sameAmountScope":true} ],
  "options": { "runModels": true, "semanticReview": false, "privacyMode": "redacted" },
  "includePreview": false,                 // 是否返回材料页图 base64
  "asyncSubmit": false }
```

form 快捷模式：`image`/`imageUrl` + `materialType` + `objective`（+ 其余可选标量）等价于单材料提交。

返回 `data`（关键字段）：

```
objective, conclusion {result: issues_found|no_issues_found|needs_more_information,
                       issueCount, checkStats:{fail,pass,nei,notApplicable,error}, summary}
issues[]               {title, message, materials:[名称], evidence:[{field,value,page,observedText}]}
materials[]            {index,name,type,role,status,
                        pages:[{page,status,tamperedLocation:[像素框]}],
                        fields:[{key,value,confidence,page,observedText}],
                        checks:[{title,status,explanation}],       // status: pass|fail|nei|not_applicable|error
                        stages:{mirror,seed,ocr,rules,explanation}}
crossChecks[]          {title,status,materials,explanation}
limitations[]          适用范围与免责声明
```

### 通用约定

- 鉴权：`Authorization: APPCODE <code>`；合法值由环境变量 `AIGC_MARKET_API_APPCODES`（逗号分隔）配置。
- 信封：`{"code":200,"msg":"成功","success":true,"taskNo":"…","data":{…}}`；业务错误 HTTP 200 + `code`：
  400 参数错误 / 401 APPCODE 无效 / 404 任务不存在 / 413 超限 / 429 平台队列繁忙 / 500 引擎失败（附 `detail`）。
- `data.dataSource`：`engine`（真实检测）或 `fixture`（离线回放，仅供联调，不可对外当作检测结果）。
- taskNo：`时间戳(yyyyMMddHHmmssSSS) + 6位随机`，与平台 jobId/reviewId 一并返回便于对账。

## 三、MCP 设计（P1，下一轮实现）

`services/market-api/mcp_server.py`（stdio + streamable HTTP 双传输），工具与本节 API 同源映射：

| Tool | 入参要点 | 出参要点 |
| --- | --- | --- |
| `image_general_detect` | imageBase64/imageUrl，features，restrictProbability | 结论 + 分数 + 篡改框 + 人脸 + 来源候选（结构化 JSON，文本化摘要置前） |
| `image_general_task_result` | taskNo | 同上 |
| `document_review` | objective + materials[]（路径或 base64/URL）+ coreIndex | 结论统计 + 问题清单（含证据原文）+ 各材料字段/检查 |
| `document_review_task_result` | taskNo | 同上 |
| `document_extract_fields` | 单材料 | 字段 + 原文 + 页状态 |

约定：工具描述写明分数未校准、闭集来源、不等于官方查验；fixture 模式在工具输出同标注 dataSource。

## 四、任务清单

- [x] P0-1 市场信封/鉴权/错误码骨架（`app.py`）
- [x] P0-2 2.1 提交/结果接口：base64/URL、同步等待与异步、features 裁剪、restrictProbability/maxLocations
- [x] P0-3 篡改热力图 → 像素连通域框（`boxes.py`，scipy label）
- [x] P0-4 2.3 核验/字段提取接口：JSON 完整形态 + form 快捷模式、confirmations、options
- [x] P0-5 平台结果 → 市场 schema 映射（`mappers.py`，覆盖 2.1 五项能力与 2.3 全链结果）
- [x] P0-6 upstream 客户端（提交/轮询/URL 下载）与 fixture 回放模式
- [x] P0-7 自测：映射单测（真实保存结果多份）+ TestClient 接口测试（成功/异步/参数错误/鉴权/超限）+ 启动服务实测 + upstream 真机联测（GPU 环境可用时）
- [x] P0-8 README：字段表、错误码、阿里云风格调用示例（python urllib / curl）
- [ ] P1-1 MCP server（stdio + HTTP，5 工具）
- [ ] P1-2 MCP 工具级测试（调用示例与断言）
- [ ] P2-1 对外文档页与 OpenAPI 快照导出；限额与计费对接预留（X-AIGC-Quota 头）

## 五、验收口径

1. 请求覆盖：2.1 五项能力、2.3 全部可配置项均有对应请求参数且默认行为与平台一致。
2. 回复正确：映射单测对多份真实保存结果断言关键字段；坐标换算与 `coordinates` 声明一致；未执行/失败显式。
3. 明晰：字段命名与错误码文档一致；分数带 semantics；fixture 必须可辨别。
4. 自测全部通过（pytest + 服务级 curl/urllib 实测，见 `tests/` 与 README）。

## 六、本轮自测记录（2026-11-11）

- 单测：`python3 -m pytest services/market-api/tests/ -q` → **18/18 通过**（映射 6 项用真实保存结果断言，
  含 AI声明/篡改可疑/未见线索三类 2.1 样本与双材料 15 项问题 2.3 样本；接口 12 项覆盖鉴权、参数错误、
  404、features 裁剪、异步轮询、URL 下载、JSON/form 双形态）。
- fixture 服务级实测：uvicorn 起服后按 README 示例调用六个端点全部返回预期信封；错误路径 401/400/404 正确。
- upstream 真机联测（GPU 环境实测，`dataSource=engine`）：
  - 2.1 `doubao/original.png` 同步 79.1s：DDA+TruFor+VLAForge+RPA 真实完成，`suspected_ai_generated`
    （64.09/100）、篡改热力图 + 3 框、1 张人脸、来源候选 midjourney-7 等 3 项、引擎与权重指纹截断返回。
  - 2.3 `document/fields`（invoice-a.jpg）同步 30.4s：真实 OCR 14 字段（发票代码/号码/日期/价税合计/大写金额…，
    置信度 0.98–0.9999）。
  - 2.3 `/v1/document/review`（invoice-a + invoice-b，runModels=true）同步 54.7s：MIRROR/SEED/OCR/规则
    全阶段 completed，`issues_found` 17 项（FAIL 7），证据含 OCR 原文，SEED 定位框 9+11 个，跨材料 14 组。
- 智能核验（智能复核，2026-11-12 补充，真机 DeepSeek direct 各两次实测）：
  - 请求侧：`options.semanticReview=true` + `privacyMode` 已透传平台（本轮补齐回复侧 `data.aiReview` 映射，
    findings 的证据指针解析为字段/文本块实值，并给出 disclaimer；未执行显式 `status=not_run`+`reason`）。
  - 真机测试 1（redacted 脱敏，60.8s，review 8b96e165）：3 项 findings 全部 `issues_found`，正确检出
    两发票金额口径矛盾、13% 税率与税额不符、同票号但购买方/数量/单价不一致；脱敏代号（m1/m2/e5…）合规。
  - 真机测试 2（original 原文，60.8s，review 6001b1e7）：同样 3 项 `issues_found`，证据解析出实值
    （价税合计 1999.99/30000.00、大写金额、发票代码/号码）；两模式 explanation 阶段均 completed。
  - 回归：`services/market-api/tests/test_mappers.py` 增两条真机样本断言（两种隐私模式），全套 pytest 通过。
