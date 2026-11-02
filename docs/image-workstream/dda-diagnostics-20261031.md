# DDA H+ 图像诊断与材料核验展示交付

日期：2026-10-31。工作区：独立协作仓库 `aigc-image-review`，分支 `develop`。本轮未 commit、push 或合并。对应 OpenSpec：`add-image-general`、`add-image-documents`。

## 1. 当前模型与接入范围

整图分类使用本次传输的 **DDA H+** 发布包，模型 ID `dda_hplus_official_20261025`，不再以 MIRROR 作为新任务的实际分类器。代码在平台根目录的 `third_party/dda_hplus`，权重在 `weights/dda_hplus/dda_hplus_fp32.pth`；源部署包保持原样。

权重 SHA256：`f7f8e968cc26b9ad01db99fa985c89c6e5610b1af8d73993eb70490513fc6951`。

- 2.1 通用图片：真实异步上传、轮询、DDA 分类、局部响应解释、来源诊断、真实例子、JSON 记录下载。
- 2.3 材料：图像来源阶段改用同一 DDA 权重；内部 `mirror` 键保留以兼容历史报告，`provider` 与模型版本写实际 DDA 信息。SEED 定位保持原链路。
- 保留发布包的 RGB、336×336 中心裁剪、不缩放、小图零填充和 FP32；不自动按 EXIF 旋转模型输入。预览使用同坐标系的本地 PNG，以免浏览器自动旋转后错位。
- 单卡，每次检查显存和负载；无空闲卡时失败并提示稍后重试。Python 环境沿用可用的 `mirror-runtime`，环境目录名称不代表仍使用 MIRROR 模型。

模型只判断中心区域，界面标明范围。没有扩大成全幅密集推理，也没有重新训练或校准。

## 2. 可解释诊断的实际含义

| 展示 | 实现 | 与分类结论的关系 |
| --- | --- | --- |
| AI 来源信号 | DDA 的 sigmoid 分数，以 0–100 展示 | 未经概率校准，不是造假概率 |
| 重点响应区域 | 在实际336裁剪内划分4×4区域，分别使用局部模糊、均值填充遮挡，共32次变体推理 | 原分数大于0.5且两种遮挡均下降至少0.05才标记；记录所有原分数、遮挡分数与坐标 |
| 来源凭证 | 官方 c2patool 0.28.2 读取、签名及内容绑定校验 | 区分不存在、有效但信任未确认、受信、失效、无法验证；不按字符串命中判定 |
| 源文件信息 | SHA256、尺寸、格式、允许展示的相机/软件/时间元数据 | 可编辑，只作为辅助信息；不展示GPS、序列号或任意提示词元数据 |
| 压缩差异 | JPEG质量90重新压缩，与原图差值放大8倍 | 仅JPEG提供，不参与AI打分 |
| 细节分布 | 原图与高斯模糊差值的高频残差、清晰度指标 | 纹理和边缘也会产生响应，不参与AI打分 |

没有随机风险百分比，也没有将文件名、缺失元数据或 C2PA 存在与否加进 AI 分数。区域响应解释分类敏感性，不冒充 SEED 篡改定位或像素级生成真值。0.05是本轮固定展示阈值，尚未经过专门的定位真值评估。

C2PA 禁止远程凭证与 OCSP 抓取，没有加入自定义信任根，不声称在线吊销状态已经检查。Python 版原生库最初因系统 glibc 2.31 不兼容而未能运行；最终使用项目工具目录中的官方 CLI 和单独 glibc 加载器，无系统库替换。复现安装：`bash scripts/image-validation/install-c2pa-local.sh`，需要先设置 `AIGC_PLATFORM_ROOT`。下载版本与哈希固定在脚本中。

