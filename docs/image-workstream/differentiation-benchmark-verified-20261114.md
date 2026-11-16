# 2.1 / 2.3 功能级差异化与对标清单（核查版）

更新：2026-11-14。用途：教师汇报、竞品实测与论文阅读；不要求复现任何新算法。

范围：吕佳文负责的2.1通用图片与2.3证件票据。视频、音频、售后业务不在本次结论内。代码核对基线为当前协作工作树的 `e524f93`，既有未提交修改保留。

本文是对已有 `differentiation-benchmark-plan.md` 草稿的证据核查与补充。草稿中的“跨材料审核是市场空白”“Hive没有来源归因”“无人组合凭证与模型”等表述不成立，不应进入汇报。历史实验原件保持不变；本文优先采用后续更正记录。

## 1. 先明确能讲什么

**建议主线：以审核目标为中心，将图像风险、文件内容和材料之间的矛盾放在同一工作台，减少用户寻找证据和切换工具的操作。** 这是一条可验证的产品差异化路线；不能直接改写为已全面优于竞品。

| 候选“抗打点” | 当前证据 | 与谁正面比较 | 汇报定位 |
|---|---|---|---|
| 新生成器上的整图识别 | 已有8子集TPR；另有OpenFake及GenImage/Chameleon记录 | Hive、Sightengine、Reality Defender；PGC/PROBE/SAFE | 最优先补齐同输入产业API比较，具有成为性能主线的基础 |
| 中文多种材料围绕核心文件核对 | CrossCred 21类、286张、77个有图分组均运行；同编号/主体/角色/交易字段有来源 | 合思、AppZen、Rossum | 已有工程覆盖；需要独立样本验证正确性，不能将覆盖率写成准确率 |
| 智能核验处理复杂金额关系 | 8份英文合成票据：Agent 8/8，直接语义6/8；20.6秒对4.2秒 | 三家财务审核平台；同输入不同商业模型API | 小样本支持流程有效，也揭示时延成本；不是跨模型胜利 |
| 一处看到矛盾、双方原文、图像位置 | 生产前端已分单份/跨材料、聚合同类问题、提供原图与报告 | 合思、Rossum、TextIn工作台 | 用完成任务时间、点击数和误读率证明体验；“有热图”本身不独有 |
| 资源忙时排队、批量导入、结果区直接切图 | 已有批量/ZIP、队列、结果浏览与报告代码和历史验收 | Hive、Reality Defender、Sightengine批量接口及工作台 | 比端到端等待、完成率和恢复行为；不只比服务端毫秒数 |
| 来源归因、文档视觉定位 | 有运行记录，也有明显失效和对照缺口 | 来源：Hive/Sightengine；文档：TextIn/百度 | 目前作为待改进能力，不作为已证实的准确性优势 |

## 2. 已有结果：按真实任务拆开

### 2.1 云市场API历史结果

来源：[2026-11-10原始报告及后续更正](market-benchmark-20261110.md)。本次重新读取17份调用账本，共152次HTTP尝试，核对152份原始回执文件及17份账本的SHA256。152次包括参数错误、额度错误、重复调试和不同阈值，不是152个独立测试样本。

| 接口/任务 | 已取得的结果 | 可用结论和缺口 |
|---|---|---|
| 阿里读光发票OCR | 两张中文票据各7个指定字段一致，共14/14 | 只能证明这14个字段；不是全票面准确率。不能用完税证明被该发票端点拒绝，推断阿里整个平台不支持证明材料 |
| 阿里文档比对 | 两张票据返回27处文字差异；两张完税证明返回15处差异 | 是文本差异输出，未评差异精确率；不等于识别27/15条业务矛盾 |
| 中科逸视发票查验 | 同一真实数电票，原样通过；改金额、改日期均不一致 | 3个请求验证了数据库查验行为。返回购销税号，彼时我方未抽到，是我方缺口；合成票格式被拒绝不能算对方漏检 |
| 身份证OCR | 输入不是合规身份证，返回类别错误 | 尚无有效身份证对比成绩，不纳入排名 |
| 怜花篡改接口 | FCTM 4图默认阈值均未检出；降低判定阈值后，实际复测的2图检出 | 只能分别报告4图默认与2图调参，不能写4图均因调参检出；本轮未获得可用定位 |
| jmtpcgsb篡改通道 | 默认阈值下5张FCTM、5张换脸共0/10检出；2次返回小框 | 10张全为正例，没有同批真实误报数据。与怜花通道疑似同源，不当作两个独立厂商 |
| sdtpcg篡改通道 | CocoGlide 5图0/5检出；同图TruFor阈值0.5为2/5 | 文档型端点测自然图像是跨域探测；选图按我方分数分层，不是随机代表样本 |
| aips/psdect | 换脸8/10、局部重绘7/10；真实人脸7/10误报；文档篡改0/20；CocoGlide 1/20 | 100次含30张真实对照和10张压缩重测。不能只展示人脸80%召回而省略70%误报 |
| 快证签早期调用 | 参数/额度问题 | 未得到可评分推理结果；HTTP200也可能只是业务错误，不给“0%准确率” |

**独立供应商口径**：阿里云市场是渠道，不是所有上架算法的研发方；相同商品码、相近响应和近似分数只能说明疑似共用服务，不能证明模型完全相同。`lh/jm` 不作为补足“三家独立产品”的证据；`sd/kzpt` 也需确认提供方。

**本轮发现的历史汇总解析问题**：不要直接读取旧 `market-results.json` 的评分布尔值做新排行榜。

