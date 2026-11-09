import {
  collectNewsReportIssues,
  selectAiReportItems,
  summarizeReportIssues,
  summarizeUnscoredReasons,
  textReportIdentity,
} from './pdf-report.js';

const PDF_ASSETS = './public/vendor/refund-pdf/';
let runtimePromise;

function loadScript(file, globalName) {
  if (globalThis[globalName]) return Promise.resolve(globalThis[globalName]);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL(PDF_ASSETS + file, document.baseURI).href;
    script.onload = () => globalThis[globalName] ? resolve(globalThis[globalName]) : reject(new Error('PDF组件加载失败。'));
    script.onerror = () => { script.remove(); reject(new Error('PDF组件读取失败，请重试。')); };
    document.head.append(script);
  });
}

async function loadRuntime() {
  if (!runtimePromise) runtimePromise = (async () => {
    const [PDFLib, fontkit, response] = await Promise.all([
      loadScript('pdf-lib.min.js', 'PDFLib'),
      loadScript('fontkit.umd.min.js', 'fontkit'),
      fetch(new URL(PDF_ASSETS + 'NotoSansSC-Regular.ttf', document.baseURI)),
    ]);
    if (!response.ok) throw new Error('PDF中文字体读取失败，请重试。');
    return { PDFLib, fontkit, fontBytes: new Uint8Array(await response.arrayBuffer()) };
  })().catch(error => { runtimePromise = null; throw error; });
  return runtimePromise;
}

function safeTitle(value) {
  return String(value || '未命名').trim().replace(/[\\/:*?"<>|\u0000-\u001f]/gu, '_').replace(/\s+/gu, ' ').slice(0, 100) || '未命名';
}

function reportLabel(kind, scenario) {
  if (kind === 'ai') return 'AI检测报告';
  return scenario === 'novel' ? '重复与水稿检测报告' : '三审三校检测报告';
}

export function textReportFileName({ title, kind = 'ai', scenario = 'news' }) {
  return `${safeTitle(title)}-${reportLabel(kind, scenario)}.pdf`;
}

function percentage(value, digits = 1) {
  const number = Number(value);
  return `${(Number.isFinite(number) ? Math.max(0, Math.min(1, number)) * 100 : 0).toFixed(digits)}%`;
}

function dateText(value = new Date()) {
  try { return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'long', timeStyle: 'short' }).format(value); }
  catch { return new Date(value).toLocaleString('zh-CN'); }
}

function cleanText(value) {
  return String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/gu, '').replace(/\r\n?|\u2028|\u2029/gu, '\n').replace(/\t/gu, '    ');
}

