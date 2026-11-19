#!/usr/bin/env python
"""把评测结果渲染成一个自包含的静态 HTML 报告（无外部依赖、可直接双击打开）。

只读不需要模型：
    outputs/{split}/metrics.json
    outputs/{split}/confusion_matrix.png
    outputs/{split}/unit_scores.csv
    outputs/{split}/predictions.jsonl

用法：
    python scripts/render_html_report.py \
        --main outputs/test --compare outputs/val:val（20%） outputs/val_fill-zero:"val 消融 fill=zero" \
        outputs/val_oracle:"val oracle 上界" --out outputs/reports/report.html
"""
from __future__ import annotations

import argparse
import base64
import csv
import html
import json
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def read_json(path: Path, default=None):
    if not path.is_file():
        return default
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def read_jsonl(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    rows = []
    with open(path, "r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def read_csv(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    with open(path, "r", encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def embed_image(path: Path) -> str:
    if not path.is_file():
        return ""
    data = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:image/png;base64,{data}"


def fmt(value, digits: int = 4) -> str:
    if value is None:
        return "—"
    if isinstance(value, float):
        return f"{value:.{digits}f}"
    return str(value)


def pct(value) -> str:
    if value is None:
        return "—"
    try:
        return f"{float(value) * 100:.2f}%"
    except (TypeError, ValueError):
        return "—"


def histogram_svg(units: list[dict], bins: int = 20) -> str:
    """real / fake 两类的 p_fake 分布，纯 SVG，不依赖 matplotlib。"""
    if not units:
        return "<p class='muted'>没有 unit_scores.csv，跳过分布图</p>"
    series = {0: [0] * bins, 1: [0] * bins}
    for row in units:
        try:
            score = float(row["p_fake"])
            label = int(float(row["label"]))
        except (KeyError, TypeError, ValueError):
            continue
        index = min(bins - 1, max(0, int(score * bins)))
        series[label][index] += 1
    peak = max(max(series[0]), max(series[1]), 1)

    width, height = 720, 220
    pad_l, pad_b = 40, 28
    inner_w = width - pad_l - 10
    inner_h = height - pad_b - 10
    bar_w = inner_w / bins

    parts = [
        f"<svg viewBox='0 0 {width} {height}' class='hist' role='img' aria-label='p_fake 分布'>",
        f"<line x1='{pad_l}' y1='{height - pad_b}' x2='{width - 10}' y2='{height - pad_b}' stroke='#cbd5e0'/>",
        f"<line x1='{pad_l}' y1='10' x2='{pad_l}' y2='{height - pad_b}' stroke='#cbd5e0'/>",
        f"<text x='4' y='16' font-size='11' fill='#64748b'>{peak}</text>",
        f"<text x='4' y='{height - pad_b}' font-size='11' fill='#64748b'>0</text>",
        f"<text x='{pad_l}' y='{height - 8}' font-size='11' fill='#64748b'>p_fake=0</text>",
        f"<text x='{width - 70}' y='{height - 8}' font-size='11' fill='#64748b'>p_fake=1</text>",
    ]
    for label, color in ((0, "#2b6cb0"), (1, "#c53030")):
        for index, count in enumerate(series[label]):
            if count == 0:
                continue
            h = count / peak * inner_h
            x = pad_l + index * bar_w + (0 if label == 0 else bar_w / 2)
            y = height - pad_b - h
            parts.append(
                f"<rect x='{x:.1f}' y='{y:.1f}' width='{bar_w / 2 - 1:.1f}' height='{h:.1f}' "
                f"fill='{color}' opacity='0.8'><title>{'fake' if label else 'real'}: {count}</title></rect>"
            )
    parts.append(
        f"<text x='{pad_l + 8}' y='24' font-size='12' fill='#2b6cb0'>■ 真（label=0）</text>"
        f"<text x='{pad_l + 130}' y='24' font-size='12' fill='#c53030'>■ 假（label=1）</text>"
    )
    parts.append("</svg>")
    return "".join(parts)


def kpi_card(label: str, value: str, hint: str = "") -> str:
    hint_html = f"<div class='hint'>{html.escape(hint)}</div>" if hint else ""
    return (
        f"<div class='card'><div class='k'>{html.escape(label)}</div>"
        f"<div class='v'>{html.escape(value)}</div>{hint_html}</div>"
    )


def render_rows(predictions: list[dict]) -> str:
    rows = []
    for row in predictions:
        speakers = row.get("speakers") or []
        p_fake = {str(item.get("id")): item.get("p_fake") for item in speakers}
        is_fake = {str(item.get("id")): item.get("is_fake") for item in speakers}
        truth = row.get("truth_category", "?")
        pred = row.get("pred_category", "?")
        correct = truth == pred
        reasons = ",".join(row.get("reasons") or [])
        gt = row.get("gt") or {}
        gt_fake = gt.get("fake_speaker")
        gt_regions = gt.get("fake_regions") or []
        regions_text = " ".join(f"[{float(a):.2f}, {float(b):.2f}]" for a, b in gt_regions) or "—"
        cls = "ok" if correct else "bad"
        rows.append(
            "<tr class='{cls}' data-correct='{correct}'>"
            "<td>{file_id}</td><td>{cond}</td><td>{truth}</td><td>{pred}</td>"
            "<td>{gt_fake}</td><td>{pa}</td><td>{pb}</td>"
            "<td>{fa}</td><td>{fb}</td><td>{regions}</td><td>{reasons}</td>"
            "</tr>".format(
                cls=cls,
                correct="1" if correct else "0",
                file_id=html.escape(str(row.get("file_id"))),
                cond=html.escape(str(row.get("condition"))),
                truth=html.escape(str(truth)),
                pred=html.escape(str(pred)),
                gt_fake="—" if gt_fake is None else str(gt_fake),
                pa=fmt(p_fake.get("A"), 4),
                pb=fmt(p_fake.get("B"), 4),
                fa="是" if is_fake.get("A") else "否",
                fb="是" if is_fake.get("B") else "否",
                regions=html.escape(regions_text),
                reasons=html.escape(reasons or "—"),
            )
        )
    return "\n".join(rows)


def pick_examples(predictions: list[dict], limit: int) -> list[dict]:
    """挑几条有代表性的：一条判对的 both_real、一条判对的 A/B_fake、一条判错的。"""
    picked: list[dict] = []
    wanted = [
        lambda row: row.get("truth_category") == "both_real" and row.get("pred_category") == "both_real",
        lambda row: row.get("truth_category") in ("A_fake", "B_fake")
        and row.get("pred_category") == row.get("truth_category"),
        lambda row: row.get("truth_category") != row.get("pred_category"),
    ]
    for test in wanted:
        for row in predictions:
            if test(row) and all(row["file_id"] != item["file_id"] for item in picked):
                picked.append(row)
                break
        if len(picked) >= limit:
            break
    return picked[:limit]


def render_examples(main_dir: Path, predictions: list[dict], limit: int, work_dir: Path) -> str:
    """渲染原音频 / A / B 的波形对比图（需要该文件的 A.wav、B.wav 和原音频）。"""
    if limit <= 0:
        return ""
    try:
        from spoofdiar import audio as audio_io
        from spoofdiar.debug_plots import save_mask_figure
    except Exception as exc:  # 画图依赖缺失时不阻断报告
        return f"<p class='muted'>波形图不可用：{exc}</p>"

    work_dir.mkdir(parents=True, exist_ok=True)
    blocks: list[str] = []
    for row in pick_examples(predictions, limit):
        file_id = str(row.get("file_id"))
        file_dir = main_dir / file_id
        result = read_json(file_dir / "result.json")
        if not result:
            continue
        original = Path(result.get("audio_path") or "")
        masked = {"A": file_dir / "A.wav", "B": file_dir / "B.wav"}
        if not original.is_file() or not all(path.is_file() for path in masked.values()):
            continue
        png = work_dir / f"{file_id}_mask.png"
        try:
            save_mask_figure(
                original,
                masked,
                int(result.get("samplerate") or 16000),
                png,
                title=f"{file_id}  truth={row.get('truth_category')}  pred={row.get('pred_category')}",
                speaker_segments={
                    str(item.get("id")): item.get("segments") or []
                    for item in result.get("speakers", [])
                },
            )
        except Exception as exc:
            blocks.append(f"<p class='muted'>{html.escape(file_id)} 画图失败：{html.escape(str(exc))}</p>")
            continue
        data = base64.b64encode(png.read_bytes()).decode("ascii")
        speakers = result.get("speakers", [])
        detail = " · ".join(
            f"{item.get('id')}（{item.get('pyannote_label')}）p_fake={fmt(item.get('p_fake'), 4)}"
            f" {'判假' if item.get('is_fake') else '判真'}"
            for item in speakers
        )
        blocks.append(
            "<div class='fig' style='margin-bottom:14px'>"
            f"<img alt='{html.escape(file_id)}' src='data:image/png;base64,{data}'/>"
            f"<div class='muted' style='margin-top:6px'>{html.escape(file_id)} · {html.escape(detail)}</div>"
            "</div>"
        )
    if not blocks:
        return "<p class='muted'>没有可用的掩码音频（可能关了 keep_masked_audio）</p>"
    return "".join(blocks)


def render_compare(runs: list[tuple[str, dict]]) -> str:
    headers = ["条件", "单位数", "EER", "AUC", "准确率", "平衡准确率", "原始误报率", "篡改归属", "DER(orig)", "DER(mod)"]
    head = "".join(f"<th>{html.escape(name)}</th>" for name in headers)
    body = []
    for label, metrics in runs:
        units = metrics.get("units") or {}
        level = metrics.get("file_level") or {}
        der = metrics.get("diarization") or {}
        body.append(
            "<tr><td class='left'>{label}</td><td>{n}</td><td>{eer}</td><td>{auc}</td>"
            "<td>{acc}</td><td>{bal}</td><td>{fp}</td><td>{attr}</td><td>{do}</td><td>{dm}</td></tr>".format(
                label=html.escape(label),
                n=fmt(units.get("n")),
                eer=pct(units.get("eer")),
                auc=fmt(units.get("auc")),
                acc=pct(units.get("accuracy")),
                bal=pct(units.get("balanced_accuracy")),
                fp=pct(level.get("original_false_positive_rate")),
                attr=pct(level.get("modified_attribution_accuracy")),
                do=pct((der.get("original") or {}).get("der")),
                dm=pct((der.get("modified") or {}).get("der")),
            )
        )
    return f"<table class='grid'><thead><tr>{head}</tr></thead><tbody>{''.join(body)}</tbody></table>"


CSS = """
:root{--bg:#f7f9fc;--card:#fff;--ink:#1a202c;--muted:#64748b;--line:#e2e8f0;--blue:#2b6cb0;--red:#c53030;--green:#2f855a}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
.wrap{max-width:1180px;margin:0 auto;padding:28px 20px 60px}
h1{font-size:22px;margin:0 0 6px}
h2{font-size:16px;margin:34px 0 12px;padding-left:9px;border-left:4px solid var(--blue)}
.meta{color:var(--muted);font-size:13px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:16px 0 4px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px}
.card .k{color:var(--muted);font-size:12px}
.card .v{font-size:22px;font-weight:600;margin-top:2px}
.card .hint{color:var(--muted);font-size:11px;margin-top:2px}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden;font-size:13px}
th,td{padding:7px 10px;text-align:right;border-bottom:1px solid var(--line)}
th{background:#eef2f7;color:#334155;font-weight:600}
td.left,th:first-child{text-align:left}
tbody tr:last-child td{border-bottom:none}
tr.bad td{background:#fff5f5}
tr.ok td:first-child{color:var(--green)}
.muted{color:var(--muted)}
.fig{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px;text-align:center}
.fig img{max-width:100%}
.hist{width:100%;max-width:760px}
.toolbar{display:flex;gap:8px;margin:10px 0}
button{border:1px solid var(--line);background:var(--card);border-radius:8px;padding:6px 12px;cursor:pointer;font-size:13px}
button.on{background:var(--blue);color:#fff;border-color:var(--blue)}
code{background:#eef2f7;padding:1px 5px;border-radius:4px;font-size:12px}
.note{background:#fffbeb;border:1px solid #f6e05e;border-radius:10px;padding:12px 16px;font-size:13px}
"""

JS = """
function filterRows(mode){
  document.querySelectorAll('#files tbody tr').forEach(function(tr){
    var ok = tr.dataset.correct === '1';
    tr.style.display = (mode === 'wrong' && ok) ? 'none' : '';
  });
  document.querySelectorAll('.toolbar button').forEach(function(b){ b.classList.remove('on'); });
  document.getElementById('btn-' + mode).classList.add('on');
}
"""


def build_html(
    main_label: str,
    main_dir: Path,
    main_metrics: dict,
    runs: list[tuple[str, dict]],
    examples_html: str = "",
) -> str:
    units = main_metrics.get("units") or {}
    level = main_metrics.get("file_level") or {}
    der = main_metrics.get("diarization") or {}
    attrib = der.get("fake_region_attribution") or {}

    cards = "".join(
        [
            kpi_card("说话人级 EER", pct(units.get("eer")), f"n={units.get('n')} 单位"),
            kpi_card("AUC", fmt(units.get("auc")), "与阈值无关"),
            kpi_card("准确率 @τ", pct(units.get("accuracy")), f"τ={main_metrics.get('threshold')}"),
            kpi_card("原始文件误报率", pct(level.get("original_false_positive_rate")), f"{level.get('n_original')} 个原始文件"),
            kpi_card("篡改归属准确率", pct(level.get("modified_attribution_accuracy")), f"{level.get('n_modified')} 个篡改文件"),
            kpi_card("DER", pct((der.get("all") or {}).get("der")), "pyannote.metrics，collar 0.25 s"),
            kpi_card("伪造句归属", pct(attrib.get("mean")), f"n={attrib.get('n')}"),
        ]
    )

    predictions = read_jsonl(main_dir / "predictions.jsonl")
    units_csv = read_csv(main_dir / "unit_scores.csv")
    confusion = embed_image(main_dir / "confusion_matrix.png")
    wrong = sum(1 for row in predictions if row.get("truth_category") != row.get("pred_category"))

    confusion_html = (
        f"<div class='fig'><img alt='confusion matrix' src='{confusion}'/></div>"
        if confusion
        else "<p class='muted'>没有 confusion_matrix.png</p>"
    )

    return f"""<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>对话按说话人伪造检测 · {html.escape(main_label)}</title>
<style>{CSS}</style></head>
<body><div class="wrap">
<h1>两人对话按说话人的伪造检测 · {html.escape(main_label)}</h1>
<div class="meta">生成时间 {datetime.now().strftime('%Y-%m-%d %H:%M')} ·
检测后端 {html.escape(str(main_metrics.get('threshold_source', '')))} ·
阈值 τ = {fmt(main_metrics.get('threshold'), 4)} ·
样本 {len(predictions)} 个文件（{wrong} 个文件级判错）</div>

<h2>① 指标总览</h2>
<div class="cards">{cards}</div>

<h2>② 与其它条件对比</h2>
{render_compare(runs)}
<p class="muted">DER / 伪造句归属衡量分离质量；它们和检测指标要分开看：DER 高说明分人本身就错。</p>

<h2>③ 文件级混淆矩阵</h2>
{confusion_html}
<p class="muted">行是真实情况、列是预测结论，编号空间是标注的说话人 0/1（预测的 A/B 已按时间重叠配对映射过去）。</p>

<h2>④ p_fake 分布（说话人单位）</h2>
<div class="fig">{histogram_svg(units_csv)}</div>
<p class="muted">两类分得越开越好；中间那堆重叠就是 EER 的来源。</p>

<h2>⑤ 掩码示例（原音频 / A / B 上下对齐）</h2>
<p class="muted">A、B 与原音频等长：自己说话的段落保留原声，对方的位置填底噪。橙色标出的是该说话人的片段。</p>
{examples_html}

<h2>⑥ 逐文件结果</h2>
<div class="toolbar">
  <button id="btn-all" class="on" onclick="filterRows('all')">全部 {len(predictions)}</button>
  <button id="btn-wrong" onclick="filterRows('wrong')">只看判错的 {wrong}</button>
</div>
<table id="files"><thead><tr>
<th>文件</th><th>条件</th><th>真值</th><th>预测</th><th>真值假说话人</th>
<th>p_fake(A)</th><th>p_fake(B)</th><th>A 判假</th><th>B 判假</th><th>真值伪造区间</th><th>错误原因</th>
</tr></thead><tbody>
{render_rows(predictions)}
</tbody></table>

<h2>⑦ 怎么复现</h2>
<div class="note">
<code>bash scripts/run_build_gt.sh {html.escape(main_label)} --align always --force</code><br/>
<code>$VENV run_eval.py --split {html.escape(main_label)} --sample-ratio 0.2 --backend local --device cuda:2</code>
<br/>阈值只在 val 上选，test 直接复用；报告与逐文件产物在同目录下。
</div>
<p class="muted" style="margin-top:24px">由 <code>scripts/render_html_report.py</code> 生成 · 单文件、无外部依赖</p>
</div><script>{JS}</script></body></html>
"""


def main() -> int:
    parser = argparse.ArgumentParser(description="渲染静态 HTML 评测报告")
    parser.add_argument("--main", required=True, help="主结果目录，如 outputs/test")
    parser.add_argument("--main-label", default="test")
    parser.add_argument(
        "--compare",
        nargs="*",
        default=[],
        help="对比项，格式 dir:标签，可多个",
    )
    parser.add_argument("--out", required=True, help="输出 html 路径")
    parser.add_argument("--examples", type=int, default=3, help="波形示例条数（0 表示不画）")
    args = parser.parse_args()

    main_dir = Path(args.main)
    main_metrics = read_json(main_dir / "metrics.json")
    if not main_metrics:
        print(f"读不到 {main_dir / 'metrics.json'}", flush=True)
        return 2

    runs: list[tuple[str, dict]] = [(args.main_label, main_metrics)]
    for item in args.compare:
        path, _, label = item.partition(":")
        metrics = read_json(Path(path) / "metrics.json")
        if metrics:
            runs.append((label or path, metrics))

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    predictions = read_jsonl(main_dir / "predictions.jsonl")
    examples_html = render_examples(main_dir, predictions, args.examples, out.parent / "figures")
    out.write_text(
        build_html(args.main_label, main_dir, main_metrics, runs, examples_html),
        encoding="utf-8",
    )
    print(f"写出 {out}（{out.stat().st_size / 1024:.0f} KB）", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
