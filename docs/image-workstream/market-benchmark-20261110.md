# 阿里云云市场 API 实测记录（2026-11-10）

在自有服务器用 `scripts/image-validation/aliyun-market/` 适配层调用，原始请求/响应归档于 `runtime/replay/market-benchmark-20261110/<product>/raw/`，逐次预算账本在同目录 `budget.json`。AppCode 仅经环境变量注入，未写入仓库与归档。测试材料全部取自本地数据集，未上传真实业务材料。

## 结果总览

| 商品 | 端点 | 结论 | 实测数字 |
|---|---|---|---|
| 增值税发票 OCR | `dgfp…/ocrservice/invoice` | ✅ 可用且准确 | E01、E02 各 **7/7** 字段全对；完税证明返回 430「图片和服务类型不匹配」 |
| 批量文档比对 | `doccompare…/ocrservice/doccompare` | ✅ 可用 | E01 vs E02 **27 处**差异；CrossCred 同号完税证明组 **15 处**差异，均含文字级定位 |
| 发票查验（中科逸视） | `invoicev…/aliyun/invoiceVerify` | ⚠️ 参数已探明，样本不适用，随后额度耗尽 | 合成票号 `0001345` 返回 `CY0005 发票代码格式错误`；余额告罄 `B403MQ` |
| 身份证 OCR | `cardnumber…/ocr_idcard.json` | ⚠️ 未取得有效样张 | 非身份证图均返回 `463 Invalid Input - wrong category` |
| 证件票据 PS 篡改检测（快证签） | `kzpt…/api/forgery/detection/ocr` | ❌ 未取得有效结果 | 首轮参数名不符（响应「请输入图片」）；改为 `base64` 后额度已耗尽 |

## 一、增值税发票 OCR（阿里官方读光）

请求：`POST https://dgfp.market.alicloudapi.com/ocrservice/invoice`，body `{"img":"<base64>"}`（参数名为 `img`，非 `image`）。

返回中文字段：`发票代码/发票号码/开票日期/发票金额/不含税金额/发票税额/大写金额/受票方名称/…/发票详单`。

逐字段对照（金标来自我们 10/26 真实核验记录）：

| 字段 | 金标 | 外部 API | 我们 |
|---|---|---|---|
| invoice_code | 2024330000123 | 2024330000123 | 2024330000123 |
| invoice_number | 0001345 | 0001345 | 0001345 |
| invoice_date | 2024年08月29日 | 2024年08月29日 | 2024年08月29日 |
| gross_amount | 1999.99 / 30000.00 | 同 | 同 |
| net_amount | 1999.99 / 30000.00 | 同 | 同 |
| tax_amount | 259.99 / 62.31 | 同 | 同 |
| 购方名称 | 李*娜 / 江*速 | 同 | 同 |

合计 **14/14 字段一致**（两份各 7 项）。它对完税证明返回 `430 图片和服务类型不匹配`——说明该 API 只接发票，跨材料类型不覆盖。

## 二、批量文档比对（阿里官方）

请求：`POST https://doccompare.market.alicloudapi.com/ocrservice/doccompare`，body 为 `referenceParam.docParamList[]` 与 `queryParam.docParamList[]`，每项 `{id,img}`（需 form/json 均可，图片 base64 ≤4M、最长边 ≤4096）。

返回 `doc.match_list[].match_detail[]`，每条含 `type`（modify/delete/insert）与 reference/query 两侧文字及坐标。

| 样本对 | 差异数 | 典型差异 |
|---|---|---|
| E01 vs E02（同票号不同金额） | 27 | `宁波增值税`→删除；`子普通发票`→`普通发票`；`称：李*娜`→`江*速` |
| CrossCred 同编号完税证明 | 15 | `国家税务总局南京市税务局`→`国家税务局总局开封市税务局`；税号 `9132010620230518765`→`9140200MA01Q2XWBP` |

**重要**：它输出的是**文字级 diff**，不做语义或算术判断。27 处差异中相当一部分来自版式/字号导致的切分差异，并非业务矛盾；要得到"价税合计不符"这类结论仍需规则层。这正是我们"内容核验层"的差异化依据。

## 三、发票查验（中科逸视）

