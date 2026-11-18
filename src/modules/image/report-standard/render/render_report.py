#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""标准报告渲染器：StdReport(JSON) → 规范 .docx（+ 可选 LibreOffice 转 PDF）。

版式依据 ../spec.md（V1.0）：
- 标题微软雅黑自三号每降一级半号至小四；正文宋体小四；西文与数字 Times New Roman；
- A4 纵向，页眉页脚，章节/图/表自动编号；不使用任何彩色底纹与界面化元素。
"""

import argparse
import base64
import io
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt

HEI = "微软雅黑"          # 标题字体
SONG = "宋体"             # 正文字体
LATIN = "Times New Roman"  # 西文与数字

SZ_TITLE = 16   # 三号
SZ_H1 = 16      # 三号
SZ_H2 = 15      # 小三
SZ_H3 = 14      # 四号
SZ_H4 = 12      # 小四
SZ_BODY = 12    # 小四
SZ_TABLE = 10.5  # 五号
SZ_SMALL = 9    # 小五（页眉页脚）

FONT_DIR_HINT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fonts.conf")


def set_run_font(run, east, size, bold=False):
    run.font.name = LATIN
    run.font.size = Pt(size)
    run.font.bold = bold
    rpr = run._element.get_or_add_rPr()
    fonts = rpr.find(qn("w:rFonts"))
    if fonts is None:
        fonts = OxmlElement("w:rFonts")
        rpr.append(fonts)
    fonts.set(qn("w:ascii"), LATIN)
    fonts.set(qn("w:hAnsi"), LATIN)
    fonts.set(qn("w:eastAsia"), east)
    fonts.set(qn("w:cs"), LATIN)


def first_line_indent(paragraph, chars=2):
    ppr = paragraph._element.get_or_add_pPr()
    indent = ppr.find(qn("w:ind"))
    if indent is None:
        indent = OxmlElement("w:ind")
        ppr.append(indent)
    indent.set(qn("w:firstLineChars"), str(chars * 100))
    indent.set(qn("w:firstLine"), str(int(chars * SZ_BODY * 20)))


def line_spacing(paragraph, multiple):
    ppr = paragraph._element.get_or_add_pPr()
    spacing = ppr.find(qn("w:spacing"))
    if spacing is None:
        spacing = OxmlElement("w:spacing")
        ppr.append(spacing)
    spacing.set(qn("w:line"), str(int(multiple * 240)))
    spacing.set(qn("w:lineRule"), "auto")


def keep_with_next(paragraph):
    ppr = paragraph._element.get_or_add_pPr()
    ppr.append(OxmlElement("w:keepNext"))


def add_page_number_field(paragraph, instr):
    run = paragraph.add_run()
    fld_begin = OxmlElement("w:fldChar"); fld_begin.set(qn("w:fldCharType"), "begin")
    instr_el = OxmlElement("w:instrText"); instr_el.set(qn("xml:space"), "preserve"); instr_el.text = instr
    # LibreOffice leaves fields without a separate/cached result blank in PDF output.
    fld_separate = OxmlElement("w:fldChar"); fld_separate.set(qn("w:fldCharType"), "separate")
    cached = OxmlElement("w:t"); cached.text = "1"
    fld_end = OxmlElement("w:fldChar"); fld_end.set(qn("w:fldCharType"), "end")
    for element in (fld_begin, instr_el, fld_separate, cached, fld_end):
        run._element.append(element)
    return run


def set_cell_margins(table, dxa=80):
    for cell in table._cells:
        tcpr = cell._tc.get_or_add_tcPr()
        margins = OxmlElement("w:tcMar")
        for side in ("top", "start", "bottom", "end"):
            el = OxmlElement(f"w:{side}")
            el.set(qn("w:w"), str(dxa)); el.set(qn("w:type"), "dxa")
            margins.append(el)
        tcpr.append(margins)


def ensure_table_borders(table):
    tbl_pr = table._tbl.tblPr
    borders = tbl_pr.find(qn("w:tblBorders"))
    if borders is not None:
        tbl_pr.remove(borders)
    borders = OxmlElement("w:tblBorders")
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        el = OxmlElement(f"w:{edge}")
        el.set(qn("w:val"), "single"); el.set(qn("w:sz"), "4")
        el.set(qn("w:space"), "0"); el.set(qn("w:color"), "000000")
        borders.append(el)
    tbl_pr.append(borders)


def mark_header_row(row):
    trpr = row._tr.get_or_add_trPr()
    header = OxmlElement("w:tblHeader")
    header.set(qn("w:val"), "true")
    trpr.append(header)


def decode_image(src):
    """dataURL / 本地路径 → (bytes, mime)；失败返回 None。"""
    match = re.match(r"^data:(image/(?:png|jpeg|jpg|webp));base64,(.+)$", src or "", re.S)
    if match:
        try:
            return base64.b64decode(match.group(2)), match.group(1)
        except Exception:
            return None
    if src and os.path.isfile(src):
        ext = os.path.splitext(src)[1].lower().lstrip(".")
        mime = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "webp": "image/webp"}.get(ext)
        if mime:
            with open(src, "rb") as handle:
                return handle.read(), mime
    return None


def draw_regions(image_bytes, mime, regions):
    """在图片副本上绘制橙色矩形（疑似修改位置），返回处理后的 PNG bytes。"""
    try:
        from PIL import Image, ImageDraw
    except Exception:
        return image_bytes, mime
    try:
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        draw = ImageDraw.Draw(image)
        width, height = image.size
        line = max(2, int(min(width, height) * 0.004))
        for region in regions or []:
            box = (
                region["x"] * width, region["y"] * height,
                min(width, (region["x"] + region["width"]) * width),
                min(height, (region["y"] + region["height"]) * height),
            )
            for offset in range(line):
                draw.rectangle([box[0] - offset, box[1] - offset, box[2] + offset, box[3] + offset], outline="#e1852e")
        out = io.BytesIO()
        image.save(out, format="PNG")
        return out.getvalue(), "image/png"
    except Exception:
        return image_bytes, mime


class StdRenderer:
    def __init__(self, report):
        self.report = report
        self.doc = Document()
        self.figure_no = 0
        self.table_no = 0
        self.chapter_no = 0
        self.section_counters = [0, 0, 0]  # h2/h3/h4
        self._setup_page()

    # ---------- 页面与页眉页脚 ----------
    def _setup_page(self):
        section = self.doc.sections[0]
        section.page_width = Cm(21)
        section.page_height = Cm(29.7)
        section.top_margin = Cm(2.54)
        section.bottom_margin = Cm(2.54)
        section.left_margin = Cm(3.0)
        section.right_margin = Cm(3.0)
        section.header_distance = Cm(1.5)
        section.footer_distance = Cm(1.5)

        header = section.header
        header.is_linked_to_previous = False
        hp = header.paragraphs[0]
        hp.text = ""
        hp.alignment = WD_ALIGN_PARAGRAPH.CENTER
        set_run_font(hp.add_run("VERITAS 智鉴 · 检测报告"), SONG, SZ_SMALL)

        footer = section.footer
        footer.is_linked_to_previous = False
        fp = footer.paragraphs[0]
        fp.text = ""
        fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
        set_run_font(fp.add_run("第 "), SONG, SZ_SMALL)
        set_run_font(add_page_number_field(fp, "PAGE"), SONG, SZ_SMALL)
        set_run_font(fp.add_run(" 页　共 "), SONG, SZ_SMALL)
        set_run_font(add_page_number_field(fp, "NUMPAGES"), SONG, SZ_SMALL)
        set_run_font(fp.add_run(" 页"), SONG, SZ_SMALL)

        # 正文默认样式（宋体小四 + Times New Roman）
        normal = self.doc.styles["Normal"]
        normal.font.name = LATIN
        normal.font.size = Pt(SZ_BODY)
        normal._element.rPr.rFonts.set(qn("w:eastAsia"), SONG)

    # ---------- 段落与标题 ----------
    def add_title_block(self):
        title = self.doc.add_paragraph()
        title.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run = title.add_run(self.report["docTitle"])
        set_run_font(run, HEI, SZ_TITLE, bold=True)
        title.paragraph_format.space_after = Pt(6)
        if self.report.get("subtitle"):
            sub = self.doc.add_paragraph()
            sub.alignment = WD_ALIGN_PARAGRAPH.CENTER
            set_run_font(sub.add_run(self.report["subtitle"]), SONG, SZ_BODY)
            sub.paragraph_format.space_after = Pt(6)
        self.add_meta_table()

    def add_meta_table(self):
        meta = self.report.get("meta") or []
        if not meta:
            return
        self.add_table_block({"columns": [{"title": "项目", "width": 30}, {"title": "内容", "width": 70}],
                              "rows": [[k, v] for k, v in meta], "caption": "报告信息"})
        self.doc.add_paragraph()

    def add_heading(self, text, level):
        size = {1: SZ_H1, 2: SZ_H2, 3: SZ_H3}.get(level, SZ_H4)
        paragraph = self.doc.add_paragraph()
        if level == 1:
            paragraph.paragraph_format.space_before = Pt(13)
            paragraph.paragraph_format.space_after = Pt(6)
        else:
            paragraph.paragraph_format.space_before = Pt(6)
            paragraph.paragraph_format.space_after = Pt(3)
        run = paragraph.add_run(text)
        set_run_font(run, HEI, size, bold=True)
        keep_with_next(paragraph)
        return paragraph

    def add_body(self, text, no_indent=False):
        paragraph = self.doc.add_paragraph()
        line_spacing(paragraph, 1.5)
        if not no_indent:
            first_line_indent(paragraph, 2)
        set_run_font(paragraph.add_run(text), SONG, SZ_BODY)
        return paragraph

    # ---------- 表格与图片 ----------
    def add_caption(self, text, before):
        if before:
            self.table_no += 1
            prefix = f"表 {self.table_no} "
        else:
            prefix = f"图 {self.figure_no} "
        paragraph = self.doc.add_paragraph()
        paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
        if before:
            paragraph.paragraph_format.space_before = Pt(6)
            paragraph.paragraph_format.space_after = Pt(3)
        else:
            paragraph.paragraph_format.space_before = Pt(3)
            paragraph.paragraph_format.space_after = Pt(10)
        set_run_font(paragraph.add_run(prefix + text), HEI, SZ_TABLE, bold=True)
        keep_with_next(paragraph)
        return paragraph

    def add_table_block(self, block):
        columns = block.get("columns") or []
        rows = block.get("rows") or []
        caption = block.get("caption") or ""
        if not columns:
            return
        if caption:
            self.add_caption(caption, before=True)
        table = self.doc.add_table(rows=len(rows) + 1, cols=len(columns))
        table.alignment = WD_TABLE_ALIGNMENT.CENTER
        table.autofit = False
        ensure_table_borders(table)
        set_cell_margins(table)
        total = sum(col.get("width") or 0 for col in columns) or 100
        usable = 15.0  # cm（A4 21 - 3 - 3）
        widths = [Cm(usable * ((col.get("width") or 100 / len(columns)) / total)) for col in columns]
        for index, width in enumerate(widths):
            for cell in table.columns[index].cells:
                cell.width = width
        # 表头
        for index, col in enumerate(columns):
            cell = table.cell(0, index)
            paragraph = cell.paragraphs[0]
            paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
            set_run_font(paragraph.add_run(col["title"]), HEI, SZ_TABLE, bold=True)
        mark_header_row(table.rows[0])
        # 内容
        for row_index, row in enumerate(rows, start=1):
            for col_index in range(len(columns)):
                text = str(row[col_index]) if col_index < len(row) else ""
                cell = table.cell(row_index, col_index)
                paragraph = cell.paragraphs[0]
                set_run_font(paragraph.add_run(text), SONG, SZ_TABLE)
                paragraph.paragraph_format.space_before = Pt(1)
                paragraph.paragraph_format.space_after = Pt(1)
        # 表后间距
        tail = self.doc.add_paragraph()
        tail.paragraph_format.space_after = Pt(6)
        run = tail.add_run("")
        set_run_font(run, SONG, 1)

    def add_image_block(self, block):
        decoded = decode_image(block.get("src"))
        if not decoded:
            self.add_body("（本图片未能取得，可在平台页面查看。）", no_indent=True)
            return
        data, mime = decoded
        if block.get("regions"):
            data, mime = draw_regions(data, mime, block["regions"])
        self.figure_no += 1
        caption = block.get("caption") or ""
        width = Cm(min(float(block.get("widthCm") or 14), 15.0))
        paragraph = self.doc.add_paragraph()
        paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
        paragraph.paragraph_format.space_before = Pt(6)
        keep_with_next(paragraph)  # 图片与其下方题注不跨页分离
        run = paragraph.add_run()
        run.add_picture(io.BytesIO(data), width=width)
        if caption:
            self.add_caption(caption, before=False)

    def add_list_block(self, block):
        for index, item in enumerate(block.get("items") or [], start=1):
            paragraph = self.doc.add_paragraph()
            line_spacing(paragraph, 1.5)
            first_line_indent(paragraph, 0)
            paragraph.paragraph_format.left_indent = Cm(0.74)
            set_run_font(paragraph.add_run(f"{index}. {item}"), SONG, SZ_BODY)

    # ---------- 编号 ----------
    def numbered(self, level, title, appendix=False, appendix_letter=None):
        if appendix:
            label = f"附录 {appendix_letter}　{title}"
        elif level == 1:
            self.chapter_no += 1
            self.section_counters = [0, 0, 0]
            label = f"{self.chapter_no}　{title}"
        elif level == 2:
            self.section_counters[0] += 1
            self.section_counters[1] = 0
            self.section_counters[2] = 0
            label = f"{self.chapter_no}.{self.section_counters[0]}　{title}"
        elif level == 3:
            self.section_counters[1] += 1
            self.section_counters[2] = 0
            label = f"{self.chapter_no}.{self.section_counters[0]}.{self.section_counters[1]}　{title}"
        else:
            self.section_counters[2] += 1
            label = f"{self.chapter_no}.{self.section_counters[0]}.{self.section_counters[1]}.{self.section_counters[2]}　{title}"
        return label

    # ---------- 主流程 ----------
    def render(self):
        self.add_title_block()
        appendix_letter = 0
        for chapter in self.report.get("chapters") or []:
            if chapter.get("appendix"):
                appendix_letter += 1
                label = self.numbered(1, chapter["title"], appendix=True, appendix_letter=chr(ord("A") + appendix_letter - 1))
            else:
                label = self.numbered(1, chapter["title"])
            self.add_heading(label, 1)
            for block in chapter.get("blocks") or []:
                kind = block.get("type")
                if kind == "p":
                    self.add_body(block["text"], no_indent=block.get("noIndent"))
                elif kind == "h2":
                    self.add_heading(self.numbered(2, block["title"]), 2)
                elif kind == "h3":
                    self.add_heading(self.numbered(3, block["title"]), 3)
                elif kind == "h4":
                    self.add_heading(self.numbered(4, block["title"]), 4)
                elif kind == "table":
                    self.add_table_block(block)
                elif kind == "list":
                    self.add_list_block(block)
                elif kind == "image":
                    self.add_image_block(block)
        return self.doc


def render_docx(report, out_path):
    renderer = StdRenderer(report)
    document = renderer.render()
    document.save(out_path)
    return {"figures": renderer.figure_no, "tables": renderer.table_no, "chapters": renderer.chapter_no}


def resolve_soffice():
    """soffice 解析顺序：环境变量 → PATH → 平台私有 LibreOffice（正式服务器 runtime/tools 安装）。"""
    from_env = os.environ.get("AIGC_REPORT_SOFFICE")
    if from_env and os.path.isfile(from_env):
        return from_env
    from_path = shutil.which("soffice") or shutil.which("libreoffice")
    if from_path:
        return from_path
    try:
        platform_root = Path(os.environ.get("AIGC_PLATFORM_ROOT") or Path(__file__).resolve().parents[6])
        for name in ("libreoffice", "soffice"):
            candidate = platform_root / "runtime" / "tools" / "bin" / name
            if candidate.is_file():
                return str(candidate)
    except Exception:
        pass
    return None


def convert_pdf(docx_path, out_dir):
    soffice = resolve_soffice()
    if not soffice:
        raise RuntimeError("未找到 LibreOffice（soffice），无法生成 PDF。")
    env = dict(os.environ)
    fontconfig = env.get("AIGC_REPORT_FONTCONFIG") or (FONT_DIR_HINT if os.path.exists(FONT_DIR_HINT) else None)
    if fontconfig:
        env["FONTCONFIG_FILE"] = fontconfig
    result = subprocess.run(
        [soffice, "-env:UserInstallation=" + (Path(out_dir) / "lo-profile").resolve().as_uri(), "--headless", "--norestore", "--convert-to", "pdf", "--outdir", out_dir, docx_path],
        capture_output=True, text=True, timeout=300, env=env,
    )
    pdf_path = os.path.join(out_dir, os.path.splitext(os.path.basename(docx_path))[0] + ".pdf")
    if result.returncode != 0 or not os.path.isfile(pdf_path):
        raise RuntimeError(f"PDF 转换失败：{result.stderr.strip() or result.stdout.strip()}")
    return pdf_path


def main():
    parser = argparse.ArgumentParser(description="StdReport → 标准 docx/pdf 报告")
    parser.add_argument("--model", required=True, help="StdReport JSON 文件路径")
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--basename", default=None, help="输出文件名（不含扩展名）")
    parser.add_argument("--pdf", action="store_true", help="同时生成 PDF")
    args = parser.parse_args()

    with open(args.model, "r", encoding="utf-8") as handle:
        report = json.load(handle)
    os.makedirs(args.out_dir, exist_ok=True)
    basename = args.basename or "report"
    docx_path = os.path.join(args.out_dir, f"{basename}.docx")
    stats = render_docx(report, docx_path)
    payload = {"docx": docx_path, "stats": stats, "pdf": None}
    if args.pdf:
        payload["pdf"] = convert_pdf(docx_path, args.out_dir)
    print(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    main()
