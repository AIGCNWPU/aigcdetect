# 真实中文材料与规则增量验证

日期：2026-10-21。对应 `add-image-documents` 2.4、3.1–3.5。仍为本地场景核心，公共 API、智鉴页面和脱敏导出未交付；无 commit/push。外部核验 API 未调用。

## 已实现规则

核心版本 `material-batch/0.3`；专用事实规则 `document-facts/0.1`，数电票版式 `cn-digital-vat-layout/0.1`，集合计算 `invoice-set/0.1`。

| 规则 | 输入及适用条件 | 输出边界 |
| --- | --- | --- |
| 身份号结构/校验 | 18 位号、MOD 11-2、生日日历有效性；低分/字符歧义先复核 | 与同角色明示生日、性别交叉比较；历史行政区划未配置为 NEI，不核定真实身份 |
| 票号与日期 | 数电票 20 位；传统电子普票须明确 subtype 后检查 8 位号码、12 位且首位 0 的代码 | 没有万能票号校验位；数电号码年份与日期比较限制在全国推广日期后，早期试点缺地域规则为 NEI |
| 中文大写金额 | 支持金融大写数字、万/亿、元/圆、角分、整/正和显式防填符号 | 与明确 CNY 小写金额精确比较；不支持的写法保留 NEI，不猜字；这是显示值计算而非受理规范审查 |
| 价税关系 | 唯一合计行、金额/税额列头和价税合计小写，原文来源完整 | BigInt 定点净额＋税额与总额比较，研究容差 0.01；区分小计、合计和明细 |
| 完整票据集合 | 后端上下文确认完整范围、审核者与原因；同币种，明确签发方及票号，传统票还须代码 | 分期开票净额汇总；重复票视图只计一次，重复值冲突为 NEI；红票需明确同集合原蓝票关联；目标不允许作为自身证据 |
| 报告失效 | 字段、关系、批次及规则引擎版本 | 更正保留原 OCR；旧版本报告不再视为当前结果 |

