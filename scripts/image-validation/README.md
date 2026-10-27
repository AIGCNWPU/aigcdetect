# 图片模型离线验证工具

本目录服务于两个已有 OpenSpec 工作包的模型准备与后端验证。它不启动产品 HTTP 接口，不向外部 API 发送材料，也不替代智鉴页面、公共任务或报告服务。研究数据、模型、运行结果均保留在 Git 之外。业务验收边界见[资产与验证安排](../../docs/image-workstream/assets-and-validation.md)。

在仓库根目录执行。当前机器的资产根目录是 `/data/lvjiawen/baselines`；下列路径是本机运行配置，不应硬编码到前端。

## 资产下载与审计

`download_assets.py` 使用完整 HF commit SHA，并按官方 API 元数据中的 LFS SHA-256 或 Git blob SHA-1 校验所有文件。`--metadata` 接受此前从官方 API 保存的可信快照；仓库 id 与 revision 必须一致。镜像只改变传输端点。

```sh
/data/lvjiawen/baselines/envs/image-download/bin/python scripts/image-validation/download_assets.py \
  --repo vankey/DocShield-9B \
  --revision be48c35e645e4c9382f33c67d492172823b2be8d \
  --target /data/lvjiawen/baselines/docshield-9b/weights \
  --metadata tmp/image-workspace/reports/docshield-metadata.json \
  --ledger tmp/image-workspace/reports/docshield-download.json \
  --endpoint https://hf-mirror.com --transport curl --workers 4 --segments 8
```

`download_range_asset.py` 处理 PyPI、Google Drive 等公开 HTTPS 大文件。必须给出已核对大小，并提供 `--sha256` 或显式声明 `--no-publisher-hash`。后一种只记录来源与本地哈希，状态是 DOWNLOADED，不能当成发布者完整性认证。失败分段保留；完整文件拒绝覆盖。重启前确认此前写入同一目标的进程已经结束。

```sh
python3 scripts/image-validation/audit_realtext.py \
  --root /data/aigc/datasets/RealText-V1-research \
  --metadata tmp/image-workspace/reports/realtext-metadata.json \
  --output tmp/image-workspace/reports/realtext-audit.json
```

RealText-V1 只作内部科研和调试。实际发布文件、缺失引用、训练重合与语言限制写入审计报告，不将数据卡描述自动视为已下载内容。

## OCR

专用环境：Python 3.10、paddlepaddle 3.3.0、paddleocr 3.7.0、paddlex 3.7.2、opencv-contrib-python-headless 4.10.0.84。先卸载该专用环境内 GUI OpenCV，避免两个发行包同时覆盖 `cv2`；不要修改已有科研环境。全部依赖快照在本地 `reports/ocr-environment.txt`。

PaddleX 的依赖检查只识别 GUI 发行包名，需要一次可追溯的兼容适配：

```sh
/data/lvjiawen/baselines/envs/ocr-runtime/bin/python scripts/image-validation/prepare_headless_paddlex.py \
  --report tmp/image-workspace/reports/ocr-headless-compatibility.json
```

该脚本只接受已验证版本和预期源码结构，仅增加同版本 headless 包名识别；保留其他依赖检查。修改前后哈希写入报告，重复执行不重复修改。

```sh
/data/lvjiawen/baselines/envs/ocr-runtime/bin/python scripts/image-validation/smoke_ocr.py \
  --weights /data/lvjiawen/baselines/ocr/weights \
  --image /path/to/research-receipt.jpg \
  --output tmp/image-workspace/reports/ocr-smoke.json
```

可重复传 `--image`。CPU 运行、4 线程、关闭额外方向/矫正模型；EXIF 方向统一后输出像素坐标。每个文字区域保存当前图片上的可见原值、四边形、OCR 识别分数与来源哈希。尚未实现坐标回映到未旋转原文件或业务字段修订。OCR 分数不表示伪造概率。

## MIRROR

源码必须是官方固定提交 `7f108fdd5c132e205df6f24954045cc9ba533361`，环境按其依赖使用 torch 2.6.0、torchvision 0.21.0、transformers 4.57.1、peft 0.21.2、timm 1.0.30。完整 Phase2 包含底座、LoRA、记忆和分类参数，能否使用以完整文件严格加载为准。

`prepare_mirror_backbone.py` 从 Phase2 的 HF 格式参数中导出底座初始化文件，保留检测器加载时单独恢复 LoRA；这不是原始 DINO 预训练权重的替代发布物，也不修改已有原始 pth。它使用安全张量加载，仅额外允许已静态检查的 argparse.Namespace 元数据类型，不回退到无限制 pickle。

```sh
/data/lvjiawen/baselines/envs/mirror-runtime/bin/python scripts/image-validation/prepare_mirror_backbone.py \
  --checkpoint /data/lvjiawen/baselines/mirror/weights/checkpoint-h-cur.pth \
  --ledger tmp/image-workspace/reports/mirror-phase2-download.json \
  --output /data/lvjiawen/baselines/mirror/weights/backbone-from-phase2 \
  --report tmp/image-workspace/reports/mirror-backbone-preparation.json

/data/lvjiawen/baselines/envs/mirror-runtime/bin/python scripts/image-validation/smoke_mirror.py \
  --code /data/lvjiawen/baselines/mirror/code \
  --checkpoint /data/lvjiawen/baselines/mirror/weights/checkpoint-h-cur.pth \
  --ledger tmp/image-workspace/reports/mirror-phase2-download.json \
  --backbone /data/lvjiawen/baselines/mirror/weights/backbone-from-phase2 \
  --manifest tmp/image-workspace/reports/mirror-smoke-manifest.json \
  --output tmp/image-workspace/reports/mirror-smoke.json --gpu 3
```

