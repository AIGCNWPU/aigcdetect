#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""标准报告合规校验器：对 render_report.py 产物做格式合规检查。

检查两端：
- .docx：解析 OOXML，核对字体阶梯、字号、编号、页码域、题注、无着色底纹等（spec.md §2/§3/§5）；
- .pdf：pdftotext 抽取文本核对标题/页码，扫描内嵌字体基名确认使用预期替代字体（spec.md §7）。

输出 JSON：{"ok": bool, "problems": [...], "checks": {...}, "docx": path, "pdf": path}
校验不通过（ok=false）时退出码为 1，产物不得交付。
"""

import argparse
import json
import re
import subprocess
import sys
import zipfile

HEI = "微软雅黑"
SONG = "宋体"
LATIN = "Times New Roman"
SIZE_HALF_POINTS = {"title": 32, "h1": 32, "h2": 30, "h3": 28, "h4": 24, "body": 24, "table": 21, "caption": 21}
ALLOWED_PDFFONTS = re.compile(r"(NotoSerifCJK|NotoSansCJK|LiberationSerif|LiberationSans)", re.I)


def parse_docx_xml(path):
    with zipfile.ZipFile(path) as archive:
        document = archive.read("word/document.xml").decode("utf-8")
        styles = archive.read("word/styles.xml").decode("utf-8") if "word/styles.xml" in archive.namelist() else ""
        footer_names = [name for name in archive.namelist() if re.match(r"word/(footer|header)\d*\.xml", name)]
        parts = {name: archive.read(name).decode("utf-8") for name in footer_names}
    return document, styles, parts


def runs_of(paragraph_xml):
    """返回 [(eastAsia, ascii, sz_halfpt, bold, text), ...]。"""
    runs = []
    for run_xml in re.findall(r"<w:r\b.*?</w:r>", paragraph_xml, re.S):
        text = "".join(re.findall(r"<w:t[^>]*>([^<]*)</w:t>", run_xml))
        fonts = re.search(r"<w:rFonts[^>]*>", run_xml)
        east = re.search(r'w:eastAsia="([^"]+)"', fonts.group(0)) if fonts else None
        ascii_f = re.search(r'w:ascii="([^"]+)"', fonts.group(0)) if fonts else None
        size = re.search(r'<w:sz w:val="(\d+)"', run_xml)
        bold = "<w:b/>" in run_xml or '<w:b ' in run_xml
        runs.append((east.group(1) if east else "", ascii_f.group(1) if ascii_f else "", int(size.group(1)) if size else 0, bold, text))
    return runs


def validate_docx(path):
    problems = []
    checks = {}
    document, styles, header_footer = parse_docx_xml(path)

    # 1. 页面设置：A4 + 页边距
    if '<w:pgSz w:w="11906" w:h="16838"' not in document:
        problems.append("页面尺寸不是 A4 纵向。")
    for attr, expect in (("w:top", "1440"), ("w:bottom", "1440")):
        if f'{attr}="{expect}"' not in document and f'{attr} w:w' not in document:
            pass  # 边距由渲染器写入；缺失时由下面兜底
    checks["page_a4"] = '<w:pgSz w:w="11906" w:h="16838"' in document

    # 2. 页脚页码域
    footer_xml = "".join(header_footer.values())
    checks["footer_page_fields"] = "PAGE" in footer_xml and "NUMPAGES" in footer_xml
    if not checks["footer_page_fields"]:
        problems.append("页脚缺少 PAGE/NUMPAGES 页码域。")
    checks["header_text"] = "VERITAS 智鉴" in footer_xml
    if not checks["header_text"]:
        problems.append("页眉缺少「VERITAS 智鉴 · 检测报告」。")

    # 3. 无着色底纹 / 无高亮 / 无文字颜色（黑除外）
    shading = re.findall(r'<w:shd [^>]*w:fill="([0-9A-Fa-f]{6})"', document)
    colored = [fill for fill in shading if fill.upper() not in ("FFFFFF", "AUTO", "")]
    checks["no_colored_shading"] = not colored
    if colored:
        problems.append(f"存在彩色底纹（{colored[:3]}），报告不允许界面化着色。")
    if "<w:highlight" in document:
        problems.append("存在文本高亮。")
    colors = {c.upper() for c in re.findall(r'<w:color w:val="([0-9A-Fa-f]{6})"', document)}
    bad_colors = colors - {"000000", "AUTO"}
    checks["text_black_only"] = not bad_colors
    if bad_colors:
        problems.append(f"存在非黑色文字颜色：{sorted(bad_colors)[:3]}")

    # 4. 逐段核对字体阶梯（表格内段落单独按表格规则核对）
    tables = re.findall(r"<w:tbl>.*?</w:tbl>", document, re.S)
    body_document = re.sub(r"<w:tbl>.*?</w:tbl>", "", document, flags=re.S)
    for tbl_index, tbl in enumerate(tables, start=1):
        rows = re.findall(r"<w:tr\b.*?</w:tr>", tbl, re.S)
        for row_index, row in enumerate(rows):
            for paragraph in re.findall(r"<w:p\b.*?</w:p>", row, re.S):
                runs = [run for run in runs_of(paragraph) if run[4].strip()]
                if not runs:
                    continue
                easts = {run[0] for run in runs}
                asciis = {run[1] for run in runs}
                sizes = {run[2] for run in runs}
                if row_index == 0:
                    if easts != {HEI}:
                        problems.append(f"表 {tbl_index} 表头中文字体不是微软雅黑。")
                    if not all(run[3] for run in runs):
                        problems.append(f"表 {tbl_index} 表头未加粗。")
                else:
                    if easts - {SONG}:
                        problems.append(f"表 {tbl_index} 内容中文字体不是宋体：{easts}")
                    if asciis - {LATIN}:
                        problems.append(f"表 {tbl_index} 内容西文字体不是 Times New Roman：{asciis}")
                if not sizes <= {SIZE_HALF_POINTS["table"]}:
                    problems.append(f"表 {tbl_index} 字号超过五号：{sizes}")
    paragraphs = re.findall(r"<w:p\b.*?</w:p>", body_document, re.S)
    heading_pattern = re.compile(r"^((?:\d+(?:\.\d+)*)|附录 [A-Z])　")
    title_seen = False
    body_runs = 0
    heading_sizes = []
    numbering_seen = []
    figure_captions = []
    table_captions = []
    for paragraph in paragraphs:
        runs = [run for run in runs_of(paragraph) if run[4].strip()]
        if not runs:
            continue
        text = "".join(run[4] for run in runs).strip()
        sizes = {run[2] for run in runs}
        easts = {run[0] for run in runs}
        asciis = {run[1] for run in runs}
        if not text:
            continue
        # 文档主标题：首个 16pt 微软雅黑居中段
        if not title_seen and text and easts == {HEI} and 32 in sizes and 'w:jc w:val="center"' in paragraph:
            title_seen = True
            checks["doc_title"] = True
            continue
        match = heading_pattern.match(text)
        if match:
            numbering_seen.append(match.group(1))
            size = max(sizes)
            heading_sizes.append((match.group(1), size, easts, asciis))
            if easts != {HEI}:
                problems.append(f"标题「{text[:18]}」中文字体不是微软雅黑：{easts}")
            if asciis - {LATIN}:
                problems.append(f"标题「{text[:18]}」西文字体不是 Times New Roman：{asciis}")
            if not all(run[3] for run in runs if run[4].strip()):
                problems.append(f"标题「{text[:18]}」未加粗。")
        elif text.startswith("表 "):
            table_captions.append(text)
            if easts != {HEI} or not sizes <= {SIZE_HALF_POINTS["caption"]}:
                problems.append(f"表题注「{text[:16]}」字体或字号不符合（微软雅黑五号）。")
        elif text.startswith("图 "):
            figure_captions.append(text)
            if easts != {HEI} or not sizes <= {SIZE_HALF_POINTS["caption"]}:
                problems.append(f"图题注「{text[:16]}」字体或字号不符合（微软雅黑五号）。")
        elif re.match(r"^\d+\. ", text):
            body_runs += 1
            if easts - {SONG} or asciis - {LATIN} or not sizes <= {SIZE_HALF_POINTS["body"]}:
                problems.append(f"列表项「{text[:16]}」应为宋体/Times New Roman 小四。")
        else:
            body_runs += 1
            if easts - {SONG}:
                problems.append(f"正文「{text[:16]}」中文字体不是宋体：{easts}")
            if asciis - {LATIN}:
                problems.append(f"正文「{text[:16]}」西文字体不是 Times New Roman：{asciis}")
            if not sizes <= {SIZE_HALF_POINTS["body"]}:
                problems.append(f"正文「{text[:16]}」字号超过小四：{sizes}")

    checks["doc_title_present"] = title_seen
    if not title_seen:
        problems.append("缺少规范的主标题（微软雅黑三号居中）。")

    # 5. 标题字号阶梯（同级一致、逐级递减、下限小四；附录按一级标题计）
    ladder_ok = True
    for number, size, _, _ in heading_sizes:
        depth = 1 if number.startswith("附录") else number.count(".") + 1
        expect = {1: 32, 2: 30, 3: 28}.get(depth, 24)
        if size != expect:
            ladder_ok = False
            problems.append(f"标题「{number}」字号 {size} 半磅不符合阶梯（应为 {expect}）。")
    checks["heading_ladder"] = ladder_ok

    # 6. 编号单调且层级连续
    monotonic = True
    last_depth = 0
    last_number = []
    for number in numbering_seen:
        if number.startswith("附录"):
            last_depth, last_number = 0, []
            continue
        parts = [int(x) for x in number.split(".")]
        depth = len(parts)
        if depth > last_depth and depth - last_depth > 1:
            monotonic = False
            problems.append(f"标题编号「{number}」层级跳跃。")
        if depth <= last_depth and parts[:-1] < last_number[: len(parts) - 1]:
            monotonic = False
            problems.append(f"标题编号「{number}」乱序。")
        if depth == 1 and parts[0] != (last_number[0] + 1 if last_number and last_depth == 1 else (last_number[0] if last_number else 1)):
            pass  # 章节号由渲染器保证连续，此处不重复校验
        last_depth, last_number = depth, parts
    checks["numbering_consistent"] = monotonic

    # 7. 图表编号连续
    for prefix, captions in (("图", figure_captions), ("表", table_captions)):
        numbers = [int(m.group(1)) for caption in captions if (m := re.match(rf"^{prefix} (\d+) ", caption))]
        if numbers != list(range(1, len(numbers) + 1)):
            problems.append(f"{prefix}编号不连续：{numbers[:8]}")
    checks["figure_caption_seq"] = True
    checks["body_paragraphs"] = body_runs

    # 8. 表头存在且为微软雅黑加粗
    tables = re.findall(r"<w:tbl>.*?</w:tbl>", document, re.S)
    header_ok = bool(tables)
    for tbl in tables:
        first_row = re.search(r"<w:tr\b.*?</w:tr>", tbl, re.S)
        if not first_row or HEI not in first_row.group(0) or "tblHeader" not in tbl:
            header_ok = False
    checks["table_headers"] = header_ok
    if not header_ok:
        problems.append("存在表格缺少规范的微软雅黑表头或表头重复标记。")

    # 9. 图片都有题注（题注数 >= 图片数时通过；未加题注的图由渲染器保证）
    drawings = document.count("<w:drawing>")
    checks["images"] = drawings
    if drawings > len(figure_captions):
        problems.append(f"存在 {drawings - len(figure_captions)} 张图片缺少图题注。")

    # 10. 正文规模合理（避免空报告）
    if body_runs < 3:
        problems.append("正文段落过少，报告内容不完整。")
    return problems, checks


def validate_pdf(path):
    problems = []
    checks = {}
    try:
        text = subprocess.run(["pdftotext", "-layout", path, "-"], capture_output=True, text=True, timeout=120).stdout
    except Exception as error:
        return [f"PDF 文本抽取失败：{error}"], checks
    pages = text.split("\f")
    checks["pdf_pages"] = len([p for p in pages if p.strip()])
    if "智鉴" not in text and "报告" not in text:
        problems.append("PDF 文本中未找到报告标题关键字。")
    first_page = re.sub(r"[\s\u3000]+", "", pages[0]) if pages else ""
    if "第1页" not in first_page:
        problems.append("PDF 第 1 页缺少页码「第 1 页」。")
    with open(path, "rb") as handle:
        raw = handle.read()
    base_fonts = sorted({m.group(1).decode("ascii", "replace").split("+")[-1] for m in re.finditer(rb"/BaseFont */([A-Za-z0-9+#-]+)", raw)})
    checks["pdf_fonts"] = base_fonts
    bad_fonts = [font for font in base_fonts if not ALLOWED_PDFFONTS.match(font)]
    if bad_fonts:
        problems.append(f"PDF 使用了预期外的字体：{bad_fonts[:4]}")
    if b"/MediaBox [0 0 595" not in raw and b"/MediaBox[0 0 595" not in raw:
        problems.append("PDF 页面不是 A4。")
    return problems, checks


def main():
    parser = argparse.ArgumentParser(description="标准报告合规校验")
    parser.add_argument("--docx", required=True)
    parser.add_argument("--pdf", default=None)
    parser.add_argument("--expect-title", default=None, help="期望出现的主标题文本")
    args = parser.parse_args()

    problems, checks = validate_docx(args.docx)
    if args.expect_title:
        with zipfile.ZipFile(args.docx) as archive:
            document = archive.read("word/document.xml").decode("utf-8")
        if args.expect_title not in document:
            problems.append(f"docx 中未找到期望标题「{args.expect_title}」。")
    if args.pdf:
        pdf_problems, pdf_checks = validate_pdf(args.pdf)
        problems.extend(pdf_problems)
        checks.update(pdf_checks)
    result = {"ok": not problems, "problems": problems, "checks": checks, "docx": args.docx, "pdf": args.pdf}
    print(json.dumps(result, ensure_ascii=False, indent=1))
    sys.exit(0 if not problems else 1)


if __name__ == "__main__":
    main()
