# 3.1 Native-Scale 接入

模型来源：https://github.com/mgiant/Qwen2.5ViT-AIGVDetection
论文：Preserving Forgery Artifacts: AI-Generated Video Detection at Native Scale，ICLR 2026。

默认模型为官方 Qwen2.5ViT-448p（668,686,337 参数，约0.669B）。仅实例化视觉编码器与分类头；官方检测权重包含完整参数，因此不下载3B语言模型或基础视觉权重。以 strict=True 加载全部参数，拒绝部分加载。

环境变量：
- NATIVE_SCALE_ARTIFACTS：包含 config.json 与 Qwen2.5-ViT_140k_224p_448p.pth 的目录。
- NATIVE_SCALE_DEVICE：默认CUDA可用则CUDA，否则CPU。Mac已适配CPU+SDPA，不要求FlashAttention。
- VIDEO_TORCH_THREADS：默认4。
- VIDEO_GENERAL_SERVICE_URL：Node网关的服务地址，默认 http://127.0.0.1:8600；兼容旧RESTRAV_SERVICE_URL。

启动推理：`uvicorn app:app --host 127.0.0.1 --port 8600`（工作目录为本服务目录）。网关启动：`npm run dev`。

保持已有最多12个、约2秒、24帧窗口的时间选择策略；使用官方视觉处理器，按比例和448p像素预算预处理，并禁用处理器二次抽帧。官方默认8帧，这里24帧为项目集成协议，不视为复现论文成绩。逐窗口串行推理以限制内存。

分类方向遵循官方test.py：sigmoid(logit)为fake得分；所有合并patch平均后进入线性分类头。保留 mean/max 各半的视频聚合作为工程规则，未做业务校准。0.5/0.8为临时提示阈值，所有结果带 thresholdsCalibrated=false；不能称为准确概率。风险区间对应采样窗口，不代表模型逐帧定位，coverage固定partial。

旧 restrav_core.py 与旧产物暂留用于对照，但 app.py 不再加载它们。未发现官方仓库明确商用授权说明，商用上线前需要确认模型和训练数据许可。

## 授权状态
当前版本仅供研究和评估。官方检测仓库未声明明确许可；Qwen2.5-VL-3B-Instruct基座采用Qwen Research License，商业使用需另行授权。视觉子模块也不能据此豁免基座条款。
许可证：https://huggingface.co/Qwen/Qwen2.5-VL-3B-Instruct/blob/main/LICENSE

下载权重：从官方README的448p Google Drive链接下载，命名为 artifacts/Qwen2.5-ViT_140k_224p_448p.pth；不包含在Git中。
https://github.com/mgiant/Qwen2.5ViT-AIGVDetection#model-checkpoints
