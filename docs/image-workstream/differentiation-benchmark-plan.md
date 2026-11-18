> 核查更新（2026-11-14）：本草稿含尚未验证或已被新证据纠正的竞品能力与论文信息。教师汇报请使用[功能级对标核查版](differentiation-benchmark-verified-20261114.md)，其中保留原始测试口径、后续更正、复测状态和官方来源。

# 2.1 / 2.3 差异化对标方案（产业 3 家 + 学术 4 篇 · 含实测方法）

> 2026-11-14 · 用途：回应教师要求——针对每个子功能 ①体验粒度是否更细 ②抗打点对比产业端/学术界（性能、效率）。
> 每个条目给出：推荐对标对象、对方不具备的能力、建议指标与测试方法（你可实测或读论文取数）。
> 服务器内可直接使用的数据集与已完成证据在附录 A/B。

## 0. 一页速览（教师汇报格式）

| 子功能 | 我们更细的粒度 | 产业对标（推荐 3 家） | 学术对标（推荐 4 篇） | 建议指标 |
| --- | --- | --- | --- | --- |
| 2.1 整图 AI 检测 | 声明优先判定链 + 覆盖范围/校准语义诚实标注 | Illuminarty、Hive Moderation、腾讯云文本图像鉴伪(AIGC) | UniversalFakeDetect(CVPR23)、DIRE(CVPR23)、AIDE(CVPR24)、**PGC/PROBE·ICML26、SAFE·KDD25** | TPR@FPR、跨生成器泛化、时延 |
| 2.1 局部篡改定位 | 热力图+框+叠加图三层输出，阈值用户可调 | 阿里云市场篡改API(有AppCode)、百度图片篡改检测、TextIn | TruFor(CVPR23)、MVSS-Net(ICCV21)、FOCAL(ICCV23)、IML-ViT(ACMMM24) | mIoU / F1、框 IoU、时延 |
| 2.1 人像伪造 | 逐脸框+分数+阈值，闭集语义声明 | Sensity、Reality Defender、腾讯云鉴伪 | FF++(ICCV19)、SBI(CVPR22)、RECCE(CVPR22)、DeepfakeBench(NeurIPS23D&B) | AUC、EER、跨库 |
| 2.1 来源归因 | 27 生成器闭集归因 Top-K+不确定性 | （无主流产品—Illuminarty 仅 GAN/Diffusion 二分类） | GAN Fingerprint(NeurIPS21)、Model Parsing(CVPR23)、WEST归因、OpenFake27 | Top-1/5 归因准确率 |
| 2.1 文件凭证/声明 | 三厂商声明+凭证+检测信号联动决策 | Adobe Content Credentials、Google SynthID Detector、腾讯云鉴伪(翻拍/复印件) | Stable Signature(ICCV23)、Tree-Ring(CVPR23)（水印方向背景） | 声明检出率、误报率 |
| 2.1 工程体验 | 100 张批量/ZIP/断点恢复/进度/筛选/标准报告 | Hive 批量 API、Illuminarty 网页 | — | 吞吐、断点恢复正确性 |
| 2.3 多材料解析 | PNG/JPG/PDF/DOCX 同批混装、逐页状态 | 百度票据OCR、腾讯OCR、TextIn(票据23大类) | PP-OCRv4(arXiv)、LayoutLM系列(ACMMM/KDD) | 字段准确率/召回、页覆盖率 |
| 2.3 票据域篡改定位 | SEED(票据域微调)+坐标+字段级关联 | 阿里云市场、百度、华为云图像篡改识别 | DocShield-9B(对照基线已跑)、TruFor域外对照、PSDect、FCTM | 域内 mIoU、假阳率 |
| 2.3 规则核验 | 价税算术/大小写/税率/票号/日期定点规则+NEI 语义 | （OCR 厂商不做一致性规则；税务查验平台只做官方真伪） | 跨材料规则矩阵 C01–C15/G01–G08（自研） | 规则命中率、误报 |
| 2.3 跨材料核验 | 核心材料驱动+人工确认+证据双侧对照 | （无对标产品） | DocQA 类不做事务一致性 → 差异化最强点 | 差异检出率 |
| 2.3 智能核验 | B 级路由只送机器不能判项+脱敏+证据ID约束 | TextIn 验真(规则查验)、腾讯场景鉴伪大模型版 | LLM-as-judge 系列 | 复核准确率、外发信息量 |
| 2.3 报告/API | 标准公文 docx/pdf + 市场风格 API + MCP(计划) | 产业 API 仅返回 JSON，无报告产物 | — | 交付完整性 |

---

## 1. 2.1 通用图片检测 · 子功能对标

