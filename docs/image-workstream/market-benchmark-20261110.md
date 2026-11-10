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