官方依据：[c2patool](https://github.com/contentauth/c2patool)、[校验设置](https://opensource.contentauthenticity.org/docs/manifest/json-ref/settings-schema/)。

## 3. 图像实测

产物根目录：`runtime/replay/visual-diagnostics-20261031/`，相对于平台根目录。

| 样本 | 数据来源/标签 | DDA分数 | 标记区域数 | 结果 |
| --- | --- | ---: | ---: | --- |
| visual-1 | 已有真实图清单 | 0.059924 | 0 | 正确 |
| visual-2 | 已有真实图清单 | 0.054772 | 0 | 正确 |
| visual-3 | 已有真实图清单 | 0.059884 | 0 | 正确 |
| visual-4 | GLIDE 生成图 | 0.980996 | 1 | 正确 |
| visual-5 | GLIDE 生成图 | 0.735928 | 2 | 正确 |
| visual-6 | BIGGAN 生成图 | 0.976117 | 1 | 正确 |
| visual-7 | Qwen-Image-2.0-pro 生成图 | 0.162782 | 0 | 漏检，保留在前端示例 |
| visual-8 | gpt-image-2 生成图 | 0.949249 | 6 | 正确 |

8张判对7张：真实3/3、生成4/5。这是小规模工程验收，不能估计总体准确率。未按样本调整模型阈值。分类和遮挡完成后，单图约2.3–2.6秒，首张约5.8秒；不包括进程启动、模型加载、排队及上传。

真实 HTTP 上传 visual-4：分数 `0.9809959530830383`，与离线结果一致，实际模型 ID 与权重哈希正确。材料阶段适配器真实加载 DDA，并返回真实图分数 `0.05992386117577553`，与原结果一致。此项验证材料的来源阶段，不代表重新执行了整条 SEED/OCR/PDF 链路。

128个区域坐标均在原图边界内，8张的原输入分数与显式中心裁剪分数差均为0，覆盖128、256小图和1024大图。EXIF旋转测试确认预览保留原始像素坐标。`results.json` 保留首次运行，`results-c2pa-verified.json` 补入已实际验证的凭证状态、同坐标预览和边界裁剪，不改变分类分数。

凭证测试：官方 `C.jpg` 为 `valid`（签发者不受信），修改其声明后为 `invalid`，普通图片为 `absent`。记录在 `c2pa-tests.json`；未将自签测试凭证标为可信。

## 4. 事实核验与 Agent 调整

前端对材料名称和正文做可读化，隐藏 e/q 证据编号，m别名映射回文件名。后台仍保留原始结果与证据引用。相同材料组合、相同判定归成一块，主要告警直接显示，其余核验内容与原文放在一个详情内；各自单文件/跨文件模块内依次显示问题、通过、信息不足。信息不足默认折叠，不冒充通过。

Agent审核指令也有小幅修改：结构化字段未覆盖不等于OCR未读到；不得凭多人授权推定排他性冲突；按材料用途审核，不对非结算材料强行要求付款或验收条件；警告不能比解释更绝对。这不是更换Agent编排，仍沿用师兄的SDK工具读取证据、提交结构化结论流程。

真实复测两组，保留旧记录不覆盖：

| 组 | 材料 | 结果 |
| --- | --- | --- |
| 08 | 两份生活缴费凭证 | 单文件2项信息不足；跨文件2项问题。发现同流水号、户号下收费单位、住址与付款账号不同 |
| 11 | 三份授权证明 | 单文件3项信息不足；跨文件4项风险提示。不同被授权人对应相同合同号与期限，解释明确不能仅凭多人授权推定排他性违规 |

实际外部HTTP请求 **12次 / 上限50次**，含SDK中间调用。测试通过仅监听127.0.0.1的固定上游代理计数，每次发出前写入预算，不按SDK轮数推算请求数。不上传图片，只发送本任务已授权的必要原文证据。计数与结果位于 `runtime/replay/review-diagnostics-20261031/`。

仍有语义限制：缴费组中的“晚上8:02”可能是设备时间；它不应当作为已确认的交易发生时间。授权组提示的是对象/版本风险，不是已经证实造假。未用人工修改响应来美化结果。

另对既有8组真实API响应（缴费、授权、合同、税务证明、出库单、在职证明、户籍卡、营业执照）做前端回放，均不再展示内部e/q/m编号。回放不算新模型测试，不计API调用。

## 5. 代码组织与复现

- `src/modules/image/general/analyze.py`：DDA实际推理、双遮挡、元数据和凭证诊断；`--classify-only` 供材料来源阶段复用。
- `src/modules/image/general/service.js`：输入约束、异步任务、状态与示例读取。
- `src/modules/image/pages/general.js`：上传、结果列表、图层、透明度、示例和导出。
- `src/modules/image/documents/server/local-runtime.js`：材料整图来源改接DDA。
- `src/modules/image/documents/server/review-skills.js`：审核指令修正；`review-agent.js`：受限本地测试代理入口。
- `semantic-review.js`、`review-presentation.js`：保留材料别名映射。
- `src/modules/image/pages/documents.js`：可读结果、证据值补全、分级归组展示。
- `scripts/image-validation/build-public-examples.mjs`：从真实历史/本轮产物生成两个正式入口示例；不调用API，不伪造模型阶段。
- `scripts/openapi.mjs`、`docs/openapi.json`：同步2.1异步接口与2.3示例动作。

运行时设置平台根目录后，`node scripts/image-validation/build-public-examples.mjs` 生成 `runtime/public-examples/`。两个页面均有真实示例按钮，查看时不发起模型或API推理；材料示例明确标出视觉检测未执行。当前预览端口4184，路由 `/#/image/general` 和 `/#/image/documents`。本地通过SSH转发端口访问。

验证：368项Node测试通过；项目check、build、smoke通过；OpenSpec 1.13.1 全部11项严格验证通过；Chrome桌面/390px手机检查示例、图层切换、路由导航与页面溢出通过。截图 `general-desktop.png`、`general-mobile.png`、`documents-desktop.png`、`documents-mobile.png` 位于图像实测目录。

## 6. 尚未完成的生产能力

公共认证、账号隔离、任务长期存储和后台常驻模型池仍属于后续公共接入；当前异步通用图片任务在进程内索引，重启后不能通过原任务ID继续轮询，但运行产物保留。尚未做大规模吞吐、OOM压力或跨生成器独立盲测。DDA热图未验证像素级定位准确率；C2PA没有做联网信任列表与吊销更新。旧OpenSpec中这些未验收任务保持未勾选。
