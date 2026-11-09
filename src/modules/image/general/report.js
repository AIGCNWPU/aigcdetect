// 2.1 general-image report: model builder + PDF/Word export entry points.
// Reading order follows the workspace page: verdict first, then evidence
// images, per-capability analysis, provider declarations and file facts.

import { createReport, section, banner, kv, table, list, images, paragraph } from '../report/model.js';
import { renderReportPdf, formatReportTime } from '../report/pdf.js';
import { downloadReportWord } from '../report/word.js';
import { loadReportPdfRuntime, decodeReportImage, downloadReportBytes } from '../report/runtime.js';

const credentialNames = { absent: '未发现内容凭证', valid: '内容绑定验证通过', trusted: '内容凭证验证通过', invalid: '内容凭证异常', unverifiable: '暂无法验证凭证', unavailable: '凭证校验暂不可用', unknown: '凭证状态待确认' };
const verdictTitles = { likely_ai: '疑似AI生成', no_obvious_ai: '未见明显AI生成' };
const percent = (value) => (Number.isFinite(value) ? `${(value * 100).toFixed(1)}` : null);

function forensicsOf(result) {
  return result?.forensics || result?.diagnostics?.forensics || {};
}

function signalOf(tamper) {
  if (!tamper || tamper.status !== 'completed') return '未完成';
  if (tamper.signal === 'suspicious') return '发现疑似局部篡改线索';
  if (tamper.signal === 'no_obvious_signal') return '未发现明显局部篡改线索';
  return '未得出明确结论';
}

