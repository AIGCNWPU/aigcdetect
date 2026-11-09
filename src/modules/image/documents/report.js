// 2.3 documents review report: model builder + PDF/Word export entry points.
// Verdict first, then issue list, material overview, per-material evidence and
// smart-review summary — mirroring the workspace reading order.

import { createReport, section, banner, kv, table, list, images, paragraph } from '../report/model.js';
import { renderReportPdf, formatReportTime } from '../report/pdf.js';
import { downloadReportWord } from '../report/word.js';
import { loadReportPdfRuntime, decodeReportImage, downloadReportBytes } from '../report/runtime.js';

const objectiveNames = { invoice_review: '发票核验', procurement_review: '采购履约核验', payment_review: '收付款核对', reimbursement_review: '报销材料核验', identity_review: '身份材料核对' };
const stageNames = { mirror: '整图 AI 检测', seed: '局部篡改定位', ocr: '文字提取', rules: '内容规则', explanation: '智能复核' };
const previewPattern = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
const evidenceOf = (ref) => {
  const key = ref.key ? String(ref.key) : '';
  const value = ref.value !== undefined && ref.value !== null && ref.value !== '' ? String(ref.value) : (ref.source?.observedText || '');
  const page = ref.source?.page ? `（第 ${ref.source.page} 页）` : '';
  return [key, value, page].filter(Boolean).join('：');
};

function materialPreview(material, sourceFiles) {
  const pages = Array.isArray(material.pages) ? material.pages : [];
  const source = (sourceFiles || []).find((item) => item.id === material.id);
  return pages.map((page) => {
    const preview = previewPattern.test(page.previewDataUrl || '') ? page.previewDataUrl : (pages.length === 1 && source?.file?.type.startsWith('image/') ? source.preview : null);
    const regions = (page.regions || []).filter((region) => [region?.x, region?.y, region?.width, region?.height].every((value) => Number.isFinite(value) && value >= 0 && value <= 1));
    return { page: page.page || page.number || 1, preview, regions };
  }).filter((entry) => entry.preview);
}

function stageSummary(material) {
  const stages = material.stages || {};
  const summary = [];
  for (const [key, name] of Object.entries(stageNames)) {
    const stage = stages[key];
    if (!stage) continue;
    if (key === 'mirror') {
      const score = Number.isFinite(stage.score) ? `分数 ${percent(stage.score)}` : '';
      summary.push(`${name}：${stage.status === 'completed' ? `已完成${score ? `（${score}）` : ''}` : (stage.reason || '未完成')}`);
    } else if (key === 'seed') summary.push(`${name}：${stage.status === 'completed' ? `已完成${(stage.regions || stage.candidates || []).length ? `（${(stage.regions || stage.candidates || []).length} 处候选）` : ''}` : (stage.reason || '未完成')}`);
    else summary.push(`${name}：${stage.status === 'completed' ? '已完成' : (stage.reason || '未完成')}`);
  }
  return summary;
}

const percent = (value) => (Number.isFinite(value) ? `${(value * 100).toFixed(1)}` : null);

function checksOf(data) {
  const materials = Array.isArray(data?.materials) ? data.materials : [];
  const perMaterial = materials.flatMap((material) => (material.checks || []).map((check) => ({ ...check, materialId: material.id })));
  const reviewChecks = [...(data?.review?.candidates || []), ...(data?.review?.checks || data?.review?.results || [])];
  return { perMaterial, reviewChecks, materials };
}

function warningItems(data) {
  return (data?.presentation?.warnings || []).filter((item) => !/^visual-|^origin-|^semantic-/.test(item.id || ''));
}

