# 整图检测、人像伪造与生成来源分析交付

日期：2026-11-05。代码在本团队集成工作区，未提交或推送 Git；没有更新远端正式服务器。

## 本机可用功能

通用图片工作台继续以 DDA H+ 整图 AIGC 检测为主，在同一图片结果下增加两块辅助分析：

- **人像细节 / 人像伪造分析**：VLAForge + YuNet，展示接受分析的人脸位置与逐脸得分。未检出人脸显示不适用，模型失败显示未完成。框选的是人脸，不是精确修改像素，也不覆盖任意非人脸篡改。
- **生成脉络 / 生成来源分析**：RPA OpenFake27，展示有限标签集中的 top-3 候选，不输出确定来源。整图没有明显生成信号时保留归属；JPEG/WebP 的参考候选默认折叠，明确显示“来源待核验”。

三个模型共享一个图片任务与 JSON 导出，使用独立结果字段；没有融合成一个参数模型，也没有把不同任务的分数平均。当前单卡顺序计算，保留既有 GPU 选择、排队和原整图分类流程。任一辅助分支失败不改写主分类结果。

当前本机预览：`http://127.0.0.1:4186/#/image/general`。远程浏览时需要转发服务器 4186 端口。

## 真实测试结果

以下全部由本机 RTX A6000 实际推理获得。数据量较小，人脸检出阈值也在这批工程样本上调整过，不能将这些数字作为独立泛化或正式论文复现结果。

| 模块 | 测试范围 | 实测 |
|---|---|---|
| 整图 DDA H+ | OpenFake v1 官方 test 首个行组，81 张真实、97 张生成 | AUC **98.75%**；阈值 .5 的准确率 **93.26%**，混淆矩阵 TN=74、FP=7、FN=5、TP=92 |
| 人脸 VLAForge | DeepFakeFace 40 组配对真实/换脸/局部重绘，共 120 张 | 107 张检出可分析人脸，覆盖率 **89.17%**；在这 107 张上 AUC **93.74%**、准确率 **83.18%**；13 张未覆盖单列 |
| RPA OpenFake27 | 官方原始 test 图中受支持的 87 张生成图，覆盖 26 个已知标签 | Top-1 **96.55%**，Top-3 **100%**；其余 81 张真实与 10 张不受支持来源不混入已知类准确率 |
| RPA DRAGON25 | 官方 test 的 25 类平衡子集，每类 5 张，共 125 张 | Top-1 **95.20%**，Top-3 **99.20%** |
| RPA 压缩对照 | 同一批 87 张已知来源原图，保持尺寸，Pillow JPEG Q95 默认色度采样重压 | Top-1 从 **96.55% 降至 12.64%**，说明发布的干净图权重不适合无条件归因转存图片 |

人脸子类需分别看：换脸 36/40 张可评分，其中 33 张分类正确；真实图 36/40 张可评分，其中 33 张正确；局部人脸重绘 35/40 张可评分，其中 23 张正确。局部重绘识别仍弱，不能由整体 AUC 推断其已解决。数据没有像素 mask，本轮没有计算像素定位 IoU/F1。

人脸检出器从 .9 调至 .8，保留最小 50px 与原几何过滤；伪造评分阈值仍为 .5。调整前的覆盖率为 83/120，原结果单独保存，没有删除未检出样本。

另复用已有公开 OpenFake JPEG 整理集的 99 张图片作对照：其中 Midjourney-7 的 20 张图 top-1 / top-3 均为 0；79 张是当前权重不支持的来源。该整理集确切编码历史与上游版本未独立确认，因此另做上述同图压缩实验核对，不能将这 20 张的失败直接解释为任意 Midjourney 原图都无法识别。

当前 `sourceVerdict` 始终为空；softmax 仅作为候选匹配分数。真实图和未知来源也可能得到高分，未实现可靠的开放集拒识。依据本次实测，对压缩输入保留候选参考而不直接确认归属。

## 已下载资产与版本

工作区根目录：`/sdb/data_public/lvjiawen/aigc_platform`。