export function buildGeneralReportModel(item, { generatedAt = new Date().toISOString() } = {}) {
  const result = item?.result || {};
  const diagnostics = result.diagnostics || {};
  const forensics = forensicsOf(result);
  const face = forensics.face || {};
  const source = forensics.source || {};
  const tamper = forensics.tamper || {};
  const layers = diagnostics.layers || {};
  const declarations = diagnostics.sourceDeclarations || {};
  const credentials = diagnostics.credentials || {};
  const score = Number.isFinite(result.score) ? result.score : null;
  const fileName = item?.name || item?.file?.name || '未命名图片';
  const aiDeclared = (declarations.records || []).some((record) => String(record?.fields?.Label) === '1');
  const verdictTitle = aiDeclared ? 'AI 生成（文件标识）' : (verdictTitles[result.verdict] || '未得出结论');
  const verdictTone = result.verdict === 'likely_ai' ? 'danger' : result.verdict === 'no_obvious_ai' ? 'ok' : 'neutral';

  const capabilityRows = [];
  capabilityRows.push({ id: 'whole', tone: result.verdict === 'likely_ai' ? 'danger' : 'ok', cells: ['整图 AI 检测', result.verdict === 'likely_ai' ? '发现生成线索' : '未发现明显生成线索', score === null ? '—' : `${percent(score)} / 100`, result.coverage || '整图'] });
  if (tamper.status) capabilityRows.push({ id: 'tamper', tone: tamper.status !== 'completed' ? 'neutral' : tamper.signal === 'suspicious' ? 'warn' : 'ok', cells: ['局部篡改检测', signalOf(tamper), tamper.status === 'completed' && Number.isFinite(tamper.score) ? `${percent(tamper.score)}（阈值 ${percent(tamper.threshold) ?? '—'}）` : '—', tamper.status === 'completed' ? '全图分析' : tamper.reason || '未完成'] });
  if (face.status) capabilityRows.push({ id: 'face', tone: face.status !== 'completed' ? 'neutral' : (face.faces || []).some((entry) => entry.signal === 'suspicious') ? 'warn' : 'ok', cells: ['人像伪造分析', face.status !== 'completed' ? '未完成' : (face.analyzedFaceCount || 0) === 0 ? '未检出可分析人脸' : (face.faces || []).some((entry) => entry.signal === 'suspicious') ? '发现疑似伪造人脸' : '未见明显伪造线索', face.status === 'completed' ? `分析 ${face.analyzedFaceCount || 0} 张` : '—', face.status === 'completed' ? '仅覆盖人脸区域' : face.reason || '未完成'] });
  if (source.status) capabilityRows.push({ id: 'source', tone: 'neutral', cells: ['生成来源分析', source.status !== 'completed' ? '未完成' : (source.candidates || []).length ? `候选：${(source.candidates[0].source || '').replace(/_/g, ' ')}` : '无匹配候选', source.status === 'completed' ? `Top-${Math.min(3, (source.candidates || []).length)} 候选` : '—', '闭集参考，非确定归属'] });

  const sections = [];
  const evidenceImages = [];
  if (layers.original || item.url) evidenceImages.push({ src: layers.original || item.url, caption: '检测原图' });
  if (layers.aiFeatures) evidenceImages.push({ src: layers.aiFeatures, caption: 'AI 特征分布（窗口分类，非像素分割）' });
  else if (layers.sensitivity) evidenceImages.push({ src: layers.sensitivity, caption: '判定关注区域' });
  if (tamper.overlay && (tamper.signal === 'suspicious' || tamper.status === 'completed')) evidenceImages.push({ src: tamper.overlay, caption: '局部篡改线索叠加' });
  if (evidenceImages.length) sections.push(section('检测图像', [images(evidenceImages.slice(0, 4), { layout: evidenceImages.length === 1 ? 'single' : 'pair' })]));
  sections.push(section('分项检测结果', [table([{ title: '检测项', width: 110 }, { title: '结论', width: 168 }, { title: '数值', width: 128 }, { title: '范围说明', width: 105 }], capabilityRows)]));

  const faceItems = (face.faces || []).map((entry, index) => ({
    title: `第 ${index + 1} 张人脸 · ${entry.signal === 'suspicious' ? '疑似伪造' : '未见明显伪造线索'}`,
    detail: `伪造评分 ${percent(entry.score) ?? '—'}（阈值 ${percent(face.threshold) ?? '—'}）`,
    tone: entry.signal === 'suspicious' ? 'warn' : 'ok',
  }));
  if (face.status === 'completed' && faceItems.length) sections.push(section('人像伪造分析', [paragraph(face.summary || ''), list(faceItems)]));

  const sourceItems = (source.candidates || []).slice(0, 3).map((candidate, index) => ({
    title: `候选 ${index + 1}：${(candidate.source || '').replace(/_/g, ' ')}`,
    detail: `匹配分数 ${percent(candidate.score) ?? '—'}`,
    tone: index === 0 ? 'neutral' : 'neutral',
  }));
  if (source.status === 'completed' && sourceItems.length) sections.push(section('生成来源候选', [paragraph(source.summary || '已知生成器闭集参考，未知来源与混合编辑暂不能确定归属。'), list(sourceItems)]));

  const providerRows = (diagnostics.providerChecks?.checks || []).map((check) => ({ id: check.provider, tone: check.status === 'evidence_found' ? 'warn' : 'neutral', cells: [check.name || check.provider, check.status === 'evidence_found' ? '发现生成来源声明' : '未发现相关声明', (check.declarations || []).map((entry) => `${entry.role}=${entry.value}（${entry.location}）`).join('；') || '—'] }));
  if (providerRows.length || declarations.status) sections.push(section('文件标识与来源声明', [
    ...(providerRows.length ? [table([{ title: '生成平台', width: 120 }, { title: '声明状态', width: 130 }, { title: '声明内容', width: 261 }], providerRows)] : []),
    ...(declarations.summary ? [paragraph(declarations.summary)] : []),
  ]));

  const facts = [
    ['文件名', fileName],
    ['格式 / 尺寸', `${diagnostics.format || '—'} · ${(diagnostics.dimensions || []).join(' × ') || '—'}`],
    ['内容凭证（C2PA）', credentialNames[credentials.status] || credentialNames.unknown],
    ['文件指纹（SHA-256）', diagnostics.sha256 || '—'],
  ];
  const meta = diagnostics.metadata || {};
  for (const [key, label] of [['make', '设备品牌'], ['model', '设备型号'], ['software', '处理软件']]) if (meta[key]) facts.push([label, String(meta[key])]);
  sections.push(section('文件信息', [kv(facts)]));

  const footerNotes = ['本报告由 VERITAS 智鉴在本地生成，汇总实际返回的检测结果。', '各检测分数为未校准模型信号，不是真实概率；AI 特征分布为窗口分类结果，不代表像素级分割。', '生成来源候选为闭集参考；文件标识声明未经身份验证，不能单独作为定性依据。'];
  return createReport({
    title: '通用图片 AI 检测报告',
    subtitle: fileName,
    verdict: { title: verdictTitle, tone: verdictTone, scoreText: score === null ? '' : `${percent(score)} / 100`, detail: result.summary || '' },
    generatedAt,
    sections,
    footerNotes,
  });
}

export async function exportGeneralReport(item, format = 'pdf', { signal } = {}) {
  const model = buildGeneralReportModel(item);
  const stamp = formatReportTime(model.generatedAt, { filename: true });
  const safeName = String(item?.name || item?.file?.name || 'image').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
  if (format === 'word') {
    downloadReportWord(model, `智鉴图片检测报告-${safeName}-${stamp}.doc`);
    return { kind: 'word' };
  }
  const runtime = await loadReportPdfRuntime();
  const bytes = await renderReportPdf(model, { ...runtime, decodeImage: (src, options) => decodeReportImage(src, { ...options, signal }), signal });
  downloadReportBytes(bytes, `智鉴图片检测报告-${safeName}-${stamp}.pdf`);
  return { kind: 'pdf', bytes: bytes.length };
}