export function buildDocumentsReportModel(data, sourceFiles = [], { generatedAt = new Date().toISOString() } = {}) {
  const { perMaterial, reviewChecks, materials } = checksOf(data);
  const names = Object.fromEntries(materials.map((material) => [material.id, material.name]));
  const review = data?.review || {};
  const coreId = review.plan?.coreMaterialId || materials[0]?.id;
  const issues = [];
  const passes = [];
  const unknowns = [];
  for (const check of [...perMaterial, ...reviewChecks]) {
    const materialName = names[check.materialId] || '跨材料核验';
    const detail = [check.reason ? String(check.reason) : '', ...(check.evidence || []).map(evidenceOf)].filter(Boolean).join('；');
    if (check.status === 'FAIL') issues.push({ title: `${materialName} · ${check.rule || '核验项'}`, detail: detail || '票面内容存在矛盾', tone: 'danger' });
    else if (check.status === 'PASS') passes.push({ title: `${materialName} · ${check.rule || '核验项'}`, detail, tone: 'ok' });
    else unknowns.push({ title: `${materialName} · ${check.rule || '核验项'}`, detail: detail || '信息不足待确认', tone: 'warn' });
  }
  for (const warning of warningItems(data)) issues.push({ title: warning.title || warning.id || '需关注事项', detail: warning.detail || warning.message || '', tone: 'warn' });
  const issueCount = issues.length, passCount = passes.length;
  const verdictTitle = issueCount ? `发现 ${issueCount} 项需要核对的问题` : '未发现需要核对的问题';
  const verdictTone = issueCount ? 'danger' : 'ok';
  const objective = objectiveNames[review.plan?.objective] || review.plan?.objective || '材料核验';

  const sections = [];
  sections.push(section('需要关注的问题', [list(issues.slice(0, 24))], `${Math.min(issueCount, 24)} / ${issueCount} 项`));

  const overviewRows = materials.map((material) => {
    const mirror = material.stages?.mirror, seed = material.stages?.seed;
    const failCount = (material.checks || []).filter((check) => check.status === 'FAIL').length;
    return {
      id: material.id,
      tone: failCount ? 'danger' : 'ok',
      cells: [
        material.name || material.id,
        material.id === coreId ? '核心' : '辅助',
        mirror?.status === 'completed' ? (mirror.score >= 0.5 ? '发现生成线索' : '未见明显生成线索') : '未完成',
        seed?.status === 'completed' ? `${(seed.regions || seed.candidates || []).length} 处候选` : '未完成',
        failCount ? `${failCount} 项异常` : (material.checks || []).length ? '未见异常' : '无规则结论',
      ],
    };
  });
  sections.push(section('材料总览', [table([{ title: '材料', width: 158 }, { title: '角色', width: 42 }, { title: '整图 AI 检测', width: 110 }, { title: '篡改定位', width: 88 }, { title: '内容结论', width: 123 }], overviewRows)]));

  for (const material of materials) {
    const blocks = [];
    const previews = materialPreview(material, sourceFiles);
    if (previews.length) blocks.push(images(previews.slice(0, 4).map((entry) => ({ src: entry.preview, caption: `第 ${entry.page} 页${entry.regions.length ? ` · ${entry.regions.length} 处疑似修改位置` : ''}`, regions: entry.regions })), { layout: previews.length > 1 ? 'pair' : 'single' }));
    const fields = (material.fields || []).slice(0, 30).map((field) => ({ id: field.id, cells: [String(field.key || ''), String(field.value ?? ''), field.source?.page ? `第 ${field.source.page} 页` : '—', Number.isFinite(field.confidence) ? percent(field.confidence) : '—'] }));
    if (fields.length) blocks.push(table([{ title: '字段', width: 105 }, { title: '识别内容', width: 220 }, { title: '页码', width: 48 }, { title: '识别置信', width: 78 }], fields, { kind: 'fields' }));
    const stageLines = stageSummary(material);
    if (stageLines.length) blocks.push(list(stageLines.map((line) => ({ title: line, tone: 'neutral' }))));
    sections.push(section(`材料 · ${material.name || material.id}${material.id === coreId ? '（核心）' : ''}`, blocks));
  }

  const aiReview = data?.presentation?.aiReview || { status: 'not_run' };
  if (aiReview.status === 'completed') {
    const findings = (aiReview.findings || []).map((finding) => ({ title: finding.title || finding.id || '复核事项', detail: [finding.detail, finding.summary, finding.message].filter(Boolean).join('；'), tone: finding.verdict === 'issues_found' || finding.status === 'issues_found' ? 'danger' : finding.verdict === 'reasonable' || finding.status === 'reasonable' ? 'ok' : 'warn' }));
    sections.push(section('智能复核', [paragraph(aiReview.summary || ''), ...(findings.length ? [list(findings.slice(0, 12))] : [])]));
  }

  sections.push(section('核验范围与说明', [kv([
    ['核验目的', objective],
    ['核心材料', names[coreId] || '未指定'],
    ['材料数量', `${materials.length} 份`],
    ['问题 / 通过 / 待确认', `${issueCount} / ${passCount} / ${unknowns.length} 项`],
  ]), ...(Array.isArray(data?.limitations) && data.limitations.length ? [list(data.limitations.map((note) => ({ title: note, tone: 'neutral' })))] : [])]));

  const footerNotes = ['本报告由 VERITAS 智鉴在本地生成，汇总实际返回的核验结果。', '整图与篡改分数为未校准模型信号，不是真实概率；疑似修改位置需结合原图与字段复核。', '本报告不等于税务查验或身份真实性核验；完整范围说明见正文与平台页面。'];
  return createReport({
    title: '材料核验报告',
    subtitle: `${objective} · ${materials.length} 份材料`,
    verdict: { title: verdictTitle, tone: verdictTone, scoreText: `通过 ${passCount} 项`, detail: `待确认 ${unknowns.length} 项 · 核验目的：${objective}` },
    generatedAt,
    sections,
    footerNotes,
  });
}

export async function exportDocumentsReport(data, sourceFiles = [], format = 'pdf', { signal } = {}) {
  const model = buildDocumentsReportModel(data, sourceFiles);
  const stamp = formatReportTime(model.generatedAt, { filename: true });
  const safeName = String(model.subtitle).replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
  if (format === 'word') {
    downloadReportWord(model, `智鉴材料核验报告-${safeName}-${stamp}.doc`);
    return { kind: 'word' };
  }
  const runtime = await loadReportPdfRuntime();
  const bytes = await renderReportPdf(model, { ...runtime, decodeImage: (src, options) => decodeReportImage(src, { ...options, signal }), signal });
  downloadReportBytes(bytes, `智鉴材料核验报告-${safeName}-${stamp}.pdf`);
  return { kind: 'pdf', bytes: bytes.length };
}
