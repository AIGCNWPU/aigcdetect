// Tamper and face-swap comparison, published from measured runs on 2026-11-10.
// Every number comes from a recorded run under runtime/replay; the API columns
// are the same-image external services, not re-tuned for this table.

export const tamperComparison = {
  updated: '2026-11-10',
  groups: [
    {
      id: 'inpaint',
      title: '通用 AI 局部重绘',
      dataset: 'CocoGlide 官方 40 对 · 按难易分层取 20 张',
      note: '10 张明显重绘 + 10 张轻微重绘；同一批图同时送测本地模型与外部接口。',
      rows: [
        { id: 'ours', name: '智鉴 · 局部篡改定位', featured: true, detected: 10, total: 20, iou: 0.656, note: '检出样本的像素 IoU 均值' },
        { id: 'api', name: '图像修改线索 API', featured: false, detected: 1, total: 20, iou: 0.024, note: '仅 1 张返回区域' },
      ],
    },
    {
      id: 'face',
      title: '人像换脸',
      dataset: 'DeepFakeFace · 10 张换脸 + 10 张真实',
      note: '换脸看作「有篡改」，真实人脸用于衡量误报；外部接口无归属类别，按同一批图对照。',
      rows: [
        { id: 'ours', name: '智鉴 · 人像伪造分析', featured: true, recall: 7, recallTotal: 8, falseAlarm: 1, falseTotal: 9, coverage: '17 / 20', note: '3 张未检出人脸，不计入评分' },
        { id: 'api', name: '图像修改线索 API', featured: false, recall: 8, recallTotal: 10, falseAlarm: 7, falseTotal: 10, coverage: '20 / 20', note: '真实人脸同样高分，区分度不足' },
      ],
    },
  ],
  scope: '外部接口按厂商 >=0.8 的判定参考；本地模型使用服务态权重与默认阈值，未为表格调参。样本量较小，仅作方向性对照，不代表总体性能。人脸类数据无像素真值，不计算定位 IoU。',
};

const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const percent = (value) => `${(value * 100).toFixed(1)}%`;

function inpaintTable(group) {
  return `<div class="tb-scroll"><table><thead><tr><th>方法</th><th>检出率</th><th>定位 IoU</th><th>说明</th></tr></thead><tbody>${group.rows.map((row) => {
    const rate = row.detected / row.total;
    const best = row.featured;
    return `<tr${best ? ' class="tb-ours"' : ''}><th>${escape(row.name)}</th><td${best ? ' class="tb-best"' : ''}><strong>${percent(rate)}</strong><small>${row.detected} / ${row.total}</small></td><td${row.iou >= 0.5 ? ' class="tb-best"' : ''}><strong>${row.iou.toFixed(3)}</strong></td><td class="tb-note">${escape(row.note)}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}

function faceTable(group) {
  return `<div class="tb-scroll"><table><thead><tr><th>方法</th><th>换脸检出</th><th>真实误报</th><th>无脸覆盖</th><th>说明</th></tr></thead><tbody>${group.rows.map((row) => {
    const recall = row.recall / row.recallTotal;
    const alarm = row.falseAlarm / row.falseTotal;
    const best = row.featured;
    return `<tr${best ? ' class="tb-ours"' : ''}><th>${escape(row.name)}</th><td${recall >= 0.8 ? ' class="tb-best"' : ''}><strong>${percent(recall)}</strong><small>${row.recall} / ${row.recallTotal}</small></td><td${alarm <= 0.2 ? ' class="tb-best"' : ''}><strong>${percent(alarm)}</strong><small>${row.falseAlarm} / ${row.falseTotal}</small></td><td>${escape(row.coverage)}</td><td class="tb-note">${escape(row.note)}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}

export function renderTamperBenchmark(data = tamperComparison) {
  const [inpaint, face] = data.groups;
  return `<section class="tb-benchmark" aria-labelledby="tb-benchmark-title"><header><span>局部篡改 · 效果评测</span><h2 id="tb-benchmark-title">篡改识别对比</h2><p>同一批图片分别送本地模型与外部接口，比较检出能力与定位精度。</p></header><div class="tb-meta"><span>评测 ${escape(data.updated)}</span><span>${escape(inpaint.dataset)}</span><span>同图同任务对照</span></div><div class="tb-block"><h3>${escape(inpaint.title)}</h3><p class="tb-sub">${escape(inpaint.note)}</p>${inpaintTable(inpaint)}</div><div class="tb-stats"><div><strong>0.656</strong><span>检出样本定位 IoU</span></div><div><strong>10 倍</strong><span>检出率高于对比接口</span></div><div><strong>87.5%</strong><span>可评分换脸检出率</span></div></div><div class="tb-block"><h3>${escape(face.title)}</h3><p class="tb-sub">${escape(face.note)}</p>${faceTable(face)}</div><details class="tb-details"><summary>数据来源与评测口径</summary><p>${escape(data.scope)}</p><p>外部接口为同一批图片的实测结果，包含参数探明与额度限制过程；本地模型分数为未校准信号，定位 IoU 按像素级真值计算。</p></details></section>`;
}

export const tamperBenchmarkCss = `.tb-benchmark{margin-top:48px;padding-top:28px;border-top:1px solid #ece7f3}.tb-benchmark>header{text-align:center;max-width:800px;margin:0 auto 24px}.tb-benchmark>header>span{font-size:11px;letter-spacing:2px;color:#8a6cab}.tb-benchmark h2{font-size:28px;color:#30283f;margin:10px 0 12px}.tb-benchmark>header p{font-size:13px;color:#7b7486;line-height:1.9}.tb-meta{display:flex;flex-wrap:wrap;justify-content:center;gap:10px;margin-bottom:22px}.tb-meta span{background:#f1ecf9;color:#7455a0;border-radius:20px;padding:7px 13px;font-size:12px}.tb-block{background:white;border:1px solid #e9e6ef;border-radius:18px;padding:22px;margin-bottom:18px;box-shadow:0 8px 30px #34205406}.tb-block h3{font-size:16px;color:#3b3150;margin:0 0 6px}.tb-sub{font-size:12px;color:#8b8398;margin:0 0 14px}.tb-scroll{overflow:auto}.tb-benchmark table{width:100%;min-width:620px;border-collapse:collapse;font-size:13px}.tb-benchmark th,.tb-benchmark td{padding:14px 12px;text-align:center;border-top:1px solid #efedf3;font-weight:400;color:#655f70}.tb-benchmark thead th{background:#f7f5fa;color:#40374f;font-weight:600}.tb-benchmark tbody th{text-align:left;color:#40374f;font-weight:500}.tb-benchmark td small{display:block;color:#91899a;font-size:11px;margin-top:4px}.tb-ours{background:#faf7ff}.tb-best strong{color:#5f3f8f;font-weight:750}.tb-note{color:#8b8398;font-size:11px;text-align:left}.tb-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:6px 0 22px}.tb-stats>div{padding:20px 12px;text-align:center;background:linear-gradient(135deg,#f4effa,#fff);border:1px solid #e9e0f4;border-radius:14px}.tb-stats strong{display:block;color:#76509f;font-size:26px}.tb-stats span{display:block;font-size:12px;color:#8b7d9c;margin-top:8px}.tb-details{border-top:1px solid #ece7f3;padding-top:14px;color:#6f7686;font-size:12px;line-height:1.9}.tb-details summary{cursor:pointer;color:#7455a0;font-weight:600}@media(max-width:600px){.tb-benchmark h2{font-size:23px}.tb-stats{grid-template-columns:1fr}.tb-block{padding:16px}}`;
