# 阿里云云市场证件票据核验类 API 调研（2026-11-09）

面向 2.3 对比 benchmark 选型。数据来源：云市场商品详情接口（getDetailInfo / queryProductPricingPlan）实测抓取 + 官方帮助文档，价格为 2026-11-09 在售数据。

## 接入机制

五步：注册阿里云账号并个人实名 → 云市场商品页下单（买最小测试包或免费试用）→ 买家中心查 AppCode（约 30 秒生效）→ 调用加 `Authorization:APPCODE xxx` 头（`*.market.alicloudapi.com` 域名）→ 商品页在线调试。官方 OpenAPI（VerifyVATInvoice / CredentialVerifyV2）走 AK/SK 签名。

免费额度：官方 OCR 云市场版全部 0.01 元/500 次试用包；OpenAPI 直连版识别类每月 200 次免费；第三方普遍 2 元/10~100 次测试包；数脉身份核验 50 次免费。**benchmark 总预算约 30~100 元**。

## 与 2.3 对位的 API（核心组）

| 组 | API（商品码） | 能力 | 测试包 |
|---|---|---|---|
| D 篡改定位 | 快证签 证件票据PS篡改检测（cmapi00074097，3244用户/5.0） | 卡证票据文档 PS 判定+定位 | 2元；5元/50次 |
| D 篡改定位 | 怜花 图片PS检测（cmapi00074148） | 同上 | 2元/20次 |
| D 篡改定位 | 神度 篡改检测（cmapi00074333） | 判定+热力图 | 2元/10次 |
| D 篡改定位（官方） | CredentialVerifyV2（Cloudauth OpenAPI） | PS/翻拍/截屏/复印/水印 | 试用资源 |
| E AIGC检测 | 万维易源 AI生成图片检测（cmapi00063095） | AI 生成判定 | 2元/100次 |
| E AIGC检测（官方） | DetectAigcImage（内容安全） | AIGC+合成+局部编辑 | 按量 |
| A 发票OCR | 官方增值税发票识别（cmapi027758）、混贴分区（cmapi00034969）、翔云40+种（cmapi00075478） | 全字段结构化 | 0.01元/500次 |
| B 证件OCR | 官方身份证（cmapi010401，含tamper_score）、营业执照（cmapi013592）、银行卡（cmapi016870） | 结构化+图像风险分 | 0.01元/500次 |
| C 验真（不可比，仅能力边界） | VerifyVATInvoice、中科逸视（cmapi00071008）、笑脸普（cmapi00062619） | 对接税务权威库验真 | 各2元左右 |

完整清单（含 5 类 30+ 个 API、URL、价格、用户数）见调研过程记录；SaaS 平台类（百望云、票小秘）无独立 API 不纳入。

## 公平对比设计

- **可比组**：A/B 字段抽取（统一测试集逐字段 F1）；D 篡改定位（与 SEED/TruFor 同协议：AUC、IoU/F1@0.5）；E AIGC 判定（自建"AI生成证件票据"专测集，公开基准均为自然图像域）。
- **不可比组**：C 验真依赖权威数据源，我们做"票面自洽性"，报告以"能力互补矩阵"呈现（验真查假票号，我们查真票号+改金额），不进同一指标表。
- **对外指标总表**：字段抽取 F1 / 篡改定位 IoU / AIGC 判定 AUC / 端到端时延 / 千次成本 / 是否需权威数据源（最后一列凸显我们无数据源依赖）。
- **注意事项**：验真类部分错误码也计费；快证签/怜花/神度描述雷同疑似同源需抽验一致性；价格标注"2026-11 抓取"；测试票证必须脱敏或合成（图片会上传给供应商）。
- **市场空白**：云市场无任何 API 做"内容核验"（金额矛盾/跨材料矛盾），这是我们的差异化定位。

## 与现有 invoice-benchmark-20261106 的关系

现有 benchmark 只对比了内部三流程（Agent 8/8 / 直接语义 6/8 / 本地规则 0/8）。外部 API 对比先落 D 组（篡改定位，与 SEED/TruFor 同协议可直接复用 forensics 评测脚本）与 A 组（字段抽取，复用 invoice-benchmark 的 8 份 PDF + 中文票据集）；E 组需先构造 AI 生成票据专测集。

## 落地试点：领取步骤与四个首选 API（2026-11-09 补充）

领取流程：注册阿里云 → 个人实名（支付宝扫码）→ 商品页「价格」标签买最小试用套餐（官方 OCR 0.01 元/500 次；第三方 2 元体验包；VerifyVATInvoice 开通即送 50 次）→ https://market.aliyun.com/console 已购买服务中复制 AppCode → 商品页「API 调试」面板在线试调；代码调用统一加 `Authorization:APPCODE xxx` 头。

| 类别 | 首选 API | 试用额度 |
|---|---|---|
| 税务票据审核 | 中科逸视发票查验 cmapi00071008（含数电/医疗发票） | 0.02 元/10 次 |
| 多文件交叉核查 | 官方批量文档比对 cmapi00043681（纯文字 diff，语义核验为市场空白） | 页面试用 SKU |
| 发票证件 OCR | 官方增值税发票识别 cmapi027758 + 身份证识别 cmapi010401（含 tamper_score） | 各 0.01 元/500 次 |
| 验真 | 官方 VerifyVATInvoice（税局源，18 票型）；证件验真用数脉身份二要素（50 次免费） | 开通送 50 次 |

注意事项：验真类部分错误码计费；测试票证需合成/脱敏；价格以商品页实时为准。

## 适配层与评测入口（2026-11-10）

代码位于 `scripts/image-validation/aliyun-market/`，遵循仓库评测惯例：默认 dry 不联网、`--live` 才发真实请求、持久化预算账本（默认 60 次，可改）、每次调用原始请求/响应留档（0600，不含 AppCode）、无重试不刷分。

- `adapters.mjs`：7 个商品注册表（含商品码/试用额度/类别）+ 请求构造 + 响应归一化（OCR→字段表、验真→verified/status、篡改→tampered/score/regions、AIGC→aiGenerated/score、比对→differenceCount）。身份证端点用官方文档公开值；其余商品端点未购买前不可知，运行时通过 `ALIYUN_MARKET_ENDPOINT_<KEY>` 或 `--endpoint key=url` 传入，未配置即拒绝调用。
- `client.mjs`：AppCode HTTP 客户端；AppCode 通过 `ALIYUN_APPCODE_<KEY>` 或统一 `MARKET_APPCODE` 注入，不落盘。
- `run-market-benchmark.mjs`：成对评测入口。`<outDir>/fixtures.json`（样本+金标字段）与 `ours.json`（本方冻结结果）由准备阶段生成；输出 `market-results.json` 逐样本三方对照（gold/ours/external）。判分独立进行。

使用：
```bash
node scripts/image-validation/aliyun-market/run-market-benchmark.mjs runtime/replay/market-benchmark --product=invoice-ocr        # dry
ALIYUN_APPCODE_INVOICE_OCR=xxx ALIYUN_MARKET_ENDPOINT_INVOICE_OCR=https://... \
node scripts/image-validation/aliyun-market/run-market-benchmark.mjs runtime/replay/market-benchmark --live
```
测试：`tests/image-market-adapters.test.mjs` 7 项（注册表、归一化、预算/留档/拒绝路径），无网络依赖。