### 1.1 整图 AI 来源检测

- **我们的粒度**：结论分三值（`suspected_ai_generated / no_obvious_ai_evidence / ai_generated_declared`），判定依据显式（`decisionBasis=file_declaration|model`），分数强制携带 `semantics:"uncalibrated"` 与**覆盖范围声明**（如"中心336×336，边缘未参与"）；文件声明优先于模型信号（见豆包 original.jpg 实测 35s，`ai_generated_declared`）。
- **产业对标（3 家）**：
  1. **Illuminarty**（illuminarty.ai）：网页给出 AI 概率 + 区域热力图，但无声明/凭证检查、无覆盖范围与校准声明、判定依据单一。
  2. **Hive Moderation**（AI-Generated Content Detection API）：工业级单分数+类别，无逐层解释、无报告。
  3. **腾讯云文本图像鉴伪（AIGC 合成）**：有 AIGC 合成风险标签，但不区分"模型信号"与"文件声明"两条证据链，无来源归因。
- **学术对标（4 篇）**：UniversalFakeDetect（Ojha et al., CVPR 2023）、DIRE（CVPR 2023）、AIDE（CVPR 2024，统一 AI 生成+篡改）、以及**平台页面已内置的 PGC · ICML 2026 / PROBE · ICML 2026 / SAFE · KDD 2025**——八子集 TPR 对比表已实测完成（见附录 B），直接引用即可。
- **测试方法**：固定我们已冻结的数据集子集，报 TPR@FPR=1%；对方平台用同一批图逐张提交（网页/API），记录混淆矩阵与平均时延；论文数据直接抄 Table（注意训练分布差异要标注）。

### 1.2 局部篡改定位（TruFor 链）

- **我们的粒度**：三层输出（原始置信度热力图 + `restrictProbability` 用户可调的连通域像素框 + 叠加可视化图）；坐标体系显式（`exif_oriented_full_image`）；"信号可疑"与"框"解耦——整体不可疑时仍可按阈值给参考框（见 §4 示例）。
- **产业对标（3 家）**：
  1. **阿里云市场·图片篡改检测**（lhtpcg/jmtpcgsb 两个供应商，**你已有 AppCode 可直接实测**）：返回 heatmap + tamperedLocation 框，但只有"fake/real + 置信度"，无可调阈值语义、无叠加图、无"未校准"声明。
  2. **百度智能云·图片篡改检测**（OCR 产品线）：坐标+热力图，面向卡证/票据，单文件、无整图 AI 检测联动。
  3. **合合信息 TextIn·通用篡改检测**：主打卡证（身份证/驾驶证/银行卡）PS 检测；不具备通用图片 AI 来源检测、来源归因、批量 ZIP。
- **学术对标（4 篇）**：TruFor（CVPR 2023，我们集成）、MVSS-Net（ICCV 2021）、FOCAL（ICCV 2023）、IML-ViT（ACM MM 2024）；评测集用 CASIA v2 / NIST16 / IMD2020 / CocoGlide（**服务器已有 CocoGlide 子集与 PSDect、forensics-20261105**）。
- **测试方法**：像素级 mIoU/F1（学术口径）；框级 IoU@0.5 对比产业 API（同图同框标注）；时延（产业 API 我们可直接打 AppCode 计时，见附录 C 脚本）。

### 1.3 人像伪造分析（VLAForge）

- **我们的粒度**：逐脸框 + 每脸分数 + 阈值 + "仅覆盖人脸区域"范围声明；无脸时显式"未检出可分析人脸"而非空结论。
- **产业对标**：Sensity AI、Reality Defender（两者以整图/视频 deepfake 为主，不逐脸给框和分数）；腾讯云鉴伪（有人脸相关风险标签，无逐脸分析）。
- **学术对标（4 篇）**：FaceForensics++（ICCV 2019）、SBI（CVPR 2022）、RECCE（CVPR 2022）、DeepfakeBench（NeurIPS 2023 D&B，统一评测口径）。
- **指标**：AUC/EER、跨库泛化（FF++→DFDC）、每脸推理时延。

### 1.4 生成来源归因（RPA OpenFake27）

- **我们的粒度**：27 个已知生成器闭集归因，Top-K 候选 + `closedSet:true` + "未知来源不能确定归属"的显式局限声明。
- **产业对标**：Illuminarty 只给 GAN/Diffusion 大类；Hive/腾讯不提供归因——**归因是产业空白，差异化最明显**。
- **学术对标（4 篇）**：GAN Fingerprint（NeurIPS 2021）、Model Parsing（Asnani et al., CVPR 2023）、Reverse Engineering of Generative Models（CVPR 2022/西工大相关）、OpenFake27 基线（我们已集成）。
- **指标**：Top-1/Top-5 归因准确率、闭集外样本的拒绝率（我们明确不拒判而是标注局限，这个取舍可以在汇报里主动讲）。