- 发票OCR旧评分中的 `name.external` 为空，但返回的 `buyer_name` 实际存在。使用当前适配器重解析004/005原始回执、核对上传字节哈希后，两个样本确为7/7一致，共14/14；是旧字段映射漏项，不是OCR漏识别。
- 发票查验旧汇总把 `0000` 记录成 `verified:false`，把 `CY0017` 记成 `verified:true`。原始回执及当前适配器确认：`0000`通过，`CY0017`是不一致。已经在新目录另存 `reparsed-results.json`，未修改历史原件；对应的通过/不一致均属于已完成业务判断。
- 文档比对旧评分把期望字符串 `>0` 与具体数值直接比较，不能拿该“是否相等”字段判断成功。应单独判断差异数是否大于0；这也仅是接口冒烟检查，不是业务异常准确率。

从历史账本重新计算的时延如下，均为HTTP墙钟时间，不包含我方OCR、GPU排队或后处理，不能与完整审核链路直接做倍数比较。

| 历史组 | HTTP尝试数 | HTTP200数 | 全部尝试平均秒 | 全部尝试中位秒 |
|---|---:|---:|---:|---:|
| invoice-ocr | 6 | 4 | 1.403 | 1.373 |
| doc-compare | 6 | 4 | 2.975 | 3.281 |
| invoice-verify-r2 | 3 | 3 | 0.931 | 0.750 |
| tamper-detect-jm | 10 | 10 | 0.884 | 0.882 |
| psdect-doc | 20 | 20 | 2.151 | 0.952 |

这些均含调试历史，不能充当独立生产性能压测。完整17组CSV和JSON保存在平台根的 `runtime/replay/differentiation-audit-20261114/`。

### 2.2 我方结果及当前不能忽略的变化

| 能力 | 历史实测 | 对标时的正确用法 |
|---|---|---|
| 整图分类 | OpenFake 178图，旧阈值0.5：AUC98.75%、准确率93.26% | 固定子集，非全量；当前阈值已变，不能沿用旧混淆矩阵表示当前默认 |
| 高召回整图操作点 | GenImage+Chameleon 900图，0.5→0.25：召回98.4%→100%，误报3.1%→5.1% | 历史分数离线复算；要与竞品在相同误报水平比较，而不是只比召回 |
| 通用局部篡改 | CocoGlide 80图，TruFor 0.3→0.2：召回60%→82.5%，误报15%→42.5% | 0.2目前偏高召回；不能宣称82.5%是总体准确率或同时低误报 |
| 文档视觉定位 | FCTM10图/构造copy-move10图，旧阈值图级均检出；像素IoU约0.071/0.084 | 图级检出高、定位弱是两件事。原“10张干净文档全误报”已更正：8张有脱敏涂改，余2张是渲染票，不足以定总体误报 |
| 人脸伪造 | 同批5换脸+5真人：8图可评分，换脸4/4检出、真人1/4误报，2图未检出脸 | 同时写可评分召回4/4与总提交检出4/5，不能把未检出脸从总体成功率分母移除 |
| 生成来源归因 | OpenFake闭集87图Top1 96.55%；同图JPEG Q95降至12.64% | 需专门测压缩和未知来源；闭集成绩不代表用户上传场景 |
| 生成来源跨流程 | DDA-COCO官方FLUX 4971图：当前OpenFake27权重仅20图归到FLUX家族；DRAGON25为17图 | 家族召回分别0.402%、0.342%，目前不能主打此场景的准确归因 |
| 中文内容覆盖 | CrossCred 286张/21类/77有图组；1412个字段，75组有可见差异 | 开发集覆盖，不是75/77准确率；缺图与作者标注争议独立记录 |
| 智能内容核验 | 英文公开合成8票：Agent8/8，直接语义6/8；规则8份均未完成金额判断 | 相同模型的流程对比；4异常+4正常，不能当成与商业平台或论文模型的排名 |
| 解释界面性能 | 4图完整诊断，加载后每图2.74–5.13秒；最多36个窗口 | 这段时间含遮挡/分块等当时分析步骤，不含排队和冷启动；不是只跑主分类的速度 |

来源：[人像与归因（含4971图追加）](face-source-integration-20261105.md)、[全图特征分布](full-image-features-20261103.md)、[CrossCred覆盖](crosscred-full-evaluation-20261027.md)、[英文票据](invoice-benchmark-20261106.md)、[阈值记录](market-benchmark-20261110.md)。

现有Qwen-Image-Bench八行成绩来自用户提供的实测表，本轮未重新推理：八行智鉴TPR为100、95.8、94.2、93.9、93.8、91.6、90.4、78.2%。GPT-Image 1.5一行SAFE为97.7%，高于智鉴93.8%；Hunyuan一行与PROBE并列100%。可以展示“8行中7行达到或并列最高TPR”，但缺每行样本数、阈值及真实照片误报对照时，不能写“7项总体性能领先”或计算合并准确率。

### 2.3 本次重复调用：已完成3次

2026-11-14用户提供配置文件路径，并明确授权“E01、E02两张历史票据图片，最多3次请求”外传至既有阿里云市场OCR/文档比对接口。此前缺少配置的预检及自动审批拦截均未发出请求；取得明确例外授权后，实际调用3次，全部HTTP200且业务结果可解析。无自动重试、无充值、无新增大模型调用；实际费用需按供应商账户账单核对，不能以HTTP成功推算。

| 本次请求 | 业务结果 | HTTP墙钟耗时 | 与历史比较 |
|---|---|---:|---|
| E01 发票OCR | 7个指定字段全部匹配 | 1.727秒 | 指定字段一致 |
| E02 发票OCR | 7个指定字段全部匹配 | 1.274秒 | 指定字段一致 |
| E01 vs E02 文档比对 | 返回26条文字差异 | 2.887秒 | 历史27条，其中两条删除/新增本次合并为一条修改 |

OCR合计14/14指定字段匹配、平均1.501秒。每张当前适配器输出10个键值项，其中购买方名称存在`buyer_name`/`name`别名，不能把10项都视为独立字段或全部已评分。这里的14项不代表全票面OCR准确率。