依据：[GB 11643-1999 官方托管文本](https://zjw.beijing.gov.cn/Portals/0/zhuanti/fazhan/%E8%BA%AB%E4%BB%BD%E8%AF%81GB11643-1999.pdf)、[税务总局 2024 年第 11 号公告](https://fgk.chinatax.gov.cn/zcfgk/c100012/c5236067/content.html)、[2015 年第 84 号公告及修订标记](https://fgk.chinatax.gov.cn/zcfgk/c100012/c5194596/content.html)。规则模块保存来源 URL；不将来源文本中的所有业务政策视为均已实现。

## 实际材料与结果

下载文件、逐页图、完整 OCR、字段及原值报告位于忽略目录 `tmp/image-workspace/chinese-validation-v1/`，不随代码分发。来源/字节数/本地 SHA256 见 `sources.json`；没有发布者哈希，不能把本地哈希称官方完整性认证。

| 材料 | 实际内容 | 验证结果 |
| --- | --- | --- |
| [政府采购公开食品发票](https://erqi.zfcg.henan.gov.cn/cmsweb81e27e/nas/webfile2024/zhengzhou/rootfiles/2025/06/30/bebedbdd641a4de8a62b76d95f9a024e.pdf) | 同票 6 页，密集明细 | 6 页 OCR 成功；票号/日期正常提取，末页大小写金额一致；部分“小计/合计”被 OCR 竖向合并，价税三字段不足，6 页算术均保留 NEI |
| [政府采购公开设备发票](https://hebi.zfcg.henan.gov.cn/cmsweb81e27e/nanyang/rootfiles/2025/02/08/c03d0be74c6742d6aa291a32d5fb831f.pdf) | 一个 PDF 内的 5 张票，不能据同文件认作同票 | 5 页 OCR 成功，每页自动提取 10 字段；5 组价税和 5 组大小写金额通过；4 张早期试点票的号码年份政策范围为 NEI |
| [税务部门电子专票空白票样](https://tianjin.chinatax.gov.cn/uploadFiles/file/20201221/20201221113818_870.pdf) | 1 页空白官方版式 | OCR 成功，业务字段为 0；缺金额/票号均为 NEI，没有“空表全通过” |
| 第三份采购附件候选 | 未通过下载内容/大小检查 | 显式记为下载失败，未纳入已处理样本数 |

共 3 个下载成功文件、12 页，1,607 个 OCR 区域，92 个业务字段。OCR 累计约 622.01 秒（不含模型加载和 PDF 渲染）。页级规则 52 项：40 PASS、12 NEI、0 FAIL。没有独立篡改标签，因此不报告真伪准确率、召回率或误报率。

所有业务页参与同批候选诊断，共 622 个候选；没有人为虚构可信关系，全部保持 NEI。候选数不是“已核实事实数”。同一 PDF 中的不同票不能只因同文件自动关联。当前还需要真实同交易多材料的独立关系标注，验证跨材料冲突的业务效果。

逐图抽查食品末页和设备第一页的 10 个日期、名称、金额字段，10/10 匹配，字段来源含父 PDF 页码与原 OCR 框；标注存在 `spotcheck-labels.json`。这是开发者选定字段的目视抽查，不是全量字段准确率或独立评测。

对设备第一页**提取后的金额字段**增加 1 元作为受控故障，两条金额规则均 FAIL；原文保留、旧报告失效。没有修改真实图片，该项明确属于合成字段测试，不能记作检出真实篡改。

## 实测暴露的问题与处理

- OCR 把竖向相邻“小/合”合为“小合”，不能根据哪笔金额更大来挑总额。二次 OCR 将其读成独立“小”“合”，同时出现额外邻近碎片；结果完整保留在 `food-total-label-retry.json`，不自动覆盖原识别或视为独立佐证。
- 设备票合计标签为横向独立“合”“计”框。版式规则仅在同行、正确顺序、标签列及中间无其他文字时组合，结果保留两原框，绝不输出伪造的字符框。
- 通用 OCR 中可出现空文本区域；修复了其被来源校验误拒的问题，仍校验空区域坐标，但不生成空业务字段。
- 购销方角色由明确“购买方信息/销售方信息”的区域边界确定，不按左右位置单独猜角色；文字分数高仍不等于识别正确。
- 开发中查看了上述样本并改进版式，故整批属于开发诊断集。后续独立留出集必须另行冻结，不能把本轮结果回报为泛化性能。

## 复现和查看

已有 `pdf_to_evidence.py` 对每个 PDF 运行真实本地 OCR；在仓库根目录执行以下后处理，输出文件必须不存在：

```sh
node scripts/image-validation/evaluate-chinese-documents.mjs tmp/image-workspace/chinese-validation-v1 tmp/image-workspace/chinese-validation-v1/evaluation-v2.json
node scripts/image-validation/check-chinese-spotchecks.mjs tmp/image-workspace/chinese-validation-v1/evaluation-v2.json tmp/image-workspace/chinese-validation-v1/spotcheck-labels.json tmp/image-workspace/chinese-validation-v1/spotchecks-v2.json
node scripts/image-validation/render-chinese-review.mjs tmp/image-workspace/chinese-validation-v1/evaluation-v2.json tmp/image-workspace/chinese-validation-v1/review-v2.html
```

已有 `review.html` 可本地打开，选择页面、点击字段显示标签/值原框，查看 PASS/NEI 和原始公开来源。此页是本地诊断资产，包含原值，不是脱敏报告或产品页面。

仍未完成：完整明细行与税率/舍入策略、所有红票业务约束、大小写金额全部变体、历史行政区划和机构更名、年龄/有效期规则、真实身份材料的授权样本、C01–C15/G01–G08 专用业务全集，以及公共服务/前端/脱敏集成。因此任务不标完整完成。
