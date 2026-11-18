import { icon } from './icons.js';
import { imageBenchmarkRows } from './modules/image/general/benchmark-data.js';
import { documentBenchmark } from './modules/image/documents/benchmark-data.js';

// Text and image Tencent rows are transcribed from the owner's comparison images.
const textGenerators = ['Claude', 'Gemini', 'ChatGPT', 'Qwen', 'LLaMA'];
const textMethods = [
  { name: '智鉴', scores: [93.39, 96.86, 93.47, 99.58, 96.51], mean: 95.96 },
  { name: 'Binoculars', scores: [92.20, 96.41, 92.56, 99.51, 96.34], mean: 95.41 },
  { name: 'Fast-DetectGPT', scores: [91.89, 96.51, 92.78, 99.47, 93.94], mean: 94.92 },
  { name: '腾讯朱雀', scores: [90.56, 93.87, 80.74, 96.21, 94.63] },
  { name: 'SpecDetect', scores: [84.46, 90.51, 80.62, 97.08, 91.59], mean: 88.85 },
];
const imageMethods = ['智鉴', '腾讯朱雀', 'PGC', 'PROBE', 'SAFE'];
const tencentImageScores = new Map([
  ['HunyuanImage 3.0', 88.86], ['Seedream 4.0', 26.46], ['Imagen 4.0', 27.31], ['Qwen-Image', 19.63],
  ['GPT-Image 1.5', 47.32], ['Kling 2.1', 17.29], ['GLM-Image', 36.51], ['Nano Banana 2.0', 10.26],
]);
const portalImageRows = imageBenchmarkRows.map(([label, ours, ...baselines]) => [label, ours, tencentImageScores.get(label), ...baselines]);
const mean = values => values.reduce((total, value) => total + Math.round(value * 100), 0) / (values.length * 100);
const formatter = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const percentage = value => `${formatter.format(value)}%`;
const textMean = method => method.mean ?? mean(method.scores);
const tableVenues = { Binoculars: 'ICML 2024', 'Fast-DetectGPT': 'ICLR 2024', PGC: 'ICML 2026', PROBE: 'ICML 2026', SAFE: 'KDD 2025' };
const textRows = textGenerators.map((generator, index) => [generator, ...textMethods.map(method => method.scores[index])]);
const countLeads = rows => rows.filter(([, ours, ...others]) => ours >= Math.max(...others)).length;
const imageMeans = imageMethods.map((_, index) => mean(portalImageRows.map(row => row[index + 1])));

const benchmarks = [
  {
    key: 'text',
    icon: 'text',
    label: '文本生成检测',
    dataset: '历史文本评测 · 5 类生成模型',
    headline: percentage(textMethods[0].mean),
    metric: '平均 AUROC',
    result: `在表内 5/5 个子集中领先，平均高于最强列出基线 ${(textMethods[0].mean - textMethods[1].mean).toFixed(2)} 个百分点。`,
    chartLabel: '各方法平均 AUROC',
    methods: textMethods.map(method => ({ name: method.name, value: textMean(method), label: percentage(textMean(method)) })),
    columns: ['生成模型', ...textMethods.map(method => method.name)],
    rows: [...textRows, ['平均', ...textMethods.map(textMean)]].map(([label, ...scores]) => ({
      label, values: scores.map(percentage), ours: 0, winners: scores.map(score => score === Math.max(...scores)),
    })),
    notes: '旧版文本评测表按生成模型分组。腾讯朱雀一列来自本次提供的对比材料。AUROC 衡量跨阈值的区分能力，原表未给出样本量和数据版本。',
  },
  {
    key: 'image',
    icon: 'image',
    label: '图像生成检测',
    dataset: 'Qwen-Image-Bench · 8 个生成子集',
    headline: percentage(imageMeans[0]),
    metric: '平均检出率（TPR）',
    result: `在表内 ${countLeads(portalImageRows)}/8 个生成子集中领先或并列领先。`,
    chartLabel: '各方法八子集平均检出率',
    methods: imageMethods.map((name, index) => ({
      name, value: imageMeans[index], label: percentage(imageMeans[index]),
    })),
    columns: ['生成模型', ...imageMethods],
    rows: [...portalImageRows, ['平均', ...imageMeans]].map(([label, ...scores]) => ({
      label, values: scores.map(percentage), ours: 0, winners: scores.map(score => score === Math.max(...scores)),
    })),
    notes: '腾讯朱雀一列来自本次对比材料，其余列沿用项目历史本地评测。TPR 统计生成图的检出情况，原表未给出样本量、误报率和统一阈值设置。',
    source: { href: 'https://huggingface.co/datasets/Qwen/Qwen-Image-Bench', label: '查看图像数据集' },
  },
  {
    key: 'documents',
    icon: 'report',
    label: '票据一致性核验',
    dataset: '公开合成票据 · 8 份英文 PDF',
    headline: `${documentBenchmark.summary.agent.correct}/${documentBenchmark.samples}`,
    metric: '本次试测判断正确',
    result: `${documentBenchmark.summary.agent.detected}/${documentBenchmark.positive} 份异常检出，${documentBenchmark.summary.agent.normal}/${documentBenchmark.negative} 份正常材料保留。`,
    chartLabel: '各流程判断正确数',
    methods: documentBenchmark.methods.map(method => ({
      name: method.title,
      value: documentBenchmark.summary[method.id].correct / documentBenchmark.samples * 100,
      label: `${documentBenchmark.summary[method.id].correct}/${documentBenchmark.samples}`,
    })),
    columns: ['流程', '正确数', '异常检出', '正常保留', '无法判断'],
    rows: documentBenchmark.methods.map(method => {
      const result = documentBenchmark.summary[method.id];
      return {
        label: method.title, ownRow: method.id === 'agent',
        values: [`${result.correct}/${documentBenchmark.samples}`, `${result.detected}/${documentBenchmark.positive}`, `${result.normal}/${documentBenchmark.negative}`, result.abstained],
      };
    }),
    notes: '2026-11-06 小样本试测：4 份异常和 4 份正常文件使用同一批 OCR 输出。比较的是核验流程，范围为单份票据的金额一致性。',
    source: { href: 'https://github.com/DrewKraken/invoice-extraction-benchmark/tree/835afa049c42b84bb618e54cf3ec2423ccaa48a5', label: '查看票据数据集' },
  },
];

