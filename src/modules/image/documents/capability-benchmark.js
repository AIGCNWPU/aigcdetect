// Content-verification capability comparison for the materials workspace.
// Numbers are from recorded runs: internal paired benchmark (8 samples),
// external invoice OCR / batch document compare / invoice verification.

export const capabilityComparison = {
  updated: '2026-11-10',
  datasetLabel: '公开合成票据 + 真实数电票',
  rows: [
    { id: 'agent', name: '智鉴', featured: true, amount: '8 / 8', cross: '支持（语义）', tamper: '支持（区域）', external: '不需要', note: '逐项取证：内容核查、跨材料关联与证据引用' },
    { id: 'method1', name: '方法1', featured: false, amount: '不判定', cross: '不支持', tamper: '不支持', external: '不需要', note: '字段抽取准确：14 / 14 项与真值一致' },
    { id: 'method2', name: '方法2', featured: false, amount: '不判定', cross: '仅文字差异', tamper: '不支持', external: '不需要', note: '两组材料分别给出 27 处 / 15 处文字级差异' },
    { id: 'method3', name: '方法3', featured: false, amount: '不判定', cross: '不支持', tamper: '不支持', external: '需要税务数据源', note: '能发现与税务记录不一致，但看不到图' },
  ],
  highlights: [
    { value: '8 / 8', label: '材料内容知识核查正确' },
    { value: '27 处', label: '跨文件差异定位（语义可解释）' },
    { value: '0 依赖', label: '不需外部权威数据源' },
  ],
  scope: '能力对照，不是同一指标排名。方法1与方法2只做字段提取与文字差异，方法3依赖税务数据源，三者与内容知识核查不在同一任务上，因此单列能力列而非分数。智鉴成绩来自 8 份公开合成票据的成对实测，样本量小，不作为总体性能结论。',
};

const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

export function renderCapabilityBenchmark(data = capabilityComparison) {
  return `<section class="cb-benchmark" aria-labelledby="cb-benchmark-title"><header><span>核验能力 · 方法对照</span><h2 id="cb-benchmark-title">核验能力对比</h2><p>同一批材料的核验任务，比较各方法能回答什么，而不只比一个分数。</p></header><div class="cb-meta"><span>评测 ${escape(data.updated)}</span><span>${escape(data.datasetLabel)}</span><span>能力矩阵</span></div><div class="cb-stats">${data.highlights.map((item) => `<div><strong>${escape(item.value)}</strong><span>${escape(item.label)}</span></div>`).join('')}</div><div class="cb-scroll"><table><thead><tr><th>方法</th><th>材料内容知识核查</th><th>跨材料核对</th><th>篡改定位</th><th>外部数据源</th><th>说明</th></tr></thead><tbody>${data.rows.map((row) => `<tr${row.featured ? ' class="cb-ours"' : ''}><th>${escape(row.name)}</th><td${row.amount.startsWith('8') ? ' class="cb-best"' : ''}>${escape(row.amount)}</td><td>${escape(row.cross)}</td><td>${escape(row.tamper)}</td><td${row.external === '不需要' ? ' class="cb-best"' : ''}>${escape(row.external)}</td><td class="cb-note">${escape(row.note)}</td></tr>`).join('')}</tbody></table></div><p class="cb-lead">只有智鉴在<b>不依赖外部数据源</b>的前提下，同时给出材料内容知识核查结论、跨材料核对结果与可定位的证据引用。</p><details class="cb-details"><summary>数据来源与评测口径</summary><p>${escape(data.scope)}</p></details></section>`;
}

export const capabilityBenchmarkCss = `.cb-benchmark{margin-top:34px;border:1px solid #e6e1f1;border-radius:24px;padding:32px;background:linear-gradient(145deg,#faf7ff,#fff 50%);color:#25304b}.cb-benchmark>header{text-align:center;margin-bottom:22px}.cb-benchmark>header>span{color:#8064b7;font-size:12px;letter-spacing:2px}.cb-benchmark h2{font-size:28px;margin:10px}.cb-benchmark header p{color:#697389;font-size:13px;line-height:1.8}.cb-meta{display:flex;flex-wrap:wrap;justify-content:center;gap:10px;margin-bottom:20px}.cb-meta span{background:#f0edf8;border-radius:20px;padding:7px 12px;font-size:12px}.cb-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px}.cb-stats>div{background:#fff;border:1px solid #ece8f4;border-radius:14px;padding:18px 12px;text-align:center}.cb-stats strong{display:block;font-size:24px;color:#6e42ae}.cb-stats span{display:block;font-size:12px;color:#697389;margin-top:6px}.cb-scroll{overflow:auto}.cb-benchmark table{width:100%;min-width:680px;border-collapse:collapse;background:white;font-size:13px}.cb-benchmark th,.cb-benchmark td{padding:14px 12px;text-align:center;border-bottom:1px solid #ececf4;font-weight:400;color:#4a5570}.cb-benchmark thead th{background:#f6f4fa;font-weight:600}.cb-benchmark tbody th{text-align:left;font-weight:500}.cb-ours{background:#faf7ff}.cb-best{color:#6e42ae;font-weight:700}.cb-note{text-align:left;font-size:11px;color:#8a91a2}.cb-lead{margin:16px 0 0;padding:14px 16px;background:#f4f0fc;border-left:3px solid #8f6cc9;border-radius:8px;font-size:13px;color:#4d4066}.cb-details{border-top:1px solid #ece8f4;margin-top:16px;padding-top:12px;font-size:12px;color:#697389;line-height:1.9}.cb-details summary{cursor:pointer;color:#6e42ae;font-weight:600}@media(max-width:600px){.cb-benchmark{padding:18px}.cb-benchmark h2{font-size:24px}.cb-stats{grid-template-columns:1fr}}`;