清单为 JSON 数组，每项有 `sample_id`、`path`，可附 `label`、`dataset`、标签来源；故意损坏文件标记 `expected_error: true`。测试沿用官方短边大于 512 时缩小、224 中心裁剪、PNG/BMP/TIFF 转 JPEG96 的处理，归一化在模型内部执行。单独记录其截断图片默认宽松行为的调整：本脚本拒绝截断图片。该科研评测预处理不等于已经决定产品的整图/分块策略。

## DocShield

专用环境使用 transformers 5.13.0、qwen-vl-utils、accelerate 与支持该架构的 PyTorch。运行前要求完整固定版本资产账本，并重新核对文件 SHA-256；仅暴露一张 GPU，默认物理 GPU 3，低显存时不自动跨卡。

```sh
/data/lvjiawen/baselines/envs/docshield-runtime/bin/python scripts/image-validation/smoke_docshield.py \
  --weights /data/lvjiawen/baselines/docshield-9b/weights \
  --ledger tmp/image-workspace/reports/docshield-download.json \
  --image /path/to/research-receipt.jpg \
  --output tmp/image-workspace/reports/docshield-smoke.json --gpu 3
```

默认使用发布者中文提示词、BF16、贪心解码和 1,024 个生成 token，图像限制为约 1M 像素，记录实际视觉输入尺寸。`--prompt-file` 用于后续可追溯的输出格式对照。保留原始输出和截断标记；在实际坐标空间验证前不将任意数字数组直接框到原图。生成评分不是经校准的伪造概率，更不是 OCR 识别分数。

## 票据协作与局部复核

`smoke_docshield.py --ocr-report` 为每张图匹配其独立 OCR 证据、绑定摘要，使用视觉观察专用提示词。它与 `--prompt-file` 互斥；原始直接推理方式仍保留。

额外指定 `--rule-guided` 可将规则选中的局部裁剪与原图一并输入；规则判定仅记录在程序侧，不作为模型视觉判断的依据。初轮上下文回显失败及精简后结果都保留在研究报告中，不宣称已经解决视觉漏检。

```sh
python3 scripts/image-validation/receipt_evidence.py \
  --ocr-report tmp/image-workspace/reports/ocr-evidence-v2.json \
  --model-report tmp/image-workspace/reports/docshield-visual-evidence-v3.json \
  --output tmp/image-workspace/reports/receipt-fusion-v3.json

/data/lvjiawen/baselines/envs/ocr-runtime/bin/python scripts/image-validation/retry_ocr_regions.py \
  --ocr-report tmp/image-workspace/reports/ocr-evidence-v2.json \
  --image /path/to/the-same-receipt.jpg --region-id ocr-72 \
  --weights /data/lvjiawen/baselines/ocr/weights \
  --output tmp/image-workspace/reports/ocr-crop-reread.json
```

局部复核须使用包含 `model_asset_sha256` 的 OCR 报告；旧报告缺少指纹时重新采集，不绕过验证。融合输出区分视觉待复核项、内容规则和局部复核请求。具体规则、实验阈值和未实现范围见[协作方案](../../docs/image-workstream/receipt-fusion.md)。

## 自检

```sh
/data/lvjiawen/baselines/envs/image-download/bin/python -m unittest discover \
  -s scripts/image-validation -p 'test_*.py' -v
python3 -m compileall -q scripts/image-validation
```

资产账本、依赖快照、真实推理输出与失败日志分别保存。只有文件下载不代表模型可用，只有单图推理不代表业务验收通过。按照用户要求，当前不执行 commit、push 或合并。

## 本轮规模评估与 PDF

- `prepare_scale_evaluation.py` 冻结 MIRROR 900 张和 DocShield 60 张诊断清单；`smoke_mirror.py` / `smoke_docshield.py` 支持 `--image-manifest`，核对输入哈希。
- `evaluate_results.py` 用固定清单统计误报/漏报、失败分母、截断、MIRROR 排序指标和分组结果。DocShield 不把训练相关样本称独立精度。
- `prepare_cord_evaluation.py` 从通过发布者 SHA256 校验的 CORD test Parquet 冻结全部 100 张；`smoke_ocr.py --image-manifest` 推理，`evaluate_cord.py --directory <cord目录>` 输出带位置的标注文字可找回率。它不是语义字段抽取准确率。
- `pdf_to_evidence.py` 调用场景内 PDF 核心和真实 OCR；`evaluate_pdf_scale.py` 验证 16 份/64 页受控样本。环境为 `ocr-runtime`，需 pypdfium2、Pillow；受控样本生成额外使用 pypdf。
- Node 核心验证：`node --test tests/image-documents-batch.test.mjs tests/image-documents-catalog.test.mjs tests/image-documents-dates.test.mjs`。
- PDF 验证：`/data/lvjiawen/baselines/envs/ocr-runtime/bin/python -m unittest discover -s scripts/image-validation -p 'test_pdf*.py'`。下载环境没有 PDF 依赖时会明确跳过 PDF 渲染用例，不能据此称其通过。

复现协议、数据限制、结果见[规模评估](../../docs/image-workstream/scale-evaluation.md)与[数据清单](../../docs/image-workstream/dataset-inventory.md)。不要覆盖原报告后仍沿用旧 manifest 或旧实验结论。

## SEED 对照

`evaluate_seed.py` 输出本地概率图/mask/区域；`summarize_seed.py` 生成同样本指标和本地评审页；`explain_seed.py` 显式选择最多3张、默认 dry-run，加 `--send` 才按本地开关发送白名单摘要。见[SEED 接入](../../docs/image-workstream/seed-integration.md)。测试使用独立 seed-runtime：`python -m unittest discover -s scripts/image-validation -p test_seed_adapter.py`。
