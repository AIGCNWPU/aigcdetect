# SEED 本地定位与 DeepSeek 脱敏解释

2026-10-21 用户要求：以 SEED 替代 9B 作为本轮主测定位路线，保留 DocShield-9B；DeepSeek 仅接收脱敏摘要，密钥及真实业务材料不公开。场景后端适配和本地实验已实现，公共 HTTP/智鉴页面仍未接通，不宣称平台已切换上线。

## 资产与可复现配置

- [SEED 官方源码](https://github.com/KahimWong/SEED)：commit `0a60bf9144216c5545a53e7d2b80476c006a538f`，目录 `/data/lvjiawen/baselines/seed/code`，上游工作区保持未修改。
- [官方完整权重](https://huggingface.co/Jason37437/SEED)：revision `93f2ee4d2f617ff1ffda55a0d88b4920c9a848dc`，`model.safetensors` 1,260,633,128 字节，发布者 SHA256 `7ed896311181b1e24d3bcb696c1542a7942df5cd89729e2b9de90112327102d9`，HF 镜像下载后已一致。配置和模型卡也核对 Git blob 哈希。
- 权重在 `/data/lvjiawen/baselines/seed/weights`。它包含完整 backbone；适配器仅初始化 DINOv3 ViT-L 架构，再严格加载全部 SEED state，missing/unexpected 均为空，不使用随机参数作为降级模型，也没有下载另一份受门控的 Meta 权重。
- `seed-runtime` 使用独立 venv，`.pth` 只读引用现有 MIRROR 运行包，在自身环境覆盖 transformers 4.56.1；torch 2.6.0+cu124。没有修改 9B/MIRROR 权重或原环境。不是上游 requirements 的逐项复刻：训练增强、torchaudio 等不参与本地推理。
- 上游 SEED 代码/模型卡标注 MIT；DINOv3 基座另有许可条款，不能把基座及所有训练数据都称 MIT。当前用途为内部研究，部署分发前仍须审查完整许可链。

## 检测与定位

`src/modules/image/documents/python/seed_detector.py` 复用上游 EoMT/LoRA 模型代码，按 EXIF 方向读取 RGB，在原尺寸上切 512×512 图块，末块贴边，小图居中补白。选前景 query 的 mask，上采样 logits 后 sigmoid；图块分类分数 ≥0.5 时保留 mask，多块取像素最大值，mask 阈值 0.5。图像检测分数采用图块最大值，明确属于未校准分数。

保留原尺寸 16-bit 概率图、二值 mask、所有连通区域及框、面积和区域分数；评审预览最多绘制 200 个框，但 JSON 和 mask 不丢区域。`seed_evidence.py` 用实际 mask 像素与 OCR 多边形相交，保存本地原文、框、识别分数和来源；不以框相交证明篡改，也不恢复修改前原值。

首轮 20M 像素上限导致 6 张 4961×7016 页未处理。随后以 40M 研究上限、固定 transformers 4.56.1 重跑同一清单；原始运行保留。此上限不是生产上传政策。阈值和样本没有按结果调整。

## 2026-10-22 CORD 解释更正

此前将 CORD 100 张发布图片统一设为正常负例，并将全部报警称作“100% 误报/严重失配”，现撤回该解释。CORD 是 OCR/解析数据，不提供鉴伪真值；直接查看 test-000、001、002 可见局部模糊/遮盖，SEED 多处预测覆盖这些编辑区域。发布原文件不等于未经编辑的相机原图。

确认的是 100/100 报警，不是误报率 100%，也不是检出率 100%。尚未逐图标注全部编辑区域，不能说所有框都正确，更不能由脱敏编辑推断交易造假。冻结推理输入和原始响应保留；历史 label=0 只是研究者假设，新汇总排除 CORD 鉴伪混淆矩阵，输出观察性报警率。RealText 同60张对比不受这次口径更正影响。

## 同样本评测结果

固定原有 RealText-V1 60 张（30正常、30篡改）以及 CORD 官方 test 全部 100 张原始票据；最终 160/160 成功执行，单卡 GPU 3。

| 条件 | 正常判正常 | 正常被标记 | 篡改漏检 | 篡改检出 | 无有效结论 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 9B，V1 同60张 | 28 | 2 | 16 | 12 | 2 |
| SEED，V1 同60张 | 17 | 13 | 0 | 30 | 0 |
| SEED，CORD 发布图100张（无鉴伪真值） | 不适用 | 100张报警，不能计误报 | 不适用 | 不适用 | 0 |

SEED 在此 V1 清单的准确率 47/60=78.33%，召回 30/30=100%，误报 13/30=43.33%；补回 9B 全部 16 个漏检，但新增 11 个原先正确正常判断的误报。V1 ROC-AUC 0.97778，排序指标不代表阈值已经可用。处理耗时中位约 0.37 秒、P95 5.73 秒，含本地后处理/写图，非平台 SLA。

**不能认定 SEED 已经优于 9B 并可直接用于拒绝或通过材料。** 当前 RealText 基线表现为高召回、高误报。CORD 存在发布前模糊/遮盖，不能作为未经编辑负控，也不能计算鉴伪误报率或召回率；RealText 系列训练重合尚未排除。这两批没有可用真实篡改 mask，框能生成不等于定位准确，未计算 IoU。也不能外推中文票据能力。

原始记录：`tmp/image-workspace/seed-evaluation-20261021/`。最终基线在 `run-upstream4561/`，包含 `results.json`、`metrics.json`、`index.html` 及每张原图预览/叠加/mask；首轮在 `run/`。后验输入方式诊断单列 `resize-diagnostic/`，不能覆盖正式基线或算独立测试成绩。

## DeepSeek 接入与密钥

本地配置文件为仓库根 `.env.image-documents.local`，权限 0600，已被 Git 忽略。只在服务器读取：

```dotenv
DEEPSEEK_API_KEY=在本地填写
DEEPSEEK_MODEL=deepseek-flash
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_ENABLED=true
DEEPSEEK_MAX_TOKENS=1200
DEEPSEEK_TIMEOUT_SECONDS=60
```

上面是占位示意，不包含真实密钥。真实配置不提交、不进入静态包或前端、不粘贴聊天。当前使用 [DeepSeek 官方 API 文档](https://api-docs.deepseek.com/)支持的 `deepseek-flash` 与 JSON 输出；模型名称可在允许列表内配置。

可编辑提示词：`src/modules/image/documents/prompts/deepseek-receipt-summary.txt`。要求视觉疑点、内容矛盾、OCR 不确定性分别解释；禁止声称看到了未提供的图像细节、恢复原值、判断动机或外部验真。

外发采用严格白名单，而不是仅正则遮盖姓名：只允许相对坐标、检测分数、OCR 质量统计及固定枚举规则状态。原图、OCR 原文、姓名、号码、地址、账户、金额、文件路径和材料哈希均不发送。此设计比原 SEED 多模态 API 流程更保守，解释能力相应受限，不是原论文完整报告能力的复现。

`deepseek_explainer.py` 拒绝未知字段/证据ID、非官方端点、重定向、宽松文件权限；不使用环境代理，不记录 Authorization 或服务器错误正文；输出截断、错误结构、未知引用均判失败。密钥未填或开关关闭时保留未运行。实际生成内容仍属待复核解释，JSON 校验不能证明语义正确。

## 实际API验证

已选 2 张 V1（正常/篡改各1）及 CORD 第1张共3个公开研究样本，实际调用全部成功，引用结构有效，回答明确“未查看原图”，没有把视觉线索直接宣称为篡改事实。消耗合计 3,218 tokens（本次三次实际响应 usage 汇总），请求只发脱敏摘要。三张的适用金额规则均为空，因此这次仅验证解释链路与边界，不能称完成金额矛盾解释验收。

原始 API 报告 `deepseek-explanations.json`、本地 OCR/mask 原文关联 `local-ocr-links.json` 均留在被忽略的研究目录，不作为公开脱敏报告发布。

## 运行入口与边界

```sh
/data/lvjiawen/baselines/envs/seed-runtime/bin/python scripts/image-validation/evaluate_seed.py \
  --source /data/lvjiawen/baselines/seed/code --weights /data/lvjiawen/baselines/seed/weights \
  --manifest tmp/image-workspace/seed-evaluation-20261021/manifest.json \
  --output-dir tmp/image-workspace/new-seed-run --gpu 3 --max-pixels 40000000
```

`explain_seed.py` 默认 dry-run，必须加 `--send` 且本地开关开启才发送；每次最多显式选择3个样本，输出文件不能覆盖。所有实验路径不参与浏览器打包。

仍需独立中文/跨域验证、有真值 mask 的定位评测、误报校准与材料模板覆盖、公共 HTTP/权限/任务/前端及脱敏导出。保留9B作对照；不根据本批成绩直接改变生产决策。本轮不 commit、push、merge。

## 输入方式诊断与验证收尾

后验固定选原清单前6张 V1（3正常/3篡改）及前6张 CORD，将整图缩放到512×512再推理：V1正常3/3未标记、篡改2/3检出，CORD仍6/6高分标记。缩放使一张原来检出的篡改票据漏检，CORD报警的正误仍未获得独立验证；因此不以缩放替代原基线，也不在这批测试上调阈值后宣称解决误报。

新增SEED/脱敏/关联测试9项通过；统一Python发现63项，其中51项通过、12项因相应环境没有PDF/OpenCV依赖显式跳过，SEED依赖项在seed-runtime另测通过。项目check、既有框架测试、build、HTTP占位smoke和OpenSpec严格验证通过；它们不代表真实业务API上线。凭据排除扫描确认实际密钥不在Git可提交文件、dist静态产物和API测试报告中，扫描不输出密钥。
