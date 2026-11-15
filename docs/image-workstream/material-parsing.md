# 2.3 统一真实材料解析（2026-10-22）

实现入口为 `scripts/image-validation/parse_material.py`，核心为 `documents/python/material_parser.py`。它只准备真实材料及其来源，不输出模型分数或鉴伪结论；已有 `pdf_adapter.py` 未改动。

## 接口与状态

在项目目录运行（输出目录必须不存在，避免覆盖旧证据）：

```sh
../runtime/envs/ocr-runtime/bin/python scripts/image-validation/parse_material.py \
  --input /absolute/input.docx \
  --output-dir ../runtime/replay/new-unique-material \
  --material-id material-001 --render-docx
```

stdout 只有 `{ "status": "partial", "manifest": "/absolute/output/material.json" }`。退出码0包含 completed 与 partial；failed 返回1。调用者必须读取清单状态，不能把退出码0解释为鉴伪成功。`--render-docx` 可选，默认只提取DOCX文字；原生转换始终受同一进程树超时和资源上限控制。所有输入输出应由本项目持有，HTTP层需自行控制上传和输出路径，不接收用户指定任意服务器路径。

`material-parse/0.1` 包含：

| 字段 | 意义 |
| --- | --- |
| material_id / file_version / file_sha256 | 调用方材料ID、`sha256:<hash>`与完整原文件SHA256；解析后复查原文件未变 |
| kind / status / error / warnings | image、pdf、docx、unsupported；completed、partial、failed，与实际限制 |
| pages / page_count | 真实生成页及总页数；未渲染DOCX的总页数为null，pages为空，不虚构第一页 |
| pages[].rendered_file | 相对输出目录的PNG路径；rendered_sha256校验派生图 |
| pages[].source_location | PDF页号、图片帧号或DOCX本地派生页号（均1开始） |
| blocks | DOCX正文段落/表格单元格，含原文、来源与结构位置；不外发 |
| blocks[].source_location | `part,paragraph` 或 `part,table,row,cell,grid_span`，索引均1开始 |
| coverage / visual_status | 已完成页数、文字覆盖及ready/not_run；ready仅表示有图可交给模型 |

DOCX单元格内段落用换行保留。结构块没有可靠的物理页映射，禁止把段落序号当页号或生成框。转换后的页图与原始正文块可同时保留，但 `block_to_page_mapping=not_available`；最终字段框须来自实际页图OCR。页眉、页脚、批注、脚注及尾注暂未提取，存在时列出 `text_omitted_parts` 并返回partial。复杂正文结构也报告未覆盖，不可声称整份完整。

## 支持范围与边界

- PNG/JPEG/WebP/BMP/GIF/TIFF：逐帧生成PNG，记录EXIF方向并归一化，透明背景合成白色。视觉模型和OCR应使用同一派生图，框坐标为方向归一化像素，不能直接叠回未校正原图。
- PDF：复用受控PDFium子进程，保留旋转、裁剪、像素到PDF矩阵、页状态、文本层不可信标志。加密、坏页、页数/像素超限显式失败或部分完成。文本层截断标partial。未做数字签名及文本-图像一致性验证。
- DOCX：读取ZIP中的正文XML，不解压到任意路径；拒绝穿越、重复项、符号链接、加密ZIP、宏、嵌入对象、DTD/实体。外部关系只计数、不抓取。读取正文不执行字段。
- 可选LibreOffice：独立本地profile、宏安全级别最高、链接更新关闭；含外部/可疑关系、字段指令、altChunk或活动内容时禁止转换。转换器不存在/失败保留文字partial。转换后的布局与字体可能与原作者软件不同，不能视为原始截图。
- 旧DOC：当前显式unsupported，要求受控另存DOCX/PDF；即使安装LibreOffice也不直接将无法预检的OLE二进制交给转换器。

默认上限：50MiB原文件、50页、每页2000万像素、总1亿像素、2000 ZIP项、100MiB总解压、单XML10MiB、20万文字、2万块、144DPI、120秒、2GiB地址空间；均为开发限额，非生产容量承诺。超时终止专属子进程组，覆盖LibreOffice及PDF子进程。输出目录必须新建，失败派生物保留供追溯，不删除源文件。原生转换的应用特性预检不是操作系统网络隔离；生产接入仍应在禁网络的受限worker中执行。

## 实测与数据来源

结果在项目上级 `runtime/replay/review-20261022/parsing/summary.json`，安全测试日志 `unit-tests-final.log`。包括中文设备采购发票页、原有郑商所9页官方PDF，以及新下载的2份官方公开中文DOCX：

- [重庆市委党校：科研项目经费报销相关要求及表格](https://www.cqdx.gov.cn/web/article/1476952500056293376/web/content_1476952500056293376.html)：科研项目资金预算表、科研项目出差审批表。
- 新DOCX保存在项目上级 `datasets/chinese-business-forms-20261022/`，来源URL、SHA256与使用范围记录在 `sources.json`。
- 该站标注版权所有，未发现开放数据或商业再分发许可。本次仅作为研发解析实验，不纳入可再分发商业数据，也不推定该校规则适用于其他机构。
- 这些是公开空白模板与工程样本，没有篡改真值，不报告准确率。首轮LibreOffice因大量线程创建在2GiB地址上限内失败，失败记录保留；设置MAX_CONCURRENCY=1、禁OpenCL后受控重跑，代码不自动重试。线程上限依据[LibreOffice官方配置实现](https://cgit.freedesktop.org/libreoffice/online/tree/wsd/LOOLWSD.cpp)。

当前真实页已可传给MIRROR、SEED和OCR；文本块可供独立字段规则。端到端模型和跨材料结论由场景审核流水线记录，本解析器不冒充已执行。