### 1.5 文件凭证与来源声明（C2PA/XMP/三厂商）

- **我们的粒度**：C2PA 凭证状态 + XMP AIGC 声明解析（豆包/千问/OpenAI 三厂商检查）+ 与检测信号的**联动决策**（声明优先且声明者身份未验证要注明）。
- **产业对标**：Adobe Content Credentials Verify（只验 C2PA 链）、Google SynthID Detector（只认 Google 水印）、腾讯云鉴伪（翻拍/复印件标签）——**没人把"声明+凭证+模型信号"三路融合成一个判定链**。
- **学术背景（2 篇即可）**：Stable Signature（ICCV 2023）、Tree-Ring（CVPR 2023）——主动水印方向，作为我们"被动声明检测"的对照叙事。
- **测试方法**：用带声明/不带声明的同内容图片对（豆包 original.jpg vs original.png 已是现成对照），声明检出率与决策链正确率 100% 可复演。

### 1.6 批量与工程体验

- **粒度**：单批 100 张 / ZIP 解包 / 20MB 单图 / 队列位置显示 / 断点恢复（AIGC_GENERAL_RESUME_FILE）/ 结果筛选 / 一键标准报告。
- **产业对标**：Hive 批量 API（按张计费、无断点恢复语义）、阿里云市场 API（单图单次调用）。**建议汇报点**：断点恢复后历史结果与材料版本不串号（我们实测过恢复清单）。

### 1.7 标准报告

- **粒度**：规范公文格式 docx/pdf（微软雅黑标题阶梯/宋体正文/图表编号/版本附录），产业 API 只回 JSON；这是"交付物完整性"的直接差异，拿 `report-standard-20261112-examples/` 两份报告当展示品。

---

## 2. 2.3 证件票据核验 · 子功能对标

### 2.1 多材料解析

- **粒度**：同一批次混装 PNG/JPG/PDF/DOCX，逐页渲染与状态（损坏/加密/超限逐页报告），页码与坐标变换保留。
- **产业对标**：百度/腾讯/TextIn 票据 OCR——单文件、跨格式混批与逐页状态不具备。
- **学术对标**：PP-OCRv4（arXiv 2024）、LayoutLMv3（ACM MM 2022）、DocParser 类；指标用字段准确率/召回 + 页覆盖率。

### 2.2 票据域篡改定位（SEED 主链 + MIRROR 整图）

- **粒度**：整图来源（MIRROR）与局部篡改（SEED，DINOv3+LoRA+EoMT）分开结论、分开坐标；篡改框与字段来源框分别存储不混淆。
- **产业对标**：阿里云市场/百度/华为云图像篡改识别——通用域模型，票据域未特化；TextIn 面向卡证不面向发票金额/日期区域。
- **学术对标（4 篇）**：DocShield-9B（**平台已跑同清单对照**）、TruFor（CVPR23，域外基线）、PSDect 论文（数据集已在 `datasets/documents/psdect-easy-20261110`）、FCTM 样本集对照。
- **指标**：域内 mIoU、每假阳框数（票据上文字密集，假阳率是产业痛点）。

### 2.3 规则核验引擎

- **粒度**：价税算术（十进制定点+容差声明）、大写金额、显示税率、票号位数/年份、日历日期、身份证校验位——每条规则有版本、NEI 语义（证据不足≠通过）、证据可回溯到字段与页。
- **产业对标**：OCR 三家只做识别不做**内容一致性判断**；全国增值税发票查验平台做官方真伪（需四要素+官方库），与我们的票面矛盾检测正交——汇报时主动讲清这条边界，把"不冒充官方查验"变成可信度。
- **测试方法**：invoice-benchmark-20261106 冻结集跑规则命中率与误报；构造边界用例（0%税率免税行、差额计税）验证例外处理。

### 2.4 跨材料核验

- **粒度**：核心材料驱动、候选关系需依据或人工确认（`confirmations`）、重复去重、双侧证据并排；这是**产业端无对标、学术端少覆盖**的差异点——汇报主打。
- **测试方法**：CrossCred 78 组冻结数据（服务器已有全量 OCR）跑差异检出/误报，按 C01–C15/G01–G08 矩阵逐条归因。

### 2.5 智能核验（DeepSeek 语义复核）

