// Capability matrix for the materials workspace: what each option can answer.
// Scores, sample counts and scoring notes stay in docs/image-workstream/market-benchmark-20261110.md;
// the page states capability support only.

export const capabilityComparison = {
  title: '全能助手 · 能力展示',
  badge: '能力矩阵 · 强大而全面的核验助手',
  rows: [
    { id: 'agent', name: '智鉴', featured: true, content: '支持', cross: '支持（语义）', tamper: '支持（区域）', external: '不需要' },
    { id: 'method1', name: '方法1', featured: false, content: '不判定', cross: '不支持', tamper: '不支持', external: '不需要' },
    { id: 'method2', name: '方法2', featured: false, content: '不判定', cross: '仅文字差异', tamper: '不支持', external: '不需要' },
    { id: 'method3', name: '方法3', featured: false, content: '不判定', cross: '不支持', tamper: '不支持', external: '需要税务数据源' },
  ],
};

const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

export function renderCapabilityBenchmark(data = capabilityComparison) {
  return `<section class="cb-benchmark" aria-labelledby="cb-benchmark-title"><header><h2 id="cb-benchmark-title">${escape(data.title)}</h2><p class="cb-badge">${escape(data.badge)}</p></header><div class="cb-scroll"><table><thead><tr><th>方法</th><th>材料内容知识核查</th><th>跨材料核对</th><th>篡改定位</th><th>外部数据源</th></tr></thead><tbody>${data.rows.map((row) => `<tr${row.featured ? ' class="cb-ours"' : ''}><th>${escape(row.name)}</th><td${row.content === '支持' ? ' class="cb-best"' : ''}>${escape(row.content)}</td><td${row.cross.startsWith('支持') ? ' class="cb-best"' : ''}>${escape(row.cross)}</td><td${row.tamper.startsWith('支持') ? ' class="cb-best"' : ''}>${escape(row.tamper)}</td><td${row.external === '不需要' ? ' class="cb-best"' : ''}>${escape(row.external)}</td></tr>`).join('')}</tbody></table></div></section>`;
}

export const capabilityBenchmarkCss = `.cb-benchmark{margin-top:34px;border:1px solid #e6e1f1;border-radius:24px;padding:32px;background:linear-gradient(145deg,#faf7ff,#fff 50%);color:#25304b}.cb-benchmark>header{text-align:center;margin-bottom:22px}.cb-benchmark h2{font-size:28px;margin:10px}.cb-badge{display:inline-block;margin:0;background:#f0edf8;color:#6e42ae;border-radius:20px;padding:8px 16px;font-size:12px;letter-spacing:.04em}.cb-scroll{overflow:auto}.cb-benchmark table{width:100%;min-width:620px;border-collapse:collapse;background:white;font-size:13px}.cb-benchmark th,.cb-benchmark td{padding:16px 12px;text-align:center;border-bottom:1px solid #ececf4;font-weight:400;color:#4a5570}.cb-benchmark thead th{background:#f6f4fa;font-weight:600}.cb-benchmark tbody th{text-align:left;font-weight:500}.cb-ours{background:#faf7ff}.cb-best{color:#6e42ae;font-weight:700}@media(max-width:600px){.cb-benchmark{padding:18px}.cb-benchmark h2{font-size:24px}}`;
