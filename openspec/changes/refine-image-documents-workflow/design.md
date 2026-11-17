# Design

## Context

范围见[proposal](proposal.md)。本变更只涉及 2.1/2.3 与对外 API；不动视频、音频与售后场景。历史实验记录不回改。

## 决策 1：模型链路定论（澄清，不改执行逻辑）

| 场景 | 能力 | 实际模型（代码事实） | 说明 |
| --- | --- | --- | --- |
| 2.1 | 整图 AI 检测 | **DDA-H+**（`weights/dda_hplus`，analyze.py） | |
| 2.1 | 局部篡改 | **TruFor**（通用图像域，热力图+连通域框） | 用户口中的"tursor"即 TruFor；2.1 **不用** SEED |
| 2.1 | 人像伪造 / 来源归因 | VLAForge / RPA-OpenFake27 | |
| 2.3 | 整图 AI 检测 | **DDA-H+**（stage 键名 `mirror` 为 MIRROR 时期历史名；local-runtime.js:74 实际以 mirror-runtime 解释器执行 dda_hplus 推理） | 前端展示名已是"整图 AI 检测"，不再改 stage 键名（历史结果兼容） |
| 2.3 | 局部篡改 | **SEED**（DINOv3+LoRA+EoMT，票据文档域） | |
| 2.3 | OCR / 规则 / 智能核验 | PP-OCRv6-medium / 本地规则矩阵 / DeepSeek（脱敏优先） | |
| 对照 | DocShield-9B | **仅离线评测**（smoke/对比脚本），不在服务链路 | 60 张同输入对照：SEED 召回 100%/误报 43% vs DocShield 召回 43%/误报 7%；9B 推理重、输出可截断、坐标空间未校准 |

- **SEED vs DocShield 的取舍**：主链 SEED（漏检代价高的审核场景取高召回），不用"双模型互投"增加时延与不可解释冲突；需要更严格确认时用 SEED 多档阈值（现有 0.35 检出门限 + API `restrictProbability` 分层）而不是引入第二个大模型。DocShield 保留为评测对照与后续研究。
- 文档与页面统一按上表表述，消除 mirror/SEED/DocShield 混淆。

## 决策 2：地区/高校研究入口清理

- **删除**：前端 `规则适用地区`（jurisdiction 下拉）、`业务适用地区`（省份，documentRegions）、`业务发生日期`（businessDate）三个控件；`context.region/businessDate` 与 `review-policy-catalog.json` 的 policyReferences 注入从语义包移除；`regions.js` 省份表退役。
- **保留**：`jurisdiction` 字段与规则域逻辑（review-plan.js:107——非 CN 时禁用中国票面格式规则改 NEI）。前端固定默认 `CN`，附"非中国大陆材料"开关一次切换；直接删 jurisdiction 会破坏境外材料行为。
- **归档**：`review-policy-catalog.json`、`runtime/replay/university-985*` 等省份/高校研究数据移至 `runtime/research/policy-studies-archived/`，保留可审计性，不再被运行链路读取。

## 决策 3：双核验模式（mode）

- 请求新增 `mode`：`single`（单材料鉴伪）/ `batch`（多材料业务核验，默认，向后兼容）。
- **single**：每份材料独立流水线（整图+篡改+OCR+单份规则）；不建核心/辅助关系、不生成 edges/candidates、不执行跨材料规则、confirmations 拒收；presentation 只聚合单份问题；语义包 `relations=[]`，提示词补一句"单材料模式下不得推测跨材料关系"。
- **batch**：现有行为不变。
- 前端：进入页面先选模式；single 隐藏核心选择/关联确认/跨材料专栏；结果区逐份卡片。多份上传在 single 下合法（逐份独立处理）。
- 市场 API `/v1/document/review` 透传 `mode`；`/v1/document/fields` 即 single 的 runModels=false 子集。

## 决策 4：对外 API 对齐 TextIn 口径（对照 2026-11-15 拉取的官方文档）