**文档差异为什么27变26**：对照历史003及005回执，输入图片SHA256完全一致；25条差异原样保留，历史“删除1”加“新增2”两条，本次变为一条“1→2”的修改。数量变化来自输出分组，没有证据表明该位置漏检。尚未评价全图每一处业务矛盾的正确性，文字差异条数不能当异常检出成绩。

本次原始回执、账本及逐条差异复核保存于平台根 `runtime/replay/differentiation-audit-20261114/recheck-2026-11-14T11-04-28-123Z/`；`difference-audit.json`记录多重集合比较，`status.json`记录三次调用预算及字段检查。

复测入口为同审计目录的`recheck.mjs`，凭据仅由Node环境注入，不打印内容；支持产品专属`ALIYUN_APPCODE_INVOICE_OCR`、`ALIYUN_APPCODE_DOC_COMPARE`及统一`MARKET_APPCODE`、`ALIYUN_MARKET_APPCODE`。本轮授权预算3次已经用完，不再次运行`--live`，避免把脚本单次上限误当用户无限重复授权。该脚本与生产流程分开；未修改生产适配器。

## 3. 2.1：逐小功能怎么对比

表中“优势方向”是要用测试证明的命题，不是已经取得竞品胜率。推荐对象共享试用账户，避免每行另买三家。

| 子功能 | 用户具体任务/更细体验 | 对标对象 | 测什么、用什么数据 | 优势方向与当前缺口 |
|---|---|---|---|---|
| G01 整图AI识别 | 上传后立即看到是否疑似AI，无需选生成器 | [Hive][V1]、[Sightengine][V2]、[Reality Defender][V3] | Qwen八子集+内容匹配真人照片；固定阈值TPR/FPR、AUC、失败率 | 争取新生成器泛化；现有云市场PS接口不能充当这三家AI分类器 |
| G02 压缩/截图/缩放鲁棒性 | 微信转存、截图后仍能检查 | 同G01三家 | 同一图原件/JPEG Q95/Q75/长边缩小/截图；逐来源成对统计退化 | 比“转存后少漏检”，不能只拿无损原图优点 |
| G03 AI特征分布 | 原图、分布图一键切换，能看边角 | Reality Defender图像热图、[Forensically][V13]交互；读论文X组4篇 | 全图窗口覆盖、裁切/缩放稳定性、找重点耗时；不能用全AI图的全白mask考核解释图 | 我方是重叠窗口分类分布；颜色不是像素级生成真值 |
| G04 判定原因的遮挡响应 | 具体区域与此次分类响应关联 | 论文X组4篇；Reality Defender对照产品呈现 | 删除/插入曲线、不同遮挡填充值稳定性、推理次数/秒 | 后台保留双遮挡；不能以“红得更多”当解释更好 |
| G05 局部篡改与位置 | 局部问题能直接在图上找到 | 论文L组4篇；[百度][V5]、[TextIn][V4]、已有市场通道作产品对照 | CocoGlide/CASIA类自然图及文档分开；像素F1/IoU、图级TPR/FPR、每图误框数 | 文档型供应商的自然图成绩标跨域；我方已使用TruFor，不把TruFor再算独立新算法 |
| G06 人脸修改 | 多脸图中指出涉及哪张脸 | Hive、Sightengine Deepfake、Reality Defender | DeepFakeFace已下载120图；脸检出覆盖率、图级及脸级召回、真实误报 | 无脸结果独立统计；专用人脸分支的优势需对专用竞品，而非只对通用PS接口 |
| G07 生成模型家族归因 | 提供可能来源供进一步追查 | Hive、Sightengine为优先API；[Sensity][V14]归因能力需确认当前套餐；补读IncreFA | OpenFake/DRAGON受支持家族、未知家族、JPEG、DDA-COCO分别计Top1/Top3及拒识 | 闭集高分与域外失败并存，现阶段不作为主卖点 |
| G08 来源元数据与C2PA | 看到谁声明生成/编辑、凭证是否有效 | [Adobe Verify][V10]、Hive、[Truepic][V11] | 原件/删除元数据/伪造普通XMP/修改签名后像素/未知签发者；状态一致性及误判 | Adobe适合验证已有凭证，Truepic偏可信采集；我方仅已有文件离线验证，尚非完整在线信任生态 |
| G09 压缩差异、残差、清晰度 | 统一原图位置、图层开关和图例，不让用户猜一堆数字 | Forensically主交互对标；论文X组用于解释质量方法 | JPEG/PNG、不同压缩质量、细纹理/纯色等控制图；诊断耗时、用户误读率 | 辅助诊断属于常用工具；不要包装成自研高精度分类器；克隆定位尚未独立接入 |
| G10 批量、ZIP、排队、切图 | 一次导入，结果区直接看下一张，忙时继续等 | Hive、Sightengine、Reality Defender的接口/工作台 | 1/10/100张、不同分辨率，任务完成率、首个结果/最后结果时间、排队时间、重连后结果保留 | 当前100张/1000MB上限是工程能力，不直接等于高吞吐；对方SDK可批量不等于网页可ZIP |
| G11 PDF/Word报告与API交付 | 一次导出可读报告，与当前图像结果一致 | Hive、Reality Defender、TextIn工作台/API具体导出能力逐项实测 | 完成一次报告的点击数、证据图缺失率、导出时间；API schema稳定性、错误/恢复行为 | 对方公开资料未说明Word导出时写“待测”，不写整个产品没有报告 |

**当前实现位置**：`src/modules/image/general/analyze.py` 为主分类/遮挡/辅助诊断；`spatial.py` 为最长边1024、336窗口、步长最多168、最多36窗口的分布；`tamper.py` 与 `forensics.py` 为篡改/人脸/来源辅助；`file_source.py` 解析来源声明；`service.js` 为队列；`pages/general.js` 为页面。`analyze.py` 使用c2patool离线验证且未配置自定义信任锚，不能说已经完成所有签发者信任与在线撤销核验。