必填参数（从 `x-ca-error-message` 逐次探明，**form-urlencoded**）：`invoice_number`、`invoicing_date`、`invoice_amount`，可选 `invoice_code`。

- 用合成票 E01 调用：HTTP 200 + `{"code":"CY0005","msg":"发票代码格式错误"}`
- 原因：我们的测试票是合成数电票，号码 `0001345` 仅 7 位，不满足真实票面格式校验
- 随后额度耗尽：`x-ca-error-code: B403MQ`（Api Market Subscription quota exhausted）

**结论**：验真类 API 依赖真实合规票面，与合成测例天然不兼容；它查的是"票在税务系统是否存在"，我们查"票面是否自洽"，属能力互补而非同一赛道。

## 四、身份证 OCR

端点与参数按官方文档（`image` + `configure.side`）。用 FCTM 伪造文档图和 DeepFakeFace 真实人脸调用，均返回 `463 Invalid Input - wrong category`。

**原因**：数据集内没有真实身份证样张（隐私与合规原因不采集），本轮无法验证其字段准确率与 `tamper_score`。这是一处待补测项。

## 五、证件票据 PS 篡改检测（快证签）

首轮按 `{image}` 调用，返回 `{"msg":"请输入图片","success":false,"code":400}`；按同厂商文档改为 `{base64, detectThreshold, restrictProbability}` 后，额度已耗尽（`B403MQ`）。

**未取得有效结果**，不能对其实力下结论。已把正确参数写进适配器，待补充额度后重跑。

## 六、过程中的教训（供后续评测参考）

1. **探参数会烧额度**：10~20 次的体验包在参数试探阶段就耗尽。正确做法是先读文档（或从 `x-ca-error-message` 用最小样本定位），确认一次成功后再批量跑。
2. **各商品参数风格不统一**：官方读光用 `img`；查验类 form + snake_case；篡改类 `base64`；身份证 `image`。适配器已按商品分别建模。
3. **额度是每商品独立**：五个商品各自有独立套餐，一个耗尽不影响其他。
4. **安全**：AppCode 已在会话中明文出现，建议在买家中心重置；归档只记录 URL 与响应，不含密钥。

## 复跑方式

```bash
MARKET_APPCODE=<appcode> node scripts/image-validation/aliyun-market/run-market-benchmark.mjs \
  runtime/replay/market-benchmark-20261110/<product> --live --product=<key>
```

样本与金标在对应目录 `fixtures.json`，我方冻结结果在 `ours.json`（发票 OCR 目录）。离线重评分可从 `raw/` 读取，不产生调用。

## 七、发票查验第二轮（额度补充后，2026-11-10 晚）

补充 10 次额度后，用**真实数电票**（`23412000000052124997`，2023-11-15，价税合计 306500.00，购销方为唐河县教育装备与技术保障中心 / 唐河县欧科电器制造有限公司）做三次定向调用，一次命中，剩余 7 次保留。

请求（form-urlencoded）：`invoice_number`、`invoicing_date`、`invoice_amount`，可选 `invoice_code` / `check_code`。

| 样本 | 提交要素 | 返回 | 判定 |
|---|---|---|---|
| real-correct | 号码＋2023-11-15＋306500.00（原样） | `code=0000`，`msg=查验成功` | ✅ 验真通过 |
| tamper-amount | 金额改为 306000.00 | `code=CY0017`，`msg=发票数据不一致` | ✅ 识别金额被改 |
| tamper-date | 日期改为 2023-11-16 | `code=CY0017`，`msg=发票数据不一致` | ✅ 识别日期被改 |

成功响应的 `content` 是 base64 编码的税务票面 JSON，解码后与本方 OCR 结果逐字段对照：

| 字段 | 税务返回 | 我方 OCR |
|---|---|---|
| fphm（号码） | 23412000000052124997 | 23412000000052124997 |
| kprq（开票日期） | 20231115 | 2023年11月15日 |
| jshj（价税合计） | 306500.00 | 306500.00 |
| je（金额） | 303465.35 | 303465.35 |
| se（税额） | 3034.65 | 3034.65 |
| gfmc（购方） | 唐河县教育装备与技术保障中心 | 唐河县教育装备与技术保障中心 |
| xfmc（销方） | 唐河县欧科电器制造有限公司 | 唐河县欧科电器制造有限公司 |