TextIn 通用篡改检测：`category`(0 自动/1 证照/2 证书/3 票据/4 截图/5 扫描/6 印章)、`tamper_threshold`、octet-stream/URL 直传；响应 `is_tampered` 布尔、`tampered_positions` 四边形、**逐框 `tampered_scores`**、**可视化叠加图 base64**、`duration(ms)`、细错误码（QPS/白名单）。

我们采纳（不照抄四边形，保持矩形框 + 保留坐标体系声明）：
1. `tamperScore`：0–100 整数（SEED/TruFor 分数×100），`≥60` 判"存在篡改痕迹"（阈值随 scoreSemantics 未校准声明一起给）；有篡改痕迹必须越过该参考线。
2. `tamperedLocation[].probability`：2.3 SEED 逐框置信度补齐（SEED 推理输出 components 时计算连通域均值，落入 regions 元数据）。
3. `overlay`：可选返回叠加可视化图（`includeOverlay=true`），复用报告链路画框逻辑。
4. `duration`：信封增加接口耗时毫秒。
5. `materialType=auto`：材料类别自动判断（v1 用现有 classification 字段结果回填，前端也可不选）。
6. 错误码补 `429`（平台队列繁忙已有）与限流提示文案。
不做：四边形坐标（矩形通用性更好）、IP 白名单/QPS 错误码（暂无该网关能力）。

## 决策 5：图像属性鉴别（质量/来源）

- 输出（2.3 materials[].quality 与 2.1 image.quality）：`{blurry, handwritten, photocopy, screenRecapture, screenshot, scanned}` 各 0–1 概率 + 中文结论词；低质量（模糊/翻拍/复印）作为"先补拍原件"的直观提示前置展示。
- **v1（本期，规则基线，可解释）**：
  - 模糊：Laplacian 方差归一 + 文字块平均 OCR 置信度联合；
  - 复印件：色彩数锐减 + 噪点/网点纹理（FFT 高频带能量）+ 对比度压缩；
  - 屏幕翻拍：摩尔纹高频峰值 + 亮度分布双峰；
  - 截图：EXIF 全缺失 + 边缘纯色矩形边界 + 分辨率规整；
  - 手写：OCR 置信度方差大 + 笔画密度特征（弱特征，仅提示）；
  - 扫描件：均匀背景 + 无 EXIF + 直方图双峰强。
- **v2（下期）**：轻量多标签头（MobileNetV3/CLIP-ViT-B/32 image encoder）；屏幕翻拍优先复用开源权重（risa-recaptured-image-detection）；复印件参考 CardDetectRotate 类别训练；数据以合成增广（复印件=打印再拍、翻拍=显示器采集、模糊=退化核）+ CrossCred/RealText 真图负例。模型与权重入 `weights/document-quality/`，环境变量可关。
- 新 stage 键名 `quality`（2.3），2.1 在 diagnostics.quality；不阻塞主链，失败时 `not_run` 且不影响其他阶段（与现有阶段容错一致）。

## Risks / Trade-offs

- 删除地区入口会改变请求校验行为：`region/businessDate` 字段兼容收下但忽略，旧客户端不 400。
- mode=single 复用同一 review 引擎，若 plan 未彻底跳过跨材料会产生误导性 NEI：以测试覆盖（单材料零 edges/candidates）。
- v1 属性规则为启发式，只作提示不作结论；文案必须带"疑似"。
- tamperScore 阈值 60 为产品参考线，不冒充校准概率（沿用 uncalibrated 声明）。

## Migration Plan

1. 先落 openspec 与测试，再改前端/服务端；旧结果 JSON 无 quality/tamperScore 字段时 API 返回 `null` 并在文档标注"旧任务无此输出"。
2. 前端发版包含模式选择；API 增加 `mode` 默认 `batch`，市场 API README/guide 同步更新并各跑一轮真机回归。
3. 省份/高校数据移动后 `npm run check` 的链接与 OpenSpec 校验必须通过。