function renderPanel(item, active) {
  return `<div role="tabpanel" id="portal-bench-${item.key}" aria-labelledby="portal-tab-${item.key}" tabindex="0" ${active ? '' : 'hidden'}>
    <div class="portal-bench-summary">
      <div class="portal-bench-metric">
        <p>${item.dataset}</p>
        <strong>${item.headline}</strong>
        <span>${item.metric}</span>
        <p>${item.result}</p>
      </div>
      <div class="portal-bench-chart">
        <h3>${item.chartLabel}</h3>
        <ul aria-label="${item.chartLabel}">${item.methods.map((method, index) => `
          <li class="${index === 0 ? 'portal-bench-first' : ''}">
            <span>${method.name}</span>
            <span class="portal-bench-bar" aria-hidden="true"><i style="--value:${method.value}%"></i></span>
            <strong>${method.label}</strong>
          </li>`).join('')}</ul>
      </div>
    </div>
    <div class="portal-bench-details">
      <h3>逐项对比</h3>
      <p class="portal-bench-swipe">可横向滑动查看全部方法。</p>
      <div class="portal-bench-scroll" role="region" tabindex="0" aria-label="${item.label}评测表">
        <table aria-label="${item.label}评测表">
          <thead><tr>${item.columns.map((column, index) => `<th scope="col" ${index === 1 && item.key !== 'documents' ? 'class="portal-bench-ours"' : ''}>${column}${tableVenues[column] ? `<small>${tableVenues[column]}</small>` : ''}</th>`).join('')}</tr></thead>
          <tbody>${item.rows.map(row => `<tr ${row.ownRow ? 'class="portal-bench-ours"' : ''}>
            <th scope="row">${row.label}</th>${row.values.map((value, index) => `<td class="${row.ours === index ? 'portal-bench-ours' : ''} ${row.winners?.[index] ? 'portal-bench-winner' : ''}">${value}</td>`).join('')}
          </tr>`).join('')}</tbody>
        </table>
      </div>
    </div>
    <p class="portal-bench-note">${item.notes}${item.source ? ` <a href="${item.source.href}" target="_blank" rel="noopener">${item.source.label}</a>` : ''}</p>
  </div>`;
}

export function renderBenchmarks() {
  return `<section class="portal-wrap portal-benchmarks" id="portal-benchmarks" tabindex="-1" aria-labelledby="portal-benchmark-title">
    <header class="portal-section-heading" data-reveal>
      <div><h2 id="portal-benchmark-title">检测性能对比</h2><p>查看不同生成模型和材料上的历史结果。</p></div>
      <a class="portal-text-link" href="#portal-comparison" data-portal-scroll>查看平台能力对比 ${icon('arrow')}</a>
    </header>
    <div class="portal-bench-shell" data-reveal>
      <div class="portal-bench-tabs" role="tablist" aria-label="选择评测类型">
        ${benchmarks.map((item, index) => `<button type="button" role="tab" id="portal-tab-${item.key}" data-benchmark-tab="${item.key}" aria-controls="portal-bench-${item.key}" aria-selected="${index === 0}" tabindex="${index === 0 ? 0 : -1}">${icon(item.icon)} ${item.label}</button>`).join('')}
      </div>
      ${benchmarks.map((item, index) => renderPanel(item, index === 0)).join('')}
    </div>
  </section>`;
}

function activateBenchmark(root, key, focus = false) {
  const tabs = [...root.querySelectorAll('[data-benchmark-tab]')];
  const active = tabs.find(tab => tab.dataset.benchmarkTab === key);
  if (!active) return;
  for (const tab of tabs) {
    const selected = tab === active;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    root.querySelector('#' + tab.getAttribute('aria-controls')).hidden = !selected;
  }
  if (focus) active.focus();
}

export function bindBenchmarks(root) {
  const tabs = [...root.querySelectorAll('[data-benchmark-tab]')];
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activateBenchmark(root, tab.dataset.benchmarkTab));
    tab.addEventListener('keydown', event => {
      const step = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
      const target = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1)
        : step ? tabs[(index + step + tabs.length) % tabs.length] : null;
      if (!target) return;
      event.preventDefault();
      activateBenchmark(root, target.dataset.benchmarkTab, true);
    });
  });
}