7/7 一致；税务返回额外提供购销方税号（`gfsh` / `xfsh`），我方该两项未抽取，是明确的字段缺口。`jfbz` 为交付标志。

### 对 benchmark 的意义

1. **能力边界清晰**：验真类能发现"与税务记录不一致"（改金额、改日期），我们无法也不应声称覆盖；我们能在**没有税务数据源**时从票面自身发现"价税合计≠金额+税额"，两者互补。
2. **可作为交叉校验金标**：对真实票，税务返回可当独立真值来评估我方 OCR 与规则；对合成票（如 E01/E02 的 7 位号码），验真直接 `CY0005` 拒绝，说明合成测例天然不适合验真赛道，benchmark 里不能把这种拒绝计为对方失败。
3. **合成票的号码格式**导致 `CY0005`，与算法能力无关，评分时必须单列"格式/不可用"，不得算作错误。

剩余 7 次额度保留，用于后续真实票抽样或复现核验。

## 八、图片篡改识别（怜花数科）十次实测（2026-11-10）

端点 `POST https://lhtpcg.market.alicloudapi.com/image/forgery/detection`，form-urlencoded：`base64`、`restrictProbability`、`imgType`、`detectThreshold`。返回 `data.detectionResult`（fake/real）、`tamperedProportion`、`tamperedLocation[]`、`heatmap`。

样本：FCTM 伪造文档 4 张（含真值掩码，篡改像素占 5.2%）＋ DeepFakeFace 真实人脸 1 张 ＋ 豆包 AI 生成图 1 张。10 次额度全部用完（6 + 3 + 1）。

### 检测结果

| 样本 | 默认阈值 0.9887 | 阈值 0.4 |
|---|---|---|
| FCTM 伪造文档 ×4 | 全部 `real`（置信 0.444~0.499）→ **4/4 漏检** | `fake`（0.451 / 0.499）→ 2/2 检出 |
| DeepFakeFace 真实人脸 | `real`（0.321）→ 正确 | `real`（0.321）→ 正确，无新增误报 |
| 豆包 AI 生成图 | `real`（0.804，全批最高） | 未测（额度不足） |

### 定位能力

- `tamperedLocation` 在 `restrictProbability` = 0.8 / 0.3 / 0.1 三档下**始终为空数组**，未返回任何坐标。
- `heatmap` 字段解码后是**校正后的整张文档图**（755×824，带紫色底色），不是热力图；按像素统计均值 0.69、几乎全图同值，无法用于定位。
- 因此**无法计算定位 IoU**，与本方 TruFor/SEED 的 IoU 指标不可比。

### 与本方 TruFor 同图对照（本地推理，无 API 消耗）

用同一批 4 张 FCTM，`scripts/image-validation/evaluate-trufor-fctm.py`，权重 sha256 `ac1d90e3…`：

| 方法 | 分数区间 | 阈值 0.5 检出 | 0.5 时像素 IoU |
|---|---|---|---|
| 怜花 API | 0.444~0.499（默认阈值 0.9887） | 0/4 | 无坐标，不可算 |
| 本方 TruFor | 0.338~0.361 | 0/4 | 0.00（0.15 阈值下 0.021） |

**结论：FCTM 这批中文证件伪造对双方都很难**，两者在各自默认操作点下均未检出。不能据此宣称任何一方更强；差异只在分数区间（API 0.44~0.50 vs TruFor 0.34~0.36）与可调阈值行为。

### 对 benchmark 的意义

1. 该 API 的默认阈值 0.9887 极其保守，在真实篡改样本上漏检率很高；把阈值降到 0.4 后能在我们的样本上检出且不误报真人脸——但阈值是我们选的，报告里必须写清"默认 vs 调参"两套结果，不能只报好看的那套。
2. 它**不提供可用定位信息**，无法参与"篡改定位 IoU"赛道；只能进"是否篡改"二分类，且样本量（4 张伪造 + 1 张真实）不足以给出统计结论。
3. 豆包 AI 生成图给出全批最高分 0.804 但仍判 real——说明它衡量的是"PS 痕迹"而非"AI 生成"，与我们 DDA-H+ 的整图生成检测是不同任务，不应混为一谈。