## 实施记录（2026-11-16）

- 服务端：`mode` 校验与 plan/edges/excluded 裁剪、`context` 兼容忽略、policyCatalog/policyReferences 注入移除、
  `quality` 阶段（rules_v1）接入页级与材料级、`material.stages.quality` 汇总；提示词两份追加单材料约束句。
- 阈值标定样本（quality v1，640px 灰度）：清晰实拍票据 lap 900–3300 / hf 0.001–0.07 / sat 3.6–18.2 → 全部零提示；
  人造模糊图 lap≈5 → blurry=1.0；软图（cord-1）blurry 0.75 单提示；invoice-a（白底规整）经 hf/sat 门控后 screenshot 降至 0.2。
- 前端：模式选择（默认 single）、非中国大陆开关、核心/关联按模式显隐、结果页 quality 提示 chips、篡改分徽标、
  single 隐藏“交叉内容核查”模块；移除 规则适用地区/省份/业务日期 三控件与 `regions.js`。
- 市场 API：`mode`、`tamperScore/tamperVerdict`、逐框 `probability`（mask_score_mean）、`quality`、
  `includeOverlay`（compose_overlay 合成）、信封 `duration`、`materialType=auto` 归一化。
- 真机回归（2026-11-16）：single（2 张零散发票，18.3s，edges=0/excluded=0/strategy=independent_single_material，
  issues=4 均为单份矛盾，type auto→invoice，quality 正常）；batch（81s，excluded=1，issues=15 保持原行为）；
  2.1（63s，tamperScore=16/no_obvious_tamper）。测试：node 538/538、market-api pytest 22/22、check/build/openspec --strict 通过。
- 归档：`review-policy-catalog.json`、university-985×2、mcj-review → `runtime/research/policy-studies-archived/`。

## 图像属性 v1.2：OCR 空间融合与模糊深化（2026-11-17）

- **主判据换成"行高归一化笔画宽度"** `ink_rel = 笔画行程 / 文字行高`。实测（真实发票渲染页 + 真实 OCR 框）：
  清晰 0.095、真实软拍 0.162、σ=1.5 0.238、最近邻 4× 放大 0.211、水平运动模糊 0.350、σ=3.0 0.474。
  该指标与文档类型/字号/对比度基本无关；此前的拉普拉斯方差与半高宽在真实样本上不可用
  （清晰发票与低对比扫描同为低值；半高宽对运动模糊恒返回 1–2px）。
- **方向化锐度**：对比度归一化后 ax/ay 比值。清晰与各向同性模糊 ≤1.7，水平运动模糊 5.2–5.6、垂直 2.5–2.6；
  规则要求各向异性 ≥2.2 **且**被抑制方向锐度 <0.02，避免把天然横线多的票据误判为抖动。
- **类型判定顺序**：拍摄抖动 → 放大/低分辨率（笔画宽且边缘仍锐利，lap≥250）→ 压缩 → 失焦 → 混合。
- **OCR 融合**：逐文字行取行高与笔画宽度；加权平均识别置信度与低置信行占比作为辅助证据。
  约束：无视觉证据时 OCR 低置信上限 0.6 且标注 `recognition_ambiguous_not_blur`；
  有 OCR 行但笔画不可测（过度模糊/极低对比）时走 `text_partial_evidence`（上限 0.75）并标注 `ink_not_measurable`。
- **手写属性在规则基线中明确不评估**（返回 null），避免此前 0.35 固定假分数造成误报；v2 由模型给出。
- **端到端实测**（平台真实链路，2.3 单材料模式）：清晰发票 0.018/clear/0 区域；
  高斯 σ2.6 → 0.971/severe/defocus/17 区域（OCR 置信度 0.99→0.61）；
  水平抖动 13px → 0.550/moderate/motion(horizontal)/3 区域（走 text_partial_evidence）。