| 资产 | 本机位置 | 来源 / 固定版本 |
|---|---|---|
| VLAForge 完整源码 | `third_party/vlaforge/` | [官方仓库](https://github.com/mala-lab/VLAForge)，`5ec3b2b4333a8b4140b1d5de18f80faae0789813` |
| RPA 完整源码 | `third_party/rpa/` | [官方仓库](https://github.com/Asaf-Livne/raw-patch-attribution)，`c1d3171a072ac1c2c75f7c838ee72b2e56e45ad7` |
| VLAForge 权重 | `weights/vlaforge/model.pth`，965,834,563 字节 | [官方文件](https://drive.google.com/file/d/1_PhtirGA_vMZWqnpZHGHHinT6QKF1d4L/view) |
| YuNet | `weights/vlaforge/face_detection_yunet.onnx`，232,589 字节 | [OpenCV Zoo](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet) |
| RPA OpenFake27 | `weights/rpa/openfake_27class.pt`，23,776,175 字节 | [官方 release](https://github.com/Asaf-Livne/raw-patch-attribution/releases/download/v1.0/openfake_27class.pt) |
| RPA DRAGON25 | `weights/rpa/dragon_25class.pt`，23,767,793 字节 | [官方 release](https://github.com/Asaf-Livne/raw-patch-attribution/releases/download/v1.0/dragon_25class.pt) |

四个资产的 SHA-256 均核验通过，完整清单在 `runtime/research/forensics-20261105/assets.json`：

```text
2bc0c1e33d08a241386f88e3a9bc0ee4a504def129be0b4a9197b33f6feaff1f  model.pth
8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4  face_detection_yunet.onnx
bb6a7b3cb50368f0f8ebabb6910a12bfc9afe4a4ef0ab034ff07c70a61f605a3  openfake_27class.pt
f0ad2cf5d3a5af1a94d72b66d7341e6d9886cb29091e4ed744799eecbb6c4e22  dragon_25class.pt
```

官方 VLAForge 在 `forward` 中的 `.squeeze()` 会在单人脸输入时移除批维度，导致 softmax 维度错误。已应用 [单图兼容补丁](../../scripts/image-validation/vlaforge-single-image.patch)，改为 `.reshape(-1, 2)`，不改变模型参数。源码中的 `UPSTREAM.json` 记录原版本和本地补丁。现有视频引擎增加可选源码路径，默认视频配置保持兼容。

RPA 按 checkpoint 的 class_names、64px patch、通道均值/方差和官方 logit_avg 聚合，不缩放图片后冒充原始取证。当前来源分支短边至少 64px，总面积不超过 4096²，超限明确不适用。

## 测试集与数据位置

按用户允许的备选方案保存在本项目 `datasets/forensics-20261105/`，没有写入其他人的数据目录。每组都有 `manifest.json` 和 `provenance.json`，记录原始来源、固定 revision、选样方法、标签、文件 SHA-256 和大小。

| 目录 | 内容 | 实际图像字节 |
|---|---|---:|
| `deepfakeface/` | [OpenRL/DeepFakeFace](https://huggingface.co/datasets/OpenRL/DeepFakeFace)，40 组配对，真实/InsightFace 换脸/SD 局部重绘，共 120 张 | 4,897,208 |
| `dragon/` | [lesc-unifi/dragon](https://huggingface.co/datasets/lesc-unifi/dragon)，官方 test 分片 00/02/04/06/08 各取首批 25 张，覆盖 25 类、5 个 prompt，共 125 张 | 152,998,584 |
| `openfake-original/` | [ComplexDataLab/OpenFake v1](https://huggingface.co/datasets/ComplexDataLab/OpenFake/tree/v1.0)，test 首行组 178 张，保存嵌入的原始图像字节 | 106,061,806 |
| `openfake-local/` | 复用公共数据盘既有 JPEG 整理集，按固定 seed 每来源至多 20 张，共 99 张；原编码历史未验证 | 14,764,768 |

新下载的 423 张原始图约 252 MiB，加上 JPEG 整理对照约 266 MiB。未下载完整数 TB 的 OpenFake 或完整多 GB 的 DeepFakeFace。DeepFakeFace 通过 ZIP 范围读取，OpenFake 通过 Parquet 行组读取，选中图片没有被缩放或重新编码。JPEG 对照仅在内存中生成，不覆盖原图。

数据许可按上游卡执行，DRAGON 为 CC-BY-SA-4.0；DeepFakeFace 真实人像另受原始 IMDB-WIKI 来源条款约束；OpenFake 包含非商业限制。当前数据用于本地研究和测试。

## 本机运行与复跑

当前环境入口为 `runtime/envs/forensics-runtime/bin/python`。它通过 `.pth` 共享已有 mirror-runtime 基础包，增量安装 einops / gdown；迁移时两个环境都需保留，不能只复制入口目录。

实际验证版本：Python3.10、torch2.6.0+cu124、torchvision0.21.0+cu124、numpy1.26.4、timm1.0.30、opencv4.11.0、scikit-learn1.5.2、einops0.8.1、Pillow12.3.0、ftfy6.3.1。版本记录在 `runtime/research/forensics-20261105/environment.json`。普通沙箱内无法访问 NVIDIA 驱动；本次实际 GPU 验证在本机执行环境完成。

预览已在 4186 运行。下列命令供后续重启使用：

```bash
cd /sdb/data_public/lvjiawen/aigc_platform/collaboration/team-image-integration-20261102
export AIGC_PLATFORM_ROOT=/sdb/data_public/lvjiawen/aigc_platform
export AIGC_FORENSICS_PYTHON="$AIGC_PLATFORM_ROOT/runtime/envs/forensics-runtime/bin/python"
npm run build
HOST=127.0.0.1 PORT=4186 PROXY_BACKEND=0 npm start
```

独立复跑两条辅助分支（从工作区根目录执行，manifest 行含 id/path，可选 score）：

```bash
runtime/envs/forensics-runtime/bin/python \
  collaboration/team-image-integration-20261102/src/modules/image/general/forensics.py \
  --root "$PWD" --manifest /absolute/path/manifest.json \
  --output runtime/replay/manual-forensics.json --device cuda:2
```

评测脚本 [evaluate-forensics.py](../../scripts/image-validation/evaluate-forensics.py) 支持四项复跑；下例中的显卡编号需根据当前空闲资源选择：

```bash
cd /sdb/data_public/lvjiawen/aigc_platform
export FORENSICS_EVAL=collaboration/team-image-integration-20261102/scripts/image-validation/evaluate-forensics.py
for module in whole face source jpeg; do
  runtime/envs/forensics-runtime/bin/python "$FORENSICS_EVAL" \
    --root "$PWD" --datasets datasets/forensics-20261105 \
    --output runtime/replay/forensics-20261105 --device cuda:2 --module "$module"
done
```

数据下载脚本为 [download-forensics-testsets.py](../../scripts/image-validation/download-forensics-testsets.py)，`--dataset both` 下载人脸与 DRAGON 子集，`--dataset openfake` 下载原始 OpenFake 行组；后者使用已安装 pyarrow 的 `runtime/envs/image-download/bin/python`。既有清单在本机，不必重复下载。

源代码入口：[模型适配](../../src/modules/image/general/forensics.py)、[辅助卡片](../../src/modules/image/general/forensics-view.js)、[整图分析](../../src/modules/image/general/analyze.py)、[队列服务](../../src/modules/image/general/service.js)。结果新增 `forensics.face` / `forensics.source`，保留原 score / verdict / diagnostics / spatial。

## 验收与证据

详细逐图预测、汇总与原阈值对照：`runtime/replay/forensics-20261105/`。下载、环境、日志与权重账本：`runtime/research/forensics-20261105/`。

真实浏览器验收使用本机 Chrome，没有拦截或伪造模型 API，上传换脸 JPEG、DRAGON PNG、同图重压 JPEG，验证主结果、逐脸框选、来源候选、压缩默认折叠，以及 1440px 桌面和 390px 手机布局。验收记录和完整 API 响应在 `runtime/replay/forensics-20261105/browser/`。

最终 check / build 通过，512 项 Node 测试全部通过，5 个 Python 文件语法检查通过，固定 OpenSpec 1.13.1 的 11 项严格校验全部通过。423 张新下载原图及 99 张整理对照的逐文件哈希复核通过；最终验证账本在 `runtime/research/forensics-20261105/validation-final.json`。

- [人像与来源卡片](../screenshots/image-forensics-face-desktop.png)
- [桌面整图结果](../screenshots/image-forensics-source-desktop.png)
- [移动端辅助模块](../screenshots/image-forensics-source-mobile.png)
- [压缩候选参考](../screenshots/image-forensics-compressed-reference.png)

模型权重与数据留在工作区资产目录，不加入 Git；前端静态构建不会打包 Python、权重或数据集。当前结果是实际可运行的三分支系统，仍保留人脸重绘较弱、非人脸定位未覆盖、压缩归因较弱、未知来源未校准等明确限制。

## 用户指定 DDA-COCO FLUX 的追加核验

用户指出实际使用的是官方 DDA-COCO 的 FLUX 数据。因此不能将失败归因于用户截图或转存，也不能用 OpenFake/DRAGON 的同域结果代替该场景验收。

已完成两项来源核对：

- 本地 `DDA-COCO.zip` 为 4,301,452,066 字节，SHA-256 为 `8cd600779aaecef21605b07bff9ab3963a7fb9b9614a3d9a0588cd4a5e099c24`，与作者 Hugging Face 发布的 LFS 哈希完全一致。
- 匹配到用户工作台中 4 次 FLUX 上传，均与该数据集对应文件字节一致；不是上传时额外压缩。核对记录在 `runtime/research/forensics-20261105/ddacoco-archive-audit.json` 与 `ddacoco-upload-audit.json`。

对官方包 `DDA-COCO/FLUX.1/val2017` 的 **4971 张全部原文件**，使用生产分支相同的 RGB 解码、归一化、64px patch 和 logit_avg 聚合，分别运行两个发布权重；均完成 4971 张，无推理失败，没有调整类别或训练模型。

| 权重 | Top-1 为任一 FLUX 标签 | Top-3 包含任一 FLUX 标签 | 主要错误 |
|---|---:|---:|---|
| 页面使用的 OpenFake27 | **20/4971，0.402%** | 837/4971，16.838% | 3117 张判为 gpt-image-1，1802 张判为 imagen-4-0 |
| DRAGON25 | **17/4971，0.342%** | 1502/4971，30.215% | 4903 张判为 IF |

这是单一来源子集的 **FLUX 家族召回率**，不能称为完整多类别准确率，也没有把 `FLUX.1` 文件夹标签进一步猜成 dev/pro/schnell 的具体版本。OpenFake27 有 2519 张、DRAGON25 有 4741 张以大于 .95 的最高 softmax 归到了错误家族，进一步说明匹配高分不可信。

作者对 [DDA-COCO 的说明](https://arxiv.org/html/2505.14359#S4.SS1)是 COCO 验证图经不同 VAE 重建并做频域对齐；这与普通文生图的生成流程不同。官方包本身就是 JPEG，所以官方原文件与无损容器/无后处理不是一回事。但本轮无法把失败单独归因于 JPEG、VAE 重建或频域对齐中的某一因素，不能省略这个因果边界。无损转存 PNG 的 RGB 完全相同，改成 PNG 容器不会恢复缺失特征。

结论：当前两个 RPA 发布权重均未通过用户的 DDA-COCO FLUX 场景验收。OpenFake27 的原图 96.55% 和 DRAGON25 的同域 95.20% 不应被用来说明这一场景可用；简单换到另一套权重也未解决。后续方法应把此跨流程场景纳入验收，并与普通 FLUX 文生图、统一编码后的不同家族样本一起评测，不能只报告闭集原图成绩。

可复跑脚本：[evaluate-ddacoco-attribution.py](../../scripts/image-validation/evaluate-ddacoco-attribution.py)。完整逐图预测和汇总在 `runtime/replay/ddacoco-attribution-20261105/`，没有修改任何官方数据文件。

```bash
cd /sdb/data_public/lvjiawen/aigc_platform
runtime/envs/forensics-runtime/bin/python \
  collaboration/team-image-integration-20261102/scripts/image-validation/evaluate-ddacoco-attribution.py \
  --root "$PWD" \
  --dataset /sdb/data_public/weiwenfei_datasets/DDA-COCO/DDA-COCO \
  --output runtime/replay/ddacoco-attribution-20261105 --device cuda:3
```

## 商业成图平台来源：文件证据与水印调研（2026-11-05）

面向豆包、千问、ChatGPT、Gemini 成图，建议把来源分析改为“文件证据优先，厂商水印验证补充，模型候选兜底”。文件标识可以提供平台/制作方/传播方线索，但不保证能识别具体生成器版本；元数据缺失不能判定真实。以下为官方公开能力，未把网站可用等同于接口已经获得权限。

| 对象 | 已核实的官方说明 | 本平台可用路径与边界 |
| --- | --- | --- |
| 豆包应用 | [用户协议 6.4](https://www.doubao.com/legal/terms)说明显式标识和文件元数据隐式标识 | 优先读取下载原文件的 AIGC JSON、TC260 XMP；尚未取得代表性的豆包原文件样本，不能承诺覆盖率。 |
| 火山方舟 / Seedream API | [隐式水印文档](https://console.volcengine.com/ark/region:cn-beijing/docs/add-invisible-watermark-to-ai-generated-content)公开 Label、ContentProducer、ContentPropagator 等字段；需在推理点开启并配置主体 | 可本地解析。ContentProducer 可能是 API 客户的主体，不能自动等同于豆包或 Seedream 版本；传播方也不能当生成方。 |
| 火山 AI MediaKit | [暗水印提取 API](https://docs.volcengine.com/docs/Intelligentprocessing/submit-image-invisible-watermark-extraction-task-api?lang=en)只保证提取对应添加 API 嵌入的水印，并要求同一 tool_version | 有鉴权 API，路径 `/api/v1/tools-sync/extract-image-invisible-watermark`；缺少它与豆包消费端暗水印兼容的证据。不能宣传为“豆包万能验水印”。 |
| 千问应用 | [官方协议第八条](https://terms.alicdn.com/legal-agreement/terms/c_end_product_protocol/20231011201348415/20231011201348415.html)说明默认显式与文件元数据隐式标识 | 可本地读取声明。千问应用、云 API、自部署 Qwen-Image 是不同输出链路；[开源模型仓库](https://github.com/QwenLM/Qwen-Image)并不能证明所有衍生成图都会有同一水印。 |
| 阿里云检测服务 | [aigcDetectorFull](https://help.aliyun.com/en/document_detail/2672918.html)可检查隐式标识并返回 AIGC 元数据，调用时设置 `infoType=aigcData` | 可作为有账号后的交叉验证；这是元数据检查加模型鉴别，不是已经证明能解任意千问像素水印的接口。 |
| OpenAI / ChatGPT | [Content Provenance API](https://developers.openai.com/api/docs/guides/content-provenance)检查支持的 C2PA 与 SynthID 信号 | 本地用 C2PA 工具；厂商验证用 `POST /v1/content_provenance_checks`，multipart `file` 和 Bearer key。权限不足可能返回 404，限流 429；还没有用本项目账号实际调用。模型/时间可为空，检测不到不能排除 AI。 |
| Google / Gemini | [Nano Banana 2 官方说明](https://blog.google/innovation-and-ai/technology/ai/nano-banana-2/)说明 SynthID 与 C2PA；[SynthID 官网](https://deepmind.google/models/synthid/)提供公开验证站点 | C2PA 可本地检查；[Google Cloud 官方说明](https://cloud.google.com/security/compliance/ai-trust-and-transparency)的 AI Content Detection API 当前仍为 private preview，不能当成已获开放接口。SynthID 支持合作伙伴，检测到 SynthID 本身不等于必然来自 Google。 |

### 推荐实现顺序

1. 保留原始上传字节和 SHA256，在任何重编码、裁剪、EXIF 旋转前读取文件记录。读取失败、没有记录、格式不支持、存在未签名声明、凭证有效但不受信任、凭证受信任、凭证无效分别记录。
2. 使用 [c2pa-rs / c2patool](https://github.com/contentauth/c2pa-rs)验证内容绑定、签名、证书、时间戳和编辑/素材链。生产环境需维护官方信任列表与更新策略。`Valid` 不等于 `Trusted`；claim generator 是写凭证的软件，issuer 是签名者，均不能单独推断生成模型。后续编辑软件的活动凭证不能覆盖掉前序生成线索。
3. 国内图片读取 AIGC 元数据，展示生成方、传播方和编号；在没有验证保护字段、签名或厂商回查前，只作为声明。不要对未知主体编码做猜测映射，也不要将普通 prompt/文件名里的平台关键词当作来源。
4. OpenAI 官方来源 API、Google 私有预览 API 作为可选服务适配，分别保留 `detected/not_detected/not_checked/error`。没有开通的检查显示“未检查”，不能显示“无水印”。当前没有自动将用户图片发送给这些厂商。
5. 可见标识可用现有 OCR 作为弱线索；带“AI生成”四字不识别具体平台，平台 Logo 也能被复制。RPA 保留为实验候选参考，不能盖过已验证的来源证据，也不能在缺少水印时强制选平台。

[Stable Signature](https://github.com/facebookresearch/stable_signature)等公开水印算法适合对自有生成流程先嵌入再验证。可下载检测器不意味着能读取其他厂商的私有水印；不要把不同水印系统混成通用解码器。Google 的公开 SynthID-Text 代码是文本方向，同样不能用来解图片。

### 本次落地与验证范围

新增 `src/modules/image/general/file_source.py`，读取 PNG 文本、JPEG COM/APP1、EXIF 描述、WebP XMP 中支持的 AIGC 声明，保留生成方/传播方区别、冲突和读取问题；对未签名声明始终 `sourceVerdict=null`。页面“文件来源线索”在模型候选前展示，并独立于整图是否判 AI，不会因为 DDA 阴性而隐藏文件证据。像素水印状态明确为“未检查”。目前并非完整国标认证实现：不含主体编码注册表、ReservedCode 验签、所有厂商私有 EXIF 变体。

验证数据与记录位于根目录 `datasets/provenance-20261105/` 和 `runtime/research/provenance-trufor-20261105/`：

- 人工构造的 unsigned-test.png 只验证解析与页面，不冒充真实豆包原图；7 个 Python 测试覆盖 PNG/JPEG/WebP、EXIF、冲突、XML 实体拒绝和元数据移除。
- [contentauth 公开 ChatGPT 样例](https://github.com/contentauth/example-assets/blob/main/images/ChatGPT_Image.png)下载后记录仓库 revision 与 SHA256。本机旧验证器可读到 OpenAI 签发者，但报告过期与不受信任，页面保留失败状态，不宣称验证成功。
- AIGI-Now 的 semantic/1_fake 中即梦、GPT-4o、Nano 各取字典序前 20 张，共 60 张，没有读到支持的 AIGC 声明。这是文件检查结果，既不是 60 张全部没有 C2PA/像素水印，也不是平台原始下载文件的覆盖率评估。

后续平台测试应按“平台 × 模型/时间 × App/Web/API 下载路径”分层收集原文件，再对同图做截图、压缩、转存对照。分别报告来源证据覆盖率、可验证率、正确归属率、未知拒绝率；不能只报有标识样本上的命中率。豆包优先至少收集 App 与网页各一批原图，避免只用实验室生成器数据集替代真实用户场景。

## TruFor 局部篡改检测与定位接入

用户确认原称“tursor”为 [TruFor](https://github.com/grip-unina/TruFor)。本次使用官方阶段三权重和提交 `ae54475df6f41a491d7615100feb19263dec13f7` 的推理代码，下载 111 个源码及示例文件；未下载四份大训练样本清单和训练初始化用 SegFormer 权重。正式推理权重本身完整，包含全部推理模块。

- 权重：根目录 `weights/trufor/trufor.pth.tar`，281,496,429 字节。
- [作者权重 ZIP](https://www.grip.unina.it/download/prog/TruFor/TruFor_weights.zip) MD5 `7bee48f3476c75616c3c5721ab256ff8` 与作者公布值一致。
- 解压权重 SHA256 `ac1d90e329a72e0d66e8665e123a19e94bfae3209c3ef8a4f9ca3b91578c7844`，适配器加载时强制核对。
- 新增依赖 `yacs==0.1.8`。PyTorch 2.6 安全加载需允许官方权重中的 NumPy 标量类型，保留 `weights_only=True`。
- `src/modules/image/general/tamper.py` 使用 RGB `/256`、作者内部 ImageNet 标准化、FP32、eval，输出原始异常 softmax 图、sigmoid 置信度图和图像级检测分数。
- 网页长边超过 1024 时等比例缩小并显示提示；不裁掉边缘，可能损失小修改线索。短边不足 64 时标为不适用。原始异常和置信度用固定 0–1 色标，叠加图透明度结合二者，避免把每张图的最大响应都染成高异常。
- 人像、RPA、TruFor 分支独立失败隔离，整图 DDA 主分类不取平均、不被改写。

### 数值对齐与工程运行

在作者 `tampered2.png` 上直接运行原始 `TruFor_train_test/test.py`，与适配器比较：分数、异常图、置信度图最大差值全部为 **0**；分数 `0.9983462095`。记录位于根目录 `runtime/replay/trufor-20261105/parity/comparison.json`。

两张官方大图分别从 2048×1773、2048×1536 缩至 1024×887、1024×768，成功运行，分数约 0.1120、0.6946；单独 TruFor 的 CUDA 峰值分配约 2722 MB。此数值不代表全部平台模型总显存。

### 真实掩膜子集效果

从[作者 CocoGlide ZIP](https://www.grip.unina.it/download/prog/TruFor/CocoGlide.zip)按共同 COCO ID 排序后使用随机种子 20261105 选取 40 对，保存原图 40、GLIDE 局部编辑图 40、掩膜 40；原始字节不转码，全部 SHA256 校验。总计约 9.56 MB，图片均 256×256，无推理缩放。

| 指标 | 本机实测 |
| --- | ---: |
| 检测 AUC | 0.805625 |
| 检测准确率，阈值 0.5 | 65.0% |
| 真实图正确 / 误报 | 38 / 2 |
| 篡改图检出 / 漏检 | 14 / 26 |
| 40 张篡改图平均像素 F1 | 0.379562 |
| 平均像素 IoU | 0.302318 |
| 模型加载 | 约 3.99 秒 |
| 256×256 平均推理 | 约 0.098 秒 |

定位指标采用原始异常图阈值 0.5，未根据真值选择反转，未去掉边界；因此不能与作者使用反转取优、边界排除的部分论文指标直接比较。没有在该子集上调阈值。该结果说明模型能提供辅助局部定位，但默认阈值漏检较多，不能声称可靠覆盖现代商业平台局部编辑，更不能把热图当作真实掩膜。

数据目录：根目录 `datasets/provenance-20261105/cocoglide/`；逐图分数、预测图数组和汇总：`runtime/replay/trufor-20261105/cocoglide/`。下载和复测脚本位于 `scripts/image-validation/download-trufor.py`、`download-cocoglide-subset.py`、`evaluate-trufor.py`。

TruFor 作者许可为信息/非营利用途；本轮课题原型接入不意味着获得商业运营授权。原许可保留在根目录 `third_party/trufor/test_docker/LICENSE.txt`。


### 最终验收

- 514 项 Node 测试、7 项文件元数据 Python 测试通过；OpenSpec 严格校验 11 项通过，静态检查与构建通过。
- 真实浏览器通过 3 张上传：人工未签名声明、公开 ChatGPT 凭证样例、官方 TruFor 篡改图。四个模型分支、文件证据及桌面/390 像素移动布局通过，未拦截或伪造 API。记录在根目录 `runtime/research/provenance-trufor-20261105/browser/`。
- 4186 维持原入口 `http://127.0.0.1:4186/#/image/general`（浏览器侧需正确转发远端端口）。服务进程使用空闲显存门槛 12000 MB、单进程分配上限 10000 MB，并继续动态选卡与排队。本轮受限测试成功，GPU 更忙时仍可能排队。
- Google、OpenAI、火山、阿里云外部验证接口均没有冒充已接通；当前本地文件解析与 C2PA 分支可运行，厂商像素水印验证需对应账号权限和后续接入。


## 2026-11-06：常用平台元数据检查

整图检测 `diagnostics.providerChecks` 新增豆包、千问 / Qwen、OpenAI / ChatGPT 三项本地检查，前端“文件来源线索”逐项显示。PNG AIGC、JPEG / WebP XMP、EXIF 来源声明复用统一读取器，并增加 EXIF Unicode UserComment 解码。只在来源字段做精确产品别名匹配，不搜索提示词、文件名或像素；传播方不冒充生成方。未知公司名或服务提供者编码保留原值，尚无经核验的编码注册表，不猜测对应平台。所有未签名声明均为身份未核验，不能充当可靠平台鉴定。

OpenAI 本地 C2PA 签发者字段与凭证状态单独显示；无论信任状态如何，签发者本身不能证明 AI 生成行为或区分 ChatGPT / API。本次未增加在线上传，未配置或调用 Content Provenance API，也未实施 SynthID 像素水印检测。三个本地检查都不需要登录。若启用 OpenAI 官方在线验证，需要服务端 API key 及相应组织权限，普通 ChatGPT 登录或订阅不能替代；不应把密钥发在聊天中。

官方依据：[豆包协议 6.4](https://www.doubao.com/legal/terms)、[千问用户服务协议](https://terms.alicdn.com/legal-agreement/terms/c_end_product_protocol/20231011201348415/20231011201348415.html)、[OpenAI Content Provenance API](https://developers.openai.com/api/docs/guides/content-provenance)。协议说明支持元数据标识，不代表所有历史图片、导出路径或重编码文件都有完整标识。

验证采用真实图像编码的人工字段夹具，覆盖平台别名、生成/传播角色、未知编码、伪造签发者与失败凭证。尚无经用户确认的豆包 / 千问官方直接下载原图，因此没有实际平台识别率结论；已有公开 ChatGPT C2PA 样本的过期证书仍显示验证失败。

本次验证：Python 元数据测试 10 项、前端相关测试 8 项通过；构建及 206 个 JS / 406 个本地文档链接检查通过。实际本地 ChatGPT 样本结果保存于 `runtime/research/provenance-trufor-20261105/provider-checks-20261106.json`，浏览器可访问 4186，并以实际解析结果验证三平台展示与无效凭证提示。整图端到端验收受空闲 GPU 调度等待影响，不能将单独元数据验证描述为全流程通过。


## 2026-11-06：上传与结果展示调整

单图限制统一为 20 MiB（前端、ZIP 解压、后端原始字节与 Base64 长度），批次 1000 MiB、ZIP 100 MiB 不变；HTTP 请求体原有 34 MiB 足以容纳编码后的单图。大 Base64 原来的重复分组正则会触发栈溢出，现改为字符集、长度与末尾填充分别检查。删除图片会清除当前上传提示，也提供提示关闭按钮。

结果导航改为普通文档流，预览改为白底，删除重复的纹理/边缘细节入口。更多鉴定细节使用“智鉴 · 让生成痕迹无所遁形”；文件来源核查改为可展开卡片，未发现凭证用绿色状态。篡改侦探采用放大镜图标，三列展示原图、异常叠加和异常程度，移除置信度图，增加与实际热图一致的蓝红色标。删除用户指定的开发说明及冗余脚注。

TruFor 新报告阈值由 0.5 降为 0.3，以降低漏检；图像分数、连续异常图与叠加公式不变。旧报告按其记录的阈值显示。已有 CocoGlide 80 张样本复算：0.5 的 TP/FN/FP/TN=14/26/2/38；0.3 为24/16/6/34。这是现有样本上的取舍记录，并非新域校准。

示例主体来自用户指定的“测试_doubao_2.jpg”，SHA-256 `5c4b8127806164c127c8b20e7d12a9a57d1c63b6ba4deeeae0f0376dcd58417d`。真实整图分数 0.9846780300140381，TruFor 分数 0.07997633516788483，XMP 中确实读取到 ContentProducer=doubao。原图保持原始 JPEG 清晰度，其他可视化来自同一次检测，不修改结果以迎合来源。

用户“豆包1”实测检出一张人脸，但 VLAForge 分数仅 0.005104874260723591；按用户许可，独立人脸示例改用 DeepfakeFace insight/0035.jpg，复测分数0.9999899864196777。失败案例保留于 `runtime/research/ui-revision-20261106/doubao-1-face.json`。示例重建脚本为 `scripts/image-validation/build-user-image-showcase.mjs`，资产哈希及分支来源保存在 `public/image-examples/doubao/provenance.json`。

验证：19 项相关 Node 测试通过，20 MiB 接受、超 1 字节拒绝；真实浏览器验证上传错误清除、20 MiB 图片本地预览、导航非吸顶、三图布局、卡片展开及手机无横向溢出。UI 验收明确使用保存的真实报告拦截 API，不向共享 GPU 队列增加测试任务；豆包2和人脸示例则单独进行了实际 GPU 推理，显存受限。构建与208个 JS/406个文档链接检查通过。

为保留用户的内存队列，未重启4186；新的20 MiB后端运行在4188。两者共用构建资产，4186后端仍是重启前的10 MiB限制，待原任务结束后方可切换旧端口服务。新版使用 `http://127.0.0.1:4188/#/image/general`（需转发4188）。


### 同日：结果卡片和来源详情气泡

示例汇总卡片居中排版，增加底色和 emoji；文件核查卡片点击后使用原生模态 dialog 展示详情，支持关闭按钮、Esc、点击背景关闭及焦点恢复，避免内联下拉拉长页面。检出的 AI / 平台声明标红；无记录保持绿色。人脸示例标题及行名称使用“人脸篡改示例”；信号按原始分数分档：低于0.2未见明显线索、0.2至0.5轻微伪造信号、大于0.5且低于0.8疑似人脸篡改、0.8至低于0.95高度疑似篡改、0.95及以上强烈伪造信号，对应绿/黄/橙/红/深红。这里只改变分档展示，未改变模型分数或声称概率校准。参考候选删除“未确认”后缀及底部候选归因框。

原文件重命名对照：将用户豆包2逐字节复制为 `/tmp/plain-photo-071.jpg`，文件哈希及解析结果一致，XMP 仍读取到 `Label=1`、`ContentProducer=doubao`、`ProduceID=2796d867252f41b4bd002f5b9449be03`。解析器输入为打开后的图像对象，不使用文件名推断平台。未对水印像素进行来源推测。


### 同日：共享 GPU 调度及轮询期间弹窗保持

GPU 选择允许利用率不超过95%（`AIGC_GPU_MAX_UTILIZATION`可配），优先较低利用率，其次较多剩余显存；4188继续使用12000 MiB空闲显存门槛、10000 MiB推理上限。将原4188排队任务保存至 `runtime/research/ui-revision-20261106/queue-resume-4188.json`，确认无运行任务后重载。新增恢复入口 `AIGC_GENERAL_RESUME_FILE`，通过原manifest核对输入ID，并保留jobId；已有完成结果直接复用。原任务 `fd8293e9-c5be-448e-a0b8-0c998ddcb88c` 已恢复并在GPU3启动，观测显存7888 MiB。

弹窗意外消失的原因是1.2秒状态轮询调用draw替换容器，而不是鼠标悬停事件。弹窗打开期间只更新内存状态，暂缓界面重绘，点击关闭后补绘；取消Esc/背景点击关闭，只保留关闭按钮。增加真实浏览器回归：排队到完成的多轮状态更新期间，移动鼠标、背景点击、Esc均不能关闭弹窗，点击关闭后完成状态正常显示。

删除示例可见副标题；汇总卡片标题/内容约18px，分母17px，手机布局纵向排列以保留字号；全图分析结果固定为“已完成全图 / 特征分析”两行。人脸结果名称和短语放到完整独立行，分数在下一行，避免单字换行。

内容凭证视觉更新：上方文件诊断和下方来源核查共用状态卡，图标与背景区分未发现、有效、可信及异常状态。详情气泡采用状态主卡、凭证记录/内容绑定/签发者信任三项卡片、签发者与写入工具字段、具体验证异常列表。未发现凭证显示后续验证未执行，不将缺失误画为验证通过；继续仅关闭按钮退出。


### 明确 AI 标识补充整图结论

对 `sourceDeclarations.records[].fields.Label=1` 的文件，主结果与AI筛选归为“AI 生成（文件标识）”，原模型结论另存 `modelVerdict`，依据为 `decisionBasis=file_declaration`。前后端保持一致，导出包含原始模型分数与标识依据；不生成随机分数。界面突出“已检出 AI 标识”，数值明确标为模型原始分数。Label=2/3、仅平台名字或仅C2PA签发者不会触发该规则。

凭证 valid/trusted 保留对应有效/可信状态；其它状态在存在签发者或写入工具时，主卡显示“内容凭证识别成功”及字段信息。密码学状态不修改，具体验证问题保留在详情中。没有将字段读取等同于内容绑定验证，也未引入外部API。