## 4. 2.3：逐小功能怎么对比

| 子功能 | 用户具体任务/更细体验 | 优先对标三家/学术组 | 数据与评价 | 能形成的差异/目前缺口 |
|---|---|---|---|---|
| D01 图片/PDF/Word统一输入 | 混合上传，多页仍是同一材料 | [TextIn解析][V8]、[阿里读光][V9]、Rossum；论文O组 | 同文档电子PDF/扫描PDF/DOCX；页数保留、阅读顺序、表格完整率、解析秒/页 | 一批文件直接进入审核是产品链路；TextIn已支持多格式，不能说只有我方支持 |
| D02 OCR正文与区域 | 错误结论能回到某页某段原文 | TextIn、阿里读光、百度OCR；论文O组 | 中文正文字符错误率CER、数字完全匹配、文字框位置；区分OCR错误与后续提取漏字段 | 相比仅展示结论，更关注定位和可纠错；识别分数不当真实性置信度 |
| D03 票种/材料分类、字段角色 | 正确区分购买方/销售方、甲方/乙方、本人/代理人 | TextIn、阿里读光、Rossum；论文O组 | CrossCred作回归；另留独立模板；类别宏F1、字段值+角色+来源页联合准确率 | 当前21类开发覆盖可演示，跨省/高校文档存在不等于对应制度可执行 |
| D04 明细表、金额、税额 | 直接说明哪两项不一致、差几元 | Rossum公式、合思、AppZen；论文N组 | 合成8票作回归；新增折扣/运费/含税/红字/多税率正常及错误配对；异常精确率/召回 | 不追求所有税制硬编码；简单算术本地、语义关系智能核验；现有英文规则曾未完成8/8 |
| D05 号码/日期/身份字段 | 指出号码位数、校验位或日期矛盾，不要求读变量名 | TextIn结构化+配置、阿里结构化+配置、合思审核 | 正常/非法日期、号码一位差、不同票种；按检查项通过/异常/无法完成统计 | 单个OCR接口不提供的判断可用“端点未输出”描述，不能推广为其公司无规则平台 |
| D06 文件视觉生成与篡改 | 单独看到AI来源与疑似改动位置 | TextIn、百度篡改、现有阿里市场通道；论文D组4篇 | FCTM+真正干净扫描票+仅脱敏票+新AI编辑票；分类与mask指标分开 | 先补干净扫描对照；低IoU尚不能成为定位性能优势 |
| D07 单份智能内容核查 | 发现正文与表格、条款与金额不一致，并说明依据 | 合思、AppZen、Rossum工作流；论文N组 | 相同8票及新模板；具体原因命中、无依据告警、漏报、失败、输入输出token | SDK不是模型；同模型Agent与直接调用作为内部消融，另列不同平台的真实结果 |
| D08 同编号不同内容/重复报销 | 相同发票/证明/合同编号出现两套内容，一块展示对应值 | 合思、AppZen、Rossum重复检测/匹配 | CrossCred同号不同名/税号/项目/金额；正常副本、合法新版本、乱序作负例 | 同号不必然造假；正面比较是否指出具体冲突，不比返回了多少条告警 |
| D09 身份/证明组合核对 | 核心证明与身份、经营主体、委托人对应 | 合思定制材料审核、TextIn DocFlow配置、AppZen企业工作流（需确认适配） | 同角色一致/矛盾、多人同名、代理人场景；关系匹配P/R、错误关联率 | 这三家在该具体组合上的支持需试用确认；不预填“不支持”作为胜项 |
| D10 合同—发票—支付—验收 | 围绕一项交易看金额、主体、内容、时间闭环 | 合思、AppZen、[Rossum PO匹配][V7] | 一对多付款、部分交付、分期、退款、跨币种；案例级和矛盾项级F1 | 核心索引减少无关比较；n−1星状边不保证端到端严格O(n)，LLM上下文成本要实测 |
| D11 报销/科研场景与制度适用 | 输入审核目的，核对材料和适用制度 | 合思、AppZen、Rossum可配置规则/工作流 | 同一材料换地区/机构/生效日期；制度引用正确率、错用率、规则配置分钟数 | 当前规则目录与地域调研有区别；尚无证据已完整覆盖31省及所有高校制度 |
| D12 内容矛盾证据展示 | 有问题置前，同类折叠，单份与跨文件分开，点一次看双方原文 | 合思、AppZen、Rossum工作台 | 盲测“找出差额”“说出双方不同值”“找出核心材料”；点击数、用时、误读率 | 最值得产品化的细粒度体验；对照平台也可能有证据面板，要实际做同任务 |
| D13 隐私与调用成本 | 用户选择脱敏/原文核验，结果完整且可解释 | 上述三家按实际部署套餐比较 | 脱敏前后关系核验准确率、字段泄露数、API次数、token、每正确审核成本 | 本地OCR/规则与云端LLM分开计；不能因为可本地处理就说全链路离线 |
| D14 报告、失败恢复、API | 批次报告可交付，失败不丢其他材料结果 | 合思、AppZen、Rossum | 同批成功/失败、超时、重启；成功材料保留率、重复计费、报告漏项 | 自有 `services/market-api` 是我们自己的封装，不是第四家竞品；MCP规划不当已上线能力 |
| D15 发票权威库查验 | 判断是否与税务记录相符 | 已测中科逸视、阿里VerifyVATInvoice、[TextIn发票验真][V12] | 授权真实票及可控金额/日期差异；成功率、字段回填、耗时、费用 | 当前是实验接通记录，未证明正式审核链路已默认调用；属于补足能力，不与无库内容检查争同一冠军 |

