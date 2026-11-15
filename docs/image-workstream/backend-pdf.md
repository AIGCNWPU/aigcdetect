# 材料后端与 PDF 辅助链路

2026-10-21：已实现可在服务器调用的场景后端核心和本地验证入口。公共 HTTP 接口仍为 501，未接入鉴权、材料存储、任务队列与智鉴页面；本目录不是第二套对外应用，也不把命令行测试当成平台已上线。

## 同批材料核心

代码：`src/modules/image/documents/server/batch-engine.js`。

- 校验材料、页、字段、原文、来源哈希、坐标、识别分数与版本；拒绝坏框、失败页上的字段和越界坐标。
- 同名同值仅产生候选；只有独立关联证据或可信审核者确认，才进入同主体/同交易比较。角色、时点、币种和金额口径不明确时输出 NEI 或 NOT_APPLICABLE。
- 使用 BigInt 定点十进制检查净额 + 税额 = 总额；当前研究容差 0.01、OCR 复核门槛 0.90 尚未按业务校准。
- 确认完整结算集合后按签发机构 + 支付流水号去重汇总，保留退款负号；重复文件不自动判重复报销。
- 字段更正保留原始 OCR 与历史值，递增字段/材料/批次版本；输入和可信关联上下文变化均使旧结果失效。
- 不生成整批真假总分，不自动推断关联，不把规则 FAIL 当图像伪造。

调用：`node scripts/image-validation/check-material-batch.mjs batch.json trusted-context.json output.json [scenario]`。输入是内部证据对象，不是上传 API；可信上下文必须来自后端审核记录，不能把客户端任意 JSON 当已确认关联。结果文件禁止覆盖。

`material-catalog.json` 与 `catalog.js` 提供 12 类金融场景的出处、候选材料、规则设计及例外。详见[金融场景](financial-material-rules.md)。目录覆盖查询始终不冒充机构政策审查，缺少候选材料不直接 FAIL。专有规则目前多数处于设计阶段。

## PDF 到同一证据链

`src/modules/image/documents/python/pdf_adapter.py` 以受限子进程调用 PDFium，逐页渲染 PNG，读取可选文本层并记录页码、页图哈希、旋转/裁剪信息与像素到 PDF 坐标的仿射变换。使用 PDFium 实际转换器，避免只按 DPI 推算旋转后的坐标。

`pdf_evidence.py` 将 OCR 结果绑定回父 PDF 哈希与原始页码，同时保留页图哈希与原 OCR 文字/置信度/文字框。相同内容的两页仍按不同页码保存，缺页、失败或未运行不计作整份成功。`scripts/image-validation/pdf_to_evidence.py` 已串联真实本地 PDF → OCR → 来源证据；随后可复用票据字段与规则处理。

本地运行示例（输出目录必须全新）：

```sh
/data/lvjiawen/baselines/envs/ocr-runtime/bin/python scripts/image-validation/pdf_to_evidence.py \
  --input /path/to/material.pdf --output-dir tmp/image-workspace/pdf-case \
  --weights /data/lvjiawen/baselines/ocr/weights
```

当前开发默认限制：50 MiB、50 页、每页 2000 万像素、整份 1 亿像素、每页最多 2 万文本字符、144 DPI、解析渲染子进程 120 秒/2 GiB。它们不是已确认的产品上传限制。超页数整份显式拒绝；页级像素超限保留失败状态，不截取前几页后称成功。OCR 进程尚未纳入生产队列的单页超时/取消管理。

加密 PDF 在核心函数可传入临时密码，报告不存密码；本地 CLI 尚未提供密码入口。默认不执行 JavaScript、不初始化交互表单、不提取附件，不验证数字签名。动态表单渲染覆盖尚未验证。

文本层可能隐藏或与可见内容矛盾，因此保存为 `unverified_text_layer_not_visual_truth`，仍逐页跑 OCR。当前 `text_image_consistency=not_checked`，不能声称已经发现所有文本层篡改。PDF/UserUnit、复杂字体、特殊表单、OFD 解析与结构化电子凭证附件尚未完成。

## 验证与未完成项

本轮包含旋转/裁剪、隐藏文字、密码、损坏、页数/像素上限、超时、坐标回映、同图多页及证据绑定检查。另有 16 份/64 页受控 PDF 测试、真实 9 页中文官方 PDF 和 4 页文本/扫描混合 PDF 的实际 OCR 运行，结果以[规模评估](scale-evaluation.md)为准。

未完成：真实上传/下载接口、异步任务/取消与重试、自动金融材料分类和字段语义抽取、全量跨材料专用规则、PDF 文本图像冲突判定、脱敏导出及访问控制。文档/测试通过不代表上述能力已交付。

日期字段增加显式格式的日历有效性检查：闰年/世纪年、月末与零日期；跨格式生日可规范化比较，其他日期须确认属于同一事件。格式不明、OCR 歧义不自动修复，历史签发日期不同不直接报冲突；此项不判断证件法律效力。

PDF 已通过 `pdf_receipt_rules.py` 复用同一个图片票据规则器，保留父文件/页码证据。本轮 9 页官方指引和 4 页混合文件均未匹配现有三个研究版式，实际金额检查数为 0；这是未覆盖，不是核验通过。后续需要新增明确的真实金融模板与字段抽取，不能用手填字段冒充自动核验。

关联上下文还必须携带匹配的 `batchId` 和 `batchVersion`；字段更正后旧确认上下文拒绝继续使用，需要在新版本上复核关系再计算。当前采用整批保守失效策略，避免基础证据变化后仍沿用旧人工确认。

同批核心现为 `material-batch/0.2`：增加材料对覆盖记录、同票确认门槛、未配置字段/空值/抽取歧义保护和关系证据快照。`ocr-fields.js` 新增已有图片 OCR 输出到字段证据的适配器及本地入口，具体支持的标签、坐标语义和限制见[交叉匹配增量](cross-material-rules.md)。尚未接入 PDF 父来源转换、自动分类或公共 API。
