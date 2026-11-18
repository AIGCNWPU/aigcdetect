# 图片场景报告导出交付（2026-11-09）

## 交付

2.1 通用图片与 2.3 证件票据的结果区各新增「导出 PDF 报告 / 导出 Word 报告」按钮（原 JSON 检测记录下载保留）。报告结构对齐前端阅读顺序，结论最先：

- **2.1 通用图片检测报告**：判定横幅（疑似AI生成/未见明显AI生成 + 分数）→ 检测图像（原图 + AI 特征分布，成对排版）→ 分项检测结果表（整图 AI 检测、局部篡改、人像伪造、生成来源）→ 人像逐脸评分 → 生成来源 Top-3 候选 → 文件标识与来源声明（豆包/千问/OpenAI 等平台声明状态）→ 文件信息（格式/尺寸/C2PA/指纹/元数据）→ 范围声明。
- **2.3 材料核验报告**：整批判定横幅（问题/通过/待确认计数 + 核验目的）→ 需要关注的问题（单材料检查与跨材料核验合并，异常在前）→ 材料总览表（角色/整图/篡改/内容结论）→ 逐份材料（页图 + 疑似修改位置橙色矩形、字段表、阶段状态）→ 智能复核摘要 → 核验范围与 limitations。

两种报告均不出现内部模型名、不重复罗列相同检查项、不把未校准分数表述为真实概率。

## 实现

- `src/modules/image/report/model.js`：顺序化报告模型（banner/kv/table/list/images/paragraph 六种块）。
- `src/modules/image/report/pdf.js`：模型 → pdf-lib 渲染器。A4 版式、中英混排断行（中文标点跟随）、表格跨页重复表头、图片嵌入并按百分比绘制疑似修改矩形、页眉页脚。
- `src/modules/image/report/word.js`：模型 → Word（HTML .doc，图片以 data URL 内嵌，Word/WPS 直接打开）。
- `src/modules/image/report/runtime.js`：共享运行时——复用退款场景的 `public/vendor/refund-pdf/`（pdf-lib、fontkit、NotoSansSC）与图片解码（data/object/相对 URL、WebP 画布转 JPEG、超 350 万像素缩放）。
- `src/modules/image/general/report.js`、`src/modules/image/documents/report.js`：两场景模型构建与导出入口（文件名含材料名与时间戳）。
- `src/modules/image/pages/general.js`、`pages/documents.js`：结果区导出按钮与生成中状态；`scripts/source-files.mjs` 增补六个模块进客户端打包清单。

导出在浏览器本地完成，不发起模型调用、不外发材料内容；PDF 字节由 pdf-lib 现场生成（全量中文字体嵌入，单份约 6.4 MB，与退款报告同口径），Word 为单文件 .doc。

## 验证

- 新增 `tests/image-report.test.mjs` 6 项：两场景模型（结论最先、章节顺序、内部名过滤、非法区域过滤）、Word 渲染（含内嵌图、无 undefined）、PDF 渲染（模拟运行时断言横幅/图片/区域矩形/页脚）、断行与模型助手。
- 全项目 528 项 Node 测试通过；check（220 文件/407 链接）、build、smoke、OpenSpec 1.13.1 严格校验 11 项全部通过。
- 真实浏览器实测：通过共享运行时加载真实 pdf-lib + NotoSansSC，两场景报告均产出 `%PDF-` 合法字节（6.46 MB / 6.46 MB），Word HTML 含内嵌图片。导出按钮仅在存在已完成结果时渲染。

## 范围与后续

- 报告内容完全来自已完成结果数据；不新增 GPU 推理或付费 API 调用。
- PDF 中文字体为全量嵌入（与退款报告一致）；如需缩小体积可评估子集嵌入，但需先确认各阅读器字形完整性。
- 后续可将两场景报告样式抽出更多公共块（横幅/表格已共享），并按用户反馈调整字段取舍。