- **粒度**：只送本地规则判不了的 B 级待审项；redacted 模式代号脱敏（实测 m1/m2/e5 替换姓名税号）；单次预算不自动重试；输出必须引用证据 ID（防编造）；本地 FAIL 不被模型推翻。
- **产业对标**：TextIn"验真"是规则/官方查验；腾讯"场景鉴伪大模型版"面向门头照/车牌，不做跨材料审计推理。
- **学术对标**：LLM-as-judge（Zheng et al., NeurIPS 2023 D&B）等，说明我们的差异是**证据约束与脱敏协议**而非裸调用。
- **指标**：复核结论与人工标注一致率（我们已有两轮真机样本可当 case study）、外发信息泄漏检查（脱敏校验已内建）。

### 2.6 目标驱动五种核验目的 / 报告与 API

- 五种 objective（发票/采购履约/收付款/报销/身份）切换规则包与材料建议——产业 OCR 无业务目标概念。
- 报告（标准公文）+ 市场 API（信封/坐标/热力图）+ MCP（P1）——交付链完整度，见 `market-api-guide.md`。

---

## 3. 建议的对比实验总表（你来执行）

| # | 实验 | 对象 | 数据 | 产出指标 |
| --- | --- | --- | --- | --- |
| E1 | 篡改定位三方对比 | 阿里云市场API（有AppCode）vs 百度 vs 我们 | psdect-easy + forensics-20261105 各 20 张 | 框 IoU@0.5、热力图可用性、时延 |
| E2 | AIGC 检测对比 | Illuminarty/Hive vs 我们 DDA | GenImage 子集或 8 子集同批 | TPR@FPR、声明联动差异 |
| E3 | 学术定位指标 | 读 4 篇 IML 论文 Table | CASIA/NIST16/IMD2020/CocoGlide | mIoU/F1 对表 |
| E4 | 人脸跨库 | 读 FF++/SBI/RECCE + DeepfakeBench | 平台人脸样本 | AUC/EER 引用+自测 |
| E5 | 票据域篡改 | DocShield-9B vs SEED（已跑） | CrossCred/PSDect | 域内 mIoU、假阳/图 |
| E6 | 跨材料差异检出 | 无产业对标→讲空白 | CrossCred 78 组 | 检出率/误报、规则覆盖 |
| E7 | 智能核验 case | DeepSeek 两轮真机（已存） | invoice-a/b | 结论正确性、脱敏合规 |
| E8 | 时延/吞吐 | 全链路 | 2.1 单图 35–79s、2.3 核验 55–61s（已有） | P50/P95 |

## 附录 A：服务器内现成数据集

`datasets/documents/`：invoice-benchmark-20261106（冻结）、CrossCred（78 组）、psdect-easy-20261110（含 masks）、FCTM-samples、CORD-v2、RealText-V1；`datasets/forensics-20261105`；`runtime/reviews/` 全部真机存档（含两轮智能核验 8b96e165/6001b1e7）。

## 附录 B：已有可直接引用的对比证据

1. 八子集 TPR vs **PGC·ICML2026 / PROBE·ICML2026 / SAFE·KDD2025**（前端 Benchmark 页 + `image-capability-benchmark` 测试）。
2. DocShield-9B 同清单对照（design.md 记录）。
3. 两轮 DeepSeek 智能核验真机记录 + 21 项 API 测试 + 5 次真机延迟记录（market-api-and-mcp-tasks.md §六）。

## 附录 C：产业 API 实测要点（阿里云市场，AppCode 你已有）

- 端点：`https://lhtpcg.market.alicloudapi.com/image/forgery/detection`（另一供应商 jmtpcgsb 同路径）、`https://sdtpcg.market.alicloudapi.com/api/forgery/detection/ocr`。
- 请求：form-urlencoded，`base64`（≤1M 建议压缩）+ `restrictProbability` + `imgType` + `detectThreshold`，头 `Authorization: APPCODE <code>`。
- 记录：HTTP 时延、`detectionResult`、`tamperedLocation` 框与我们的框算 IoU、热力图尺寸；**每档阈值各测一遍**，正好对照我们"阈值可调+未校准声明"的差异点。
- 注意：样图建议用脱敏票据或公开数据集图（psdect-easy 是公开集），不要外发内部材料。

## 参考链接（产业端）

- 腾讯云文本图像鉴伪：https://cloud.tencent.com/document/product/866/131193 （场景鉴伪大模型版）；卡证鉴伪见 866 产品文档
- TextIn 通用篡改检测：https://www.textin.com/market/detail/manipulation_detection ；票据 OCR：https://www.textin.com/market/list
- 百度智能云图片篡改检测：https://cloud.baidu.com/doc/OCR/s/kmfdnccok
- Illuminarty：https://illuminarty.ai ；Hive Moderation：https://hivemoderation.com