材料覆盖细分包括发票、完税/无欠税证明、身份材料、银行/支付材料、缴费账单、合同、租赁、承诺函、经营证明等。完整21类以[冻结覆盖清单](crosscred-full-coverage-20261027.md)为准，不从前台选项数量推导实际能力。

**执行代码入口**：`documents/server/ocr-fields.js`、`vat-layout.js`、`catalog-content-fields.js` 负责结构/角色；`document-rules.js`、`content-rules.js`、`content-rule-catalog.json` 负责具体本地规则；`batch-engine.js` 等负责批次编排。`material-catalog.json` 的候选材料和政策研究，不等于都已经执行的规则。提示词、Agent以及展示应沿实际生产分支评价，不能把手写示例文字算模型结果。

## 5. 三组产业平台：实际先开通哪些

### 5.1 图片侧：Hive / Sightengine / Reality Defender

| 产品 | 已由公开资料确认 | 对应我方功能 | 未确认或不对应的部分 | 访问方式与优先级 |
|---|---|---|---|---|
| [Hive][V1] | AI图片、人脸深伪、生成来源；模型演示还展示内容凭证 | G01/G06/G07/G08/G10 | 这套图像API未公开描述中文财务金额及跨票业务核查；不等于Hive公司永远没有 | 官方Playground/API，第一优先；适合一次覆盖多功能 |
| [Sightengine][V2] | AI整图、人脸Deepfake；支持生成器分数；可组合模型请求 | G01/G02/G06/G07/G10 | 官方说明genai只分析像素、不用元数据；这只适用于该检测模型 | 可网页少量试图，批测使用API；第一优先 |
| [Reality Defender][V3] | 图片/视频/音频分析、API和浏览器产品；SDK存在批量及图像热图能力 | G01/G03/G06/G10/G11 | 热图返回受模型/状态限制；未见该接口直接给中文票据事实核查 | 官方平台/API；第一优先。读产品文档不等于已获得账户 |

优先购买或申请这三家的小额额度，不建议再买三条疑似同源的云市场PS通道来充数。Hive网页当前标价为图片每1000次6美元，但结算、附加能力和套餐以实际账户为准；本轮没有下单。[价格来源][V1]

### 5.2 中文文档视觉侧：TextIn / 百度 / 已有市场篡改产品

TextIn官方说明支持证照、发票、小票、合同等篡改检测并定位；百度官方产品也说明支持卡证、票据和文档篡改及热图。二者比自然图片平台更贴近2.3，必须优先实测。[TextIn产品][V4]、[百度产品][V5]

第三方先复用已买通道并核实供应商身份。如果需要“三家真正独立研发平台”，应另确认阿里官方相应鉴伪产品的适用票种、输出位置及开通条件，不能把“阿里市场”四字当作阿里自研证明。

### 5.3 事实审核侧：合思 / AppZen / Rossum

| 产品 | 官方确认的业务能力 | 对应我方 | 我方应检验的差异，不能先写成胜出 |
|---|---|---|---|
| [合思AI审核][V6] | 单据/发票/流水交叉验证、制度与自然语言规则、三单核对、分级结果 | D04/D07–D14 | 非标准证明与普通文件夹直接上传是否更便捷；一组材料配置时间和每次审核耗时 |
| [AppZen][V15] | 费用审核、收据/报销/卡交易/发票重复检查、政策合规，明确包含中国发票相关能力 | D04/D07/D08/D10–D14 | 中文非财务证明组合、具体字段引用、脱敏后效果；不能说它不支持中文或跨材料 |
| [Rossum][V7] | 单据提取、公式校验、重复检测、订单及明细匹配、主数据关联 | D01/D03/D04/D08/D10/D12/D14 | 不接ERP、只上传辅助材料时的任务完成程度；非标文本矛盾解释与配置成本 |

这些平台可通过官方演示/试用或企业账户做同样例任务；当前项目未发现三家的已配置业务API。因此本轮仅确认功能与对标方案，没有伪造调用成绩，也没有代用户联系销售。

**准确说“对方缺什么”**：指定具体端点或套餐，例如“阿里文档比对返回文本差异，现有回执没有金额逻辑结论”；“Sightengine genai文档明确不使用元数据”。对于整个平台未知的能力，只写待确认。我们的缺口同样列明：权威验真未证明进生产、完整政策覆盖不足、归因域外失效、文档定位及干净对照待补。

## 6. 学术阅读清单：按小模块选择，不复现

每组4篇作为模块阅读组合。模型论文、评测论文和解释方法分别标明，不把数据集论文当作已经可调用的商业算法。论文公开数字单列“作者报告”；只有相同输入、预处理、指标及操作点才与我方实测同表排名。若老师严格要求主会4篇，N组的FinBalance为Findings，可用表后已列出的EMNLP主会论文替换；FinBalance仍是值得优先读的业务专题。

### A组：整图检测，先读已有对照的3篇，再补一篇