export async function createTextPdfReport({ kind = 'ai', scenario = 'news', title, version, scope = '', result, generatedAt = new Date() }, { PDFLib, fontkit, fontBytes }) {
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const documentPdf = await PDFDocument.create();
  documentPdf.registerFontkit(fontkit);
  const cjk = await documentPdf.embedFont(fontBytes, { subset: false });
  const latin = await documentPdf.embedFont(StandardFonts.Helvetica);
  const latinBold = await documentPdf.embedFont(StandardFonts.HelveticaBold);
  const label = reportLabel(kind, scenario);
  const identity = textReportIdentity({ scenario, result, generatedAt });
  documentPdf.setTitle(`${title}-${label}`);
  documentPdf.setAuthor('VERITAS 智鉴');
  documentPdf.setCreator('VERITAS');
  documentPdf.setLanguage('zh-CN');
  documentPdf.setSubject(`${label} · ${identity.reportId}`);
  const created = new Date(generatedAt);
  if (Number.isFinite(created.getTime())) documentPdf.setCreationDate(created);

  const W = 595.28, H = 841.89, M = 42, CW = W - M * 2, TOP = H - 62, BOTTOM = 55;
  const colors = {
    ink: rgb(.09, .14, .22), muted: rgb(.43, .49, .57), blue: rgb(.03, .46, .91),
    line: rgb(.86, .90, .95), soft: rgb(.96, .98, 1), human: rgb(.26, .72, .51),
    suspected: rgb(.95, .71, .25), ai: rgb(.89, .37, .38), unscored: rgb(.66, .70, .75), white: rgb(1, 1, 1),
  };
  let page, y;
  const runs = (value, strong = false) => {
    const output = [];
    for (const character of cleanText(value)) {
      const font = /^[\x20-\x7e]$/u.test(character) ? (strong ? latinBold : latin) : cjk;
      const last = output.at(-1);
      if (last?.font === font) last.text += character;
      else output.push({ font, text: character });
    }
    return output;
  };
  const measure = (value, size, strong = false) => runs(value, strong).reduce((sum, run) => sum + run.font.widthOfTextAtSize(run.text, size), 0);
  const wrap = (value, size, width) => {
    const lines = [];
    for (const paragraph of cleanText(value).split('\n')) {
      let line = '';
      for (const token of paragraph.match(/[A-Za-z0-9][A-Za-z0-9._%/@+\/-]*|\s+|[^\s]/gu) || ['']) {
        if (measure(line + token, size) <= width) { line += token; continue; }
        if (line.trim()) { lines.push(line.trimEnd()); line = ''; }
        for (const character of token.trimStart()) {
          if (line && measure(line + character, size) > width) { lines.push(line); line = ''; }
          line += character;
        }
      }
      lines.push(line.trimEnd());
    }
    return lines;
  };
  const drawText = (value, x, top, { size = 9.5, color = colors.ink, strong = false } = {}) => {
    let cursor = x;
    for (const run of runs(value, strong)) {
      page.drawText(run.text, { x: cursor, y: top - size, font: run.font, size, color });
      cursor += run.font.widthOfTextAtSize(run.text, size);
    }
  };
  const newPage = () => {
    page = documentPdf.addPage([W, H]); y = TOP;
    drawText('VERITAS 智鉴', M, H - 25, { size: 9, color: colors.blue, strong: true });
    page.drawLine({ start: { x: M, y: H - 42 }, end: { x: W - M, y: H - 42 }, thickness: .6, color: colors.line });
  };
  const ensure = height => { if (y - height < BOTTOM) newPage(); };
  const paragraph = (value, { size = 9.4, leading = 14, color = colors.ink, gap = 7, indent = 0 } = {}) => {
    for (const line of wrap(value, size, CW - indent)) { ensure(leading); drawText(line, M + indent, y, { size, color }); y -= leading; }
    y -= gap;
  };
  const section = value => { ensure(27); page.drawRectangle({ x: M, y: y - 12, width: 3, height: 12, color: colors.blue }); drawText(value, M + 10, y, { size: 12, strong: true }); y -= 24; };
  const softBlock = (heading, body, accent = colors.blue) => {
    const lines = wrap(body, 9, CW - 24), height = 30 + lines.length * 13;
    ensure(Math.min(height, 150));
    page.drawRectangle({ x: M, y: y - Math.min(height, y - BOTTOM), width: CW, height: Math.min(height, y - BOTTOM), color: colors.soft, borderColor: colors.line, borderWidth: .6 });
    drawText(heading, M + 12, y - 8, { size: 9.5, strong: true, color: accent }); y -= 28;
    for (const line of lines) { ensure(13); drawText(line, M + 12, y, { size: 9 }); y -= 13; }
    y -= 10;
  };
  const severityLabel = value => ({ error: '高优先级', warning: '中优先级', info: '提示' })[value] || '中优先级';
  const typeLabel = value => ({ repetition: '重复叙述', padding: '内容空泛' })[value] || value || '其他问题';
  const issue = item => {
    const heading = [item.chapter, item.location, typeLabel(item.type), severityLabel(item.severity)].filter(Boolean).join(' · ') || '检测发现';
    section(heading);
    const stages = (item.stages || []).map(stage => stage.name).filter(Boolean).join('、') || item.stageName || '';
    if (stages) paragraph(`发现阶段：${stages}`, { size: 8.3, color: colors.muted, gap: 2 });
    if (item.message || item.summary) paragraph(item.message || item.summary, { gap: 3 });
    if (item.suggestion) paragraph(`建议：${item.suggestion}`, { color: colors.muted, gap: 3 });
    const references = Array.isArray(item.references) ? item.references : item.originalText ? [{ quote: item.originalText }] : [];
    for (const [index, reference] of references.slice(0, 3).entries()) {
      const evidence = [`证据${index + 1}`, reference.chapter, reference.paragraphIndex ? `第${reference.paragraphIndex}段` : ''].filter(Boolean).join(' · ');
      softBlock(evidence, reference.quote || '', colors.suspected);
    }
  };

  const reportMeta = () => {
    section('报告与检测范围');
    const coverage = result?.coverage || {};
    const coverageText = scenario === 'novel'
      ? `${Number(coverage.chapters || 0)}章 · ${Number(coverage.paragraphs || 0)}段 · ${Number(coverage.windows || 0)}窗口`
      : `${Number(coverage.paragraphs || 0)}段 · ${Number(coverage.windows || 0)}窗口`;
    const values = [
      ['报告编号', identity.reportId],
      ['内容指纹', identity.fingerprint],
      ['检测时间', dateText(generatedAt)],
      ['检测范围', scope || coverageText],
    ];
    const gap = 8, width = (CW - gap) / 2, height = 43;
    ensure(height * 2 + gap + 8);
    values.forEach(([name, value], index) => {
      const column = index % 2, row = Math.floor(index / 2), x = M + column * (width + gap), top = y - row * (height + gap);
      page.drawRectangle({ x, y: top - height, width, height, color: colors.soft, borderColor: colors.line, borderWidth: .5 });
      drawText(name, x + 9, top - 8, { size: 7.4, color: colors.muted });
      const line = wrap(value, 8.3, width - 18)[0] || '';
      drawText(line, x + 9, top - 24, { size: 8.3, strong: true });
    });
    y -= height * 2 + gap + 14;
  };

  const issueOverview = (issues, heading = '问题分类与处理优先级') => {
    const summary = summarizeReportIssues(issues);
    section(heading);
    const values = [
      ['问题总数', summary.total, '具有原文证据'],
      ['高优先级', summary.severity.error, '建议发布前处理'],
      ['中优先级', summary.severity.warning, '建议人工复核'],
      ['提示', summary.severity.info, '可结合语境处理'],
    ];
    const gap = 8, width = (CW - gap * 3) / 4, height = 52;
    ensure(height + 10);
    values.forEach(([name, value, note], index) => {
      const x = M + index * (width + gap);
      page.drawRectangle({ x, y: y - height, width, height, color: colors.soft, borderColor: colors.line, borderWidth: .5 });
      drawText(name, x + 8, y - 8, { size: 7.2, color: colors.muted });
      drawText(String(value), x + 8, y - 24, { size: 12, strong: true });
      drawText(note, x + 8, y - 39, { size: 6.7, color: colors.muted });
    });
    y -= height + 11;
    const typeText = summary.types.slice(0, 8).map(([type, count]) => `${typeLabel(type)} ${count}条`).join(' · ') || '无问题线索';
    softBlock('类型分布', typeText);
  };

  newPage();
  const displayTitle = `${title || '未命名'}${version ? ` · v${version}` : ''}`;
  for (const line of wrap(displayTitle, 20, CW)) { drawText(line, M, y, { size: 20, strong: true }); y -= 27; }
  drawText(label, M, y, { size: 12, color: colors.blue, strong: true }); y -= 20;
  paragraph(`${scope ? `${scope} · ` : ''}生成时间：${dateText(generatedAt)}`, { size: 8.5, color: colors.muted, gap: 12 });
  reportMeta();

  if (kind === 'ai') {
    const risk = result?.aiRisk || {}, distribution = risk.distribution || {}, characters = distribution.characters || {};
    const total = Math.max(1, Number(distribution.totalCharacters) || 0), score = Number(risk.documentScore?.score);
    const aiRelated = (Number(characters.suspectedAi || 0) + Number(characters.ai || 0)) / total;
    const scoredRatio = Number(distribution.scoredCharacters || 0) / total;
    const metrics = [
      ['模型加权得分', Number.isFinite(score) ? percentage(score, 2) : '无法计算'],
      ['AI相关字符占比', percentage(aiRelated)],
      ['可评分覆盖率', percentage(scoredRatio)],
      ['关注片段', String(selectAiReportItems(risk).total)],
    ];
    const gap = 8, cardWidth = (CW - gap * 3) / 4, cardHeight = 54;
    ensure(cardHeight + 8);
    metrics.forEach(([name, value], index) => {
      const x = M + index * (cardWidth + gap);
      page.drawRectangle({ x, y: y - cardHeight, width: cardWidth, height: cardHeight, color: colors.soft, borderColor: colors.line, borderWidth: .5 });
      drawText(name, x + 9, y - 9, { size: 7.5, color: colors.muted });
      drawText(value, x + 9, y - 27, { size: 11.5, strong: true });
    });
    y -= cardHeight + 17;
    section('全文整体构成');
    const values = [
      ['人工', Number(characters.human) || 0, colors.human], ['疑似AI', Number(characters.suspectedAi) || 0, colors.suspected],
      ['AI', Number(characters.ai) || 0, colors.ai], ['无法评分', Number(characters.unscored) || 0, colors.unscored],
    ];
    ensure(55);
    let x = M;
    for (const [, count, color] of values) { const width = CW * count / total; if (width > 0) page.drawRectangle({ x, y: y - 14, width, height: 14, color }); x += width; }
    y -= 24;
    let legendX = M;
    for (const [name, count, color] of values) {
      page.drawCircle({ x: legendX + 3, y: y - 4, size: 3, color });
      const labelText = `${name} ${count.toLocaleString()}字`;
      drawText(labelText, legendX + 10, y, { size: 8 }); legendX += measure(labelText, 8) + 28;
    }
    y -= 24;
    if (result?.coverage?.notice) softBlock('覆盖说明', result.coverage.notice);
    const unscoredReasons = summarizeUnscoredReasons(risk);
    if (unscoredReasons.length) softBlock('无法评分原因', unscoredReasons.map(([reason, count]) => `${reason}：${count}个片段`).join(' · '));
    section('需关注的原文片段');
    const focus = selectAiReportItems(risk).items;
    if (!focus.length) paragraph('本次没有AI、疑似AI或无法评分片段。', { color: colors.muted });
    for (const item of focus) {
      const location = item.location || '原文片段';
      const scoreText = item.score != null && Number.isFinite(Number(item.score)) ? ` · ${percentage(item.score, 2)}` : '';
      softBlock(`${location} · ${item.labelZh || '需关注'}${scoreText}`, `${item.reason ? `${item.reason}\n` : ''}${item.text || ''}`, item.label === 'ai' ? colors.ai : item.label === 'suspected-ai' ? colors.suspected : colors.unscored);
    }
    const positionScores = Array.isArray(risk.paragraphScores) ? risk.paragraphScores : [];
    if (positionScores.length) {
      if (y - BOTTOM < 190) newPage();
      section('全文位置分布');
      ensure(45);
      let positionX = M;
      const width = CW / positionScores.length;
      const positionColors = { human: colors.human, 'suspected-ai': colors.suspected, ai: colors.ai, unscored: colors.unscored };
      for (const item of positionScores) {
        page.drawRectangle({ x: positionX, y: y - 14, width: Math.max(.5, width), height: 14, color: positionColors[item.label] || colors.unscored });
        positionX += width;
      }
      y -= 24;
      const counts = positionScores.reduce((value, item) => { const key = Object.hasOwn(value, item.label) ? item.label : 'unscored'; value[key] += 1; return value; }, { human: 0, 'suspected-ai': 0, ai: 0, unscored: 0 });
      paragraph(`每格代表一个已聚合段落，按原文顺序排列。人工 ${counts.human} 段 · 疑似AI ${counts['suspected-ai']} 段 · AI ${counts.ai} 段 · 无法评分 ${counts.unscored} 段`, { size: 7.8, color: colors.muted });
    }
    const versions = risk.documentScore?.modelVersions || [];
    const thresholds = risk.documentScore?.thresholds;
    softBlock('模型、阈值与解读', `模型：${versions.join('、') || risk.findings?.[0]?.modelVersion || '未提供'}\n人工 < ${thresholds ? percentage(thresholds.humanMax, 0) : '50%'} · 疑似AI ${thresholds ? percentage(thresholds.humanMax, 0) : '50%'}-${thresholds ? percentage(thresholds.aiMin, 0) : '80%'} · AI ≥ ${thresholds ? percentage(thresholds.aiMin, 0) : '80%'}\n模型加权得分是未校准分类分数；AI相关字符占比是被标为AI或疑似AI的字符比例，二者均不能单独证明文本来源。`);
  } else if (scenario === 'news') {
    const proofreading = result?.proofreading || {}, stages = Array.isArray(proofreading.stages) ? proofreading.stages : [];
    issueOverview(collectNewsReportIssues(proofreading));
    softBlock('总体结论', proofreading.summary || '本次未返回三审三校总结。');
    for (const [index, stage] of stages.entries()) {
      section(`${index + 1}. ${stage.name || `阶段${index + 1}`} · 做了什么与发现了什么`);
      paragraph(stage.objective || '未提供阶段目标。', { gap: 3 });
      paragraph(`检查项：${(stage.checks || []).join('；') || '未提供'}\n阶段结论：${stage.summary || '未提供'}\n发现：${Number(stage.findingCount || 0)} 条`, { color: colors.muted });
      const issues = Array.isArray(stage.issues) ? stage.issues : [];
      if (!issues.length) paragraph('本阶段未发现有明确原文证据的问题。', { color: colors.muted });
      else issues.forEach(issue);
    }
  } else {
    const quality = result?.quality || {}, findings = Array.isArray(quality.findings) ? quality.findings : [];
    const repetition = findings.filter(item => item.type === 'repetition').length;
    const padding = findings.length - repetition;
    const crossChapter = findings.filter(item => new Set((item.references || []).map(reference => reference.chapterId || reference.chapter).filter(Boolean)).size > 1).length;
    section('检测摘要');
    const summaryValues = [
      ['重复叙述', repetition, '含完全重复与模型线索'],
      ['内容空泛', padding, '疑似水稿线索'],
      ['跨章对照', crossChapter, result?.coverage?.crossChapter === 'same-request' ? '已比较同次送检章节' : '本次未执行跨章比较'],
      ['覆盖范围', Number(result?.coverage?.chapters || 0), `${Number(result?.coverage?.paragraphs || 0)}段 · ${Number(result?.coverage?.windows || 0)}窗口`],
    ];
    const gap = 8, width = (CW - gap * 3) / 4, height = 52;
    ensure(height + 10);
    summaryValues.forEach(([name, value, note], index) => {
      const x = M + index * (width + gap);
      page.drawRectangle({ x, y: y - height, width, height, color: colors.soft, borderColor: colors.line, borderWidth: .5 });
      drawText(name, x + 8, y - 8, { size: 7.2, color: colors.muted });
      drawText(String(value), x + 8, y - 24, { size: 12, strong: true });
      drawText(wrap(note, 6.5, width - 16)[0] || '', x + 8, y - 39, { size: 6.5, color: colors.muted });
    });
    y -= height + 11;
    issueOverview(findings, '线索分类与处理优先级');
    softBlock('总体结论', quality.summary || '本次未返回重复与水稿检测总结。');
    if (result?.coverage?.notice) softBlock('覆盖说明', result.coverage.notice);
    if (y - BOTTOM < 330 && findings.length > 1) newPage();
    section('重复与水稿线索');
    if (!findings.length) paragraph('本次未发现有明确原文证据的重复或水稿线索。', { color: colors.muted });
    else findings.forEach(issue);
  }

  const pages = documentPdf.getPages();
  pages.forEach((item, index) => {
    item.drawLine({ start: { x: M, y: 39 }, end: { x: W - M, y: 39 }, thickness: .5, color: colors.line });
    page = item;
    const footer = kind === 'ai'
      ? '模型得分未经校准，AI相关字符占比也不等同于确定概率；结论需结合原文人工复核。'
      : '问题与建议均为辅助审校线索，已附可回查原文；是否采纳须由编辑结合上下文判断。';
    drawText(footer, M, 31, { size: 7, color: colors.muted });
    const marker = `${index + 1} / ${pages.length}`;
    drawText(marker, W - M - measure(marker, 7), 31, { size: 7, color: colors.muted });
  });
  return documentPdf.save();
}

export async function downloadTextPdfReport(options) {
  const runtime = await loadRuntime();
  const bytes = await createTextPdfReport(options, runtime);
  const fileName = textReportFileName(options);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const link = document.createElement('a');
  link.href = url; link.download = fileName; link.hidden = true;
  document.body.append(link); link.click(); link.remove();
  globalThis.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return fileName;
}