| 论文/会议 | 对应小功能 | 重点读什么；效率怎么取 |
|---|---|---|
| [PGC，ICML 2026](https://proceedings.mlr.press/v306/zhou26h.html) | G01/G03，局部线索辅助全局判别 | 全局/局部校准消融、跨生成器表；记录骨干大小、分辨率、额外分支耗时；论文指标不能代替现有八行本地数据 |
| [PROBE，ICML 2026，作者仓库](https://github.com/Amamiya-C/PROBE-AIGI-Detection) | G01/G02，难例与泛化 | 生成空间探测、难例与压缩/模糊实验；区分训练时构造难例费用与部署推理成本 |
| [SAFE，KDD 2025](https://github.com/Ouxiang-Li/SAFE) | G01/G02，轻量部署 | 裁剪预处理、变换和局部感知消融；读参数量/单次前向，优先比较轻量检测与大骨干的成本 |
| [AIDE：A Sanity Check for AI-generated Image Detection，ICLR 2025](https://proceedings.iclr.cc/paper_files/paper/2025/hash/b0303773962ea1b5394c3a83cc7dd066-Abstract-Conference.html) | G01/G02，困难图像 | Chameleon难例、真实图片误报与多线索收益；看需要多少裁块/编码器，不只摘最高准确率 |

若讲方法发展，再读[UniversalFakeDetect，CVPR 2023](https://doi.org/10.1109/cvpr52729.2023.02345)、[DIRE，ICCV 2023](https://openaccess.thecvf.com/content/ICCV2023/html/Wang_DIRE_for_Diffusion-Generated_Image_Detection_ICCV_2023_paper.html)、[FakeInversion，CVPR 2024](https://openaccess.thecvf.com/content/CVPR2024/papers/Cazenavette_FakeInversion_Learning_to_Detect_Images_from_Unseen_Text-to-Image_Models_by_CVPR_2024_paper.pdf)。重点比较轻量判别与扩散反演的部署步骤，不能未经同机测试声称快几倍。DIRE不是CVPR2023，AIDE不是CVPR2024。

### L组：通用局部篡改定位

| 论文/会议 | 与我方的关系 | 阅读和比较点 |
|---|---|---|
| [TruFor，CVPR 2023，作者项目](https://grip-unina.github.io/TruFor/) | 我方已集成，作为来源与参考，不算独立新竞争算法 | 自然图拼接/重绘、图级与像素级双指标、可靠性图、预处理与推理规模 |
| [MVSS-Net，ICCV 2021，作者仓库](https://github.com/dong03/MVSS-Net) | 外部经典对照 | 同时关注检测特异度和定位；不要拿只在篡改正例上的F1解释真实误报 |
| [SAFIRE，AAAI 2025，作者仓库](https://github.com/mjkwon2021/SAFIRE) | 外部区域分割对照 | 多来源区域、分割策略、泛化、推理额外步骤；读原表不复跑 |
| [ADCD-Net，ICCV 2025，作者仓库](https://github.com/KAHIMWONG/ADCD-Net) | 文档子域对照，与D组共用 | 文档压缩下的定位表现，RGB/DCT双路成本；自然图与文档结果分开 |

### D组：证件票据视觉篡改（2.3最值得专项阅读）

| 论文/会议 | 对应问题 | 必读实验 |
|---|---|---|
| [DocTamper / Towards Robust Tampered Text Detection in Document Image，CVPR 2023](https://openaccess.thecvf.com/content/CVPR2023/papers/Qu_Towards_Robust_Tampered_Text_Detection_in_Document_Image_New_Dataset_CVPR_2023_paper.pdf) | 小文字块修改、文档频域特征 | FCD/SCD等跨域与压缩实验，定位F1/IoU；不是业务内容矛盾 |
| [ADCD-Net，ICCV 2025](https://github.com/KAHIMWONG/ADCD-Net) | 压缩后的文档篡改 | 多JPEG条件的定位变化、适应DCT与内容解耦消融 |
| [Detect Any AI-Counterfeited Text Image / DanceText、DS-Net，CVPR 2026](https://openaccess.thecvf.com/content/CVPR2026/html/Qu_Detect_Any_AI-Counterfeited_Text_Image_CVPR_2026_paper.html) | 生成、删除、局部编辑三类文字图风险 | 跨生成器/语言/软件，图级与实例定位分开；比老PS数据更接近新的AI编辑 |
| [TruFor，CVPR 2023](https://grip-unina.github.io/TruFor/) | 通用模型跨文档域参考 | 与前3篇比较任务域和输入；我方已有推理，读文章解释域差，不重复部署 |

补充测试集：[AIForge-Doc，2026预印本](https://arxiv.org/abs/2602.20569)，4061张AI编辑文档、9种语言、来自CORD/WildReceipt/SROIE/XFUND。适合读作者零样本结果及后续选图；本轮未核实顶会录用，不能称顶会论文。DocTamper作者明确数据限非商业使用，研究阅读与产品公开展示素材授权要分开。[作者许可说明](https://github.com/qcf-568/DocTamper)

### X组：热图解释质量（解释模块，不是四个AI鉴别器）

| 论文/会议 | 具体用途 | 读效率与质量的方法 |
|---|---|---|
| [RISE，ECCV 2018，作者论文](https://arxiv.org/abs/1806.07421) | 对照我方遮挡响应，解释黑盒分类 | mask采样数、前向次数；删除/插入评价，不仅看图漂亮 |
| [Extremal Perturbations，ICCV 2019](https://openaccess.thecvf.com/content_ICCV_2019/html/Fong_Understanding_Deep_Networks_via_Extremal_Perturbations_and_Smooth_Masks_ICCV_2019_paper.html) | 控制删除面积，排除全图乱遮挡带来的假解释 | 面积约束、平滑mask、优化迭代次数及响应变化 |
| [Grad-CAM，ICCV 2017](https://openaccess.thecvf.com/content_iccv_2017/html/Selvaraju_Grad-CAM_Visual_Explanations_ICCV_2017_paper.html) | 对照梯度型解释，理解与窗口分数不同 | 前向/反向步骤、输出粒度；不要未经适配把CNN方法直接当当前骨干已实现 |
| [Sanity Checks for Saliency Maps，NeurIPS 2018](https://proceedings.neurips.cc/paper/2018/hash/294a8ed24b1ad22ec2e7efea049b8737-Abstract.html) | 检查解释是否真的依赖模型 | 参数/标签随机化后图应变化；是评价方法，不是业务检测算法 |

这些是解释方法基础文献，选旧文献是因定义适用，不是拿老检测器充最新SOTA。当前生产默认图为窗口分数，不是这四篇任一方法的复现。

### F组：人脸修改

| 论文/会议 | 阅读重点 |
|---|---|
| [SBI，CVPR 2022](https://openaccess.thecvf.com/content/CVPR2022/html/Shiohara_Detecting_Deepfakes_With_Self-Blended_Images_CVPR_2022_paper.html) | 跨数据集、跨修改方式泛化；自混合是训练策略，不要将生成训练样本时间算在线检测时间 |
| [PCL：Learning Self-Consistency for Deepfake Detection，ICCV 2021](https://openaccess.thecvf.com/content/ICCV2021/html/Zhao_Learning_Self-Consistency_for_Deepfake_Detection_ICCV_2021_paper.html) | 图内来源一致性与多数据集结果 |
| [RECCE：End-to-End Reconstruction-Classification Learning，CVPR 2022补充材料](https://openaccess.thecvf.com/content/CVPR2022/supplemental/Cao_End-to-End_Reconstruction-Classification_Learning_CVPR_2022_supplemental.pdf) | 重建和分类配合，跨测试集表现与双阶段成本 |
| [DeepfakeBench，NeurIPS 2023 Datasets and Benchmarks](https://papers.nips.cc/paper_files/paper/2023/hash/0e735e4b4f07de483cbe250130992726-Abstract-Datasets_and_Benchmarks.html) | 统一预处理/数据划分/评价表；是benchmark论文，直接读统一比较，不运行15套模型 |

### O组：解析、布局和字段提取

| 论文/会议 | 对应我方的问题 | 读什么 |
|---|---|---|
| [LayoutLMv3，ACM MM 2022](https://doi.org/10.1145/3503161.3548112) | 字段值、版面、角色关联 | FUNSD/CORD/XFUND的KIE指标；中文支持与表格位置；OCR前置成本 |
| [Donut，ECCV 2022](https://www.ecva.net/papers/eccv_2022/papers_ECCV/html/8042_ECCV_2022_paper.php) | OCR误差传递，直接图像转结构 | OCR-free与OCR流水线时延/精度；不同语言不能无条件互换成绩 |
| [DocLLM，ACL 2024](https://aclanthology.org/2024.acl-long.463/) | OCR文本+坐标，而非整图上传 | 版面感知消融、无图像编码器的收益，结构任务表现；不等于事实验真 |
| [LayoutLLM，CVPR 2024](https://arxiv.org/abs/2404.05225) | 问题、版面区域与回答关联 | LayoutCoT与区域/段落任务，关注解释能否落到正确位置、推理生成长度；[作者确认与材料](https://github.com/AlibabaResearch/AdvancedLiterateMachinery/tree/main/DocumentUnderstanding/LayoutLLM) |

补充读[DocOwl 1.5，EMNLP 2024 Findings](https://aclanthology.org/2024.findings-emnlp.175/)的高分辨率输入和视觉token压缩。产业比较优先采用TextIn/阿里/百度直接调用即可，无需重训以上模型。

### N组：单份推理与多文件核对

| 论文/会议 | 对应功能 | 必读部分，避免拿错指标 |
|---|---|---|
| [FinQA，EMNLP 2021](https://aclanthology.org/2021.emnlp-main.300/) | 金额、多步数值运算 | 程序执行准确率与证据检索；QA答案正确不等于整票异常检测准确 |
| [TAT-QA，ACL 2021](https://aclanthology.org/2021.acl-long.254/) | 表格与正文联合理解 | 取数、符号、单位、计算分类；同一个数字是否绑定正确行列 |
| [DocMath-Eval，ACL 2024](https://aclanthology.org/2024.acl-long.852/) | 长文档、复杂数值与模型成本 | CoT/PoT对照、长度/难度分层、48模型评价；公开成绩仅作阅读参考 |
| [FinBalance，EMNLP 2026 Findings](https://aclanthology.org/2026.findings-emnlp.675/) | 多材料入账、引用与23类不一致 | 文档绑定、矛盾标签、重算账本和自报总表差距；46%是最终资产负债表完全正确率，不是矛盾检出率 |

严格要求主会时，第四篇可用[Program of Thoughts for Financial Reasoning，EMNLP 2025主会](https://aclanthology.org/2025.emnlp-main.1577/)，阅读动态例子与程序推理；仍保留FinBalance作为最贴近多文件业务的专题阅读。已有CrossCred是开发回归；新增FinBalance可用于无复现的直接API方案，但先检查数据许可、输入长度及标注适配，不把作者答案带进提示词。

来源归因额外优先读[IncreFA，CVPR 2026](https://openaccess.thecvf.com/content/CVPR2026/papers/Qin_IncreFA_Breaking_the_Static_Wall_of_Generative_Model_Attribution_CVPR_2026_paper.pdf)，关注未知生成器、时间顺序增量评测，正好对应我方闭集外高置信错归因问题。C2PA则读[官方信任与验证规范][V16]，不拿主动水印论文冒充现有任意文件凭证验证效果。

## 7. 无需复现的实际测试顺序

### 第一步：恢复现有API的小样本重复性

已完成3次OCR/文档比对复测，14/14指定字段一致，文字差异27→26的分组合并已解释；本轮3次预算已用完。旧额度已耗尽的PS通道不自动续费。验真只测用户授权真实票，不拿随机票号或合成票骗取查验成绩。下一步应取得新的对标平台试用配置，而不是重复消耗当前样本。

### 第二步：图片三家同输入小规模预选

建议先冻住40张：8个生成器各4张=32张，8张真实照片；每家相同40张，不挑自己高分样本。此轮只排查接入与明显失败，8张真实样本不足以量化低误报能力。再按结果和预算扩到至少每生成器50张及足量真实对照；若要稳定讨论1%误报，应使用更大的真实样本集并给置信区间。

单独建10对原图/压缩图测鲁棒性，不能把20张当独立20场景。分类、面部修改、来源归因分别评分；分类器错误不会通过“有凭证”自动算对。当前模型与竞品各自默认操作点、统一FPR操作点分两张表。

### 第三步：文档视觉对照，先解决真值问题

冻结四组各10张：未经修改的扫描票、只做隐私遮挡的票、传统文字修改票、AI编辑票。有修改组保留原件和掩码。遮挡组按“发生了像素改动”和“业务造假”两种标签分别解释，不强迫视觉算法忽略真实涂改。TextIn/百度/已购通道各同输入测试；分类与定位各表。没有像素mask的自然业务材料只评案例判断和定位人工核对，不能编造IoU。

### 第四步：事实核验三平台，不要求复现算法

每家首先做同一套12个材料包，6个有明确矛盾、6个正常：同票号不同内容、合同发票金额冲突、分期支付尚未付清但条款允许、含税/折扣/运费、同证明编号不同主体、身份与代理人角色。每种异常配正常近似样例，避免平台见到“不同”就得分。CrossCred已调规则的材料只用于产品演示，不作为独立领先证据。

平台侧用官方试用/演示跑同任务，记录是否要ERP数据、字段映射和规则配置。不能取得平台API时，先进行产品能力/体验比较，性能格留待测；可并行用已授权商业LLM API做同输入、同工具预算的模型比较，但明确是模型基线，不冒充合思/AppZen/Rossum实测。

### 第五步：体验与成本，能直接用于汇报

请至少5位未参与开发的用户，随机顺序使用各平台完成同样任务：找出最严重问题、指出双方不同值、打开原文位置、切换下一材料、导出报告。计开始到正确回答的时间、点击数、误读数、完成率；不要把页面控件多作为体验更好。

效率统一保留：准备/配置时间、上传时间、排队时间、推理时间、首个可用结果、最后结果、报告导出。LLM另记输入/输出token、请求数与工具次数。已有8票Agent平均4.125次HTTP/票、直接流程1次/票；墙钟约4.9倍，质量差异要与成本同报。GPU服务记录卡型、显存、热启动/冷启动、并发和完整功能开关，论文未报告的时延填“未报告”。

建议公共字段：`sample_id, sha256, dataset_revision, split, task, label_source, provider, endpoint, model_version, thresholds, preprocess, completed, verdict, evidence_correct, image_tp, image_fp, region_iou, latency_upload, latency_queue, latency_infer, latency_total, calls, tokens_in, tokens_out, billed_cost, error_kind`。答案及带答案含义的文件名不进入模型输入。

质量计分：检出率=TP/(TP+FN)；误报率=FP/(FP+TN)；材料矛盾按“字段/关系+冲突双方+原因”匹配真值后计P/R/F1；失败与信息不足单列，同时进入端到端完成率。不同图像的多个像素、同一材料的多条字段不冒充独立样本。少量样本只报计数与区间，不形成夸大的百分比总榜。

## 8. 汇报页面建议

每个主模块一页，不做“功能都有所以全面领先”的大而全表：

1. 用户任务：例如“一次提交一组报销材料，找出核心发票与附件的具体矛盾”。
2. 三个最小可检验功能：角色/交易关联、冲突原文联动、按问题聚合。
3. 三个对标产品及实际结果，未知格保持待测。
4. 一组正常与一组异常的同输入截图，展示用户能否正确定位问题。
5. 质量+时间+成本三列，并列我方已知弱项和下一步。

推荐主打G01/G02整图性能、D07–D12材料审核与证据体验、G10/D14批量交付效率。C2PA/残差/热图是辅助功能，归因和文档视觉定位暂放技术改进页。这样既有细粒度功能，也有可供教师追问和实测支撑的比较。

## 9. 官方资料索引

以下访问核对日期均为2026-11-14。产品网页是厂商功能说明，不是独立准确率证据；本文没有使用厂商宣传百分比充当我方测试。

[V1]: https://thehive.ai/models/hive/ai-generated-and-deepfake-content-detection
[V2]: https://sightengine.com/faq/detect-ai-generated-images-videos
[V3]: https://github.com/Reality-Defender/realitydefender-sdk-python
[V4]: https://www.textin.com/doc/intro/%E6%99%BA%E8%83%BD%E5%9B%BE%E5%83%8F%E5%A4%84%E7%90%86
[V5]: https://cloud.baidu.com/product/ocr/forgery_detection
[V6]: https://hosecloud.com/aifinancialapproval.html
[V7]: https://knowledge-base.rossum.ai/docs/po-matching-with-line-items-extension
[V8]: https://www.textin.com/document/x_to_markdown
[V9]: https://help.aliyun.com/zh/ocr/developer-reference/api-ocr-api-2021-07-07-overview
[V10]: https://verify.contentauthenticity.org/
[V11]: https://www.truepic.com/
[V12]: https://www.textin.com/market/chager/verify_vat
[V13]: https://29a.ch/photo-forensics/
[V14]: https://sensity.ai/blog/how-to-detect-a-deepfake/
[V15]: https://www.appzen.com/ai-for-expense-audit
[V16]: https://spec.c2pa.org/specifications/specifications/2.3/guidance/Guidance.html

补充：[Reality Defender官方Go SDK热图返回契约](https://pkg.go.dev/github.com/Reality-Defender/realitydefender-sdk-go/realitydefender)、[Sightengine人脸检测边界](https://sightengine.com/docs/deepfake-detection)、[Rossum主数据匹配](https://knowledge-base.rossum.ai/docs/master-data-hub)、[Rossum公式配置](https://knowledge-base.rossum.ai/docs/configuration-examples-2)、[Rossum重复检测](https://knowledge-base.rossum.ai/help/docs/duplicate-detection-in-rossum)、[合思交叉审核](https://hosecloud.com/hoseai.html)。
