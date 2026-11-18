// 2.1 通用图片 AI 检测 → 标准报告模型映射器。
// 输入为前端检测项（item：{name, result}）或等价的保存结果；只产出内容，不涉及版式。

import { createStdReport, p, table, list, image, chapter, formatStdTime } from './model.js';

const credentialNames = {
  absent: '未发现内容凭证', valid: '内容绑定验证通过', trusted: '内容凭证验证通过',
  invalid: '内容凭证异常', unverifiable: '暂无法验证凭证', unavailable: '凭证校验暂不可用', unknown: '凭证状态待确认',
};
const verdictNames = { likely_ai: '疑似 AI 生成', no_obvious_ai: '未见明显 AI 生成' };
const percent = (value) => (Number.isFinite(value) ? (value * 100).toFixed(1) : null);
const or = (value, fallback = '—') => (value === null || value === undefined || value === '' ? fallback : String(value));

function hasAiDeclaration(result) {
  return (result?.diagnostics?.sourceDeclarations?.records || []).some((record) => String(record?.fields?.Label) === '1');
}

function tamperConclusion(tamper) {
  if (!tamper || tamper.status !== 'completed') return tamper?.status === 'failed' ? '检测未能完成' : '未执行';
  if (tamper.signal === 'suspicious') return '发现疑似局部篡改线索';
  if (tamper.signal === 'no_obvious_signal') return '未发现明显局部篡改线索';
  return '未得出明确结论';
}

export function buildGeneralStdReport(item, { generatedAt = new Date().toISOString(), reportNo = '' } = {}) {
  const result = item?.result || {};
  const diagnostics = result.diagnostics || {};
  const forensics = result.forensics || {};
  const face = forensics.face || {};
  const source = forensics.source || {};
  const tamper = forensics.tamper || {};
  const declarations = diagnostics.sourceDeclarations || {};
  const credentials = diagnostics.credentials || {};
  const meta = diagnostics.metadata || {};
  const fileName = item?.name || item?.file?.name || '未命名图片';
  const score = Number.isFinite(result.score) ? result.score : null;
  const aiDeclared = hasAiDeclaration(result);
  const verdictName = aiDeclared ? 'AI 生成（文件标识）' : (verdictNames[result.verdict] || '未得出结论');

  const meta1 = [
    ['检测场景', '通用 AI 生成图片检测'],
    ['检测对象', fileName],
    ['生成时间', formatStdTime(generatedAt)],
  ];
  if (reportNo) meta1.push(['报告编号', reportNo]);

  // 1 检测结论
  const conclusionBlocks = [
    p(`本次检测结论：${verdictName}。${result.summary || ''}`),
    table(
      [{ title: '项目', width: 26 }, { title: '内容', width: 74 }],
      [
        ['检测结论', verdictName],
        ['AI 来源信号', score === null ? '未记录' : `${percent(score)} / 100（未校准模型信号，不代表真实概率）`],
        ['检测覆盖范围', or(result.coverage, '整图')],
        ['判定依据', aiDeclared ? '文件内部 AI 生成声明（优先于模型信号）' : result.decisionBasis === 'model' || result.modelVerdict ? '模型信号判定' : '综合判定'],
      ],
      { caption: '检测结论摘要' },
    ),
  ];

  // 2 检测对象与文件信息
  const [w, h] = diagnostics.dimensions || [];
  const fileInfoRows = [
    ['文件名', fileName],
    ['文件格式', or(diagnostics.format)],
    ['图像尺寸', w && h ? `${w} × ${h} 像素` : '未记录'],
    ['设备品牌', or(meta.make)],
    ['设备型号', or(meta.model)],
    ['处理软件', or(meta.software || meta.Software)],
    ['内容凭证（C2PA）', credentialNames[credentials.status] || credentialNames.unknown],
    ['文件指纹（SHA-256）', or(diagnostics.sha256)],
  ].filter((row) => row[1] !== '—' || ['内容凭证（C2PA）', '文件指纹（SHA-256）'].includes(row[0]));

  // 3 分项检测过程与结果
  const sections = [];
  sections.push(p(`整图 AI 来源检测结论：${verdictName}。${score === null ? '本次未记录信号分数。' : `AI 来源信号为 ${percent(score)} / 100，属未校准模型信号，不代表真实概率。`}${result.coverage ? `本次判定覆盖范围：${result.coverage}。` : ''}`));
  if (tamper.status) {
    const tamperScore = tamper.status === 'completed' && Number.isFinite(tamper.score) ? `${percent(tamper.score)} / 100（判定阈值 ${percent(tamper.threshold) ?? '未记录'}）` : '未记录';
    sections.push(p(`局部篡改检测结论：${tamperConclusion(tamper)}。检测分数 ${tamperScore}。该分数为未校准模型信号；发现线索时需结合原图与识别内容复核，不代表已确认篡改事实。`));
  }
  if (face.status) {
    if (face.status !== 'completed') sections.push(p(`人像伪造分析：${face.status === 'failed' ? '分析未能完成' : '未执行'}。`));
    else {
      const faces = face.faces || [];
      const suspicious = faces.filter((entry) => entry.signal === 'suspicious');
      const faceLines = faces.map((entry, index) => `第 ${index + 1} 张人脸：${entry.signal === 'suspicious' ? '疑似伪造' : '未见明显伪造线索'}（伪造评分 ${percent(entry.score) ?? '未记录'} / 100，阈值 ${percent(face.threshold) ?? '未记录'}）。`);
      sections.push(p(`人像伪造分析${face.analyzedFaceCount ? `共分析 ${face.analyzedFaceCount} 张人脸` : ''}：${suspicious.length ? `发现 ${suspicious.length} 张疑似伪造人脸` : faces.length ? '未发现明显伪造线索' : '未检出可分析人脸'}。分析仅覆盖人脸区域。`));
      if (faceLines.length) sections.push(list(faceLines));
    }
  }
  if (source.status) {
    if (source.status !== 'completed') sections.push(p('生成来源分析：未执行。'));
    else {
      const candidates = source.candidates || [];
      sections.push(p(`生成来源分析在已知生成器范围内比对，${candidates.length ? `匹配到 ${candidates.length} 个候选` : '未匹配到候选'}。该结果为闭集参考，未知来源与混合编辑不能确定归属。`));
      if (candidates.length) {
        sections.push(table(
          [{ title: '候选序号', width: 16 }, { title: '候选生成来源', width: 54 }, { title: '匹配分数', width: 30 }],
          candidates.slice(0, 5).map((candidate, index) => [`候选 ${index + 1}`, or(String(candidate.source || '').replace(/_/g, ' ')), percent(candidate.score) === null ? '未记录' : `${percent(candidate.score)} / 100`]),
          { caption: '生成来源候选' },
        ));
      }
    }
  }
  const providerChecks = diagnostics.providerChecks?.checks || [];
  if (providerChecks.length || declarations.status) {
    sections.push(p('对常见生成平台的文件标识与来源声明进行检查：'));
    if (providerChecks.length) {
      sections.push(table(
        [{ title: '生成平台', width: 26 }, { title: '声明状态', width: 28 }, { title: '声明内容', width: 46 }],
        providerChecks.map((check) => [
          or(check.name || check.provider),
          check.status === 'evidence_found' ? '发现生成来源声明' : '未发现相关声明',
          (check.declarations || []).map((entry) => `${entry.role}=${entry.value}（${entry.location}）`).join('；') || '—',
        ]),
        { caption: '生成平台声明检查' },
      ));
    }
    if (declarations.summary) sections.push(p(declarations.summary));
  }

  // 4 检测图像
  const imageBlocks = [];
  const figures = [];
  if (diagnostics.layers?.original) figures.push({ src: diagnostics.layers.original, caption: '检测原图' });
  const feature = diagnostics.layers?.aiFeatures || diagnostics.layers?.sensitivity;
  if (feature) figures.push({ src: feature, caption: diagnostics.layers?.aiFeatures ? 'AI 特征分布（窗口分类结果，非像素分割）' : '判定关注区域' });
  if (tamper.overlay && tamper.status === 'completed') figures.push({ src: tamper.overlay, caption: '局部篡改线索叠加' });
  for (const figure of figures.slice(0, 3)) imageBlocks.push(image(figure.src, figure.caption, { widthCm: 14 }));
  if (figures.length > 3) imageBlocks.push(p(`其余 ${figures.length - 3} 张分析图（如压缩差异、细节分布）可在平台页面查看。`));
  if (!figures.length) imageBlocks.push(p('本次未取得可展示的检测图像。'));

  // 5 检测说明与限制
  const notes = [
    '本报告由 VERITAS 智鉴在本地生成，内容来自本次检测的实际返回结果。',
    '各检测分数为未校准模型信号，不代表真实概率；AI 特征分布为窗口分类结果，不代表像素级分割。',
    '生成来源候选为已知生成器闭集参考；文件标识声明未经身份验证，不能单独作为定性依据。',
    '本报告不构成对图片来源真实性的法律或官方认定；重要业务请结合原件与官方渠道核验。',
  ];

  // 附录 A 模型与版本
  const versionRows = [];
  const model = result.model || {};
  if (model.name || model.version) versionRows.push(['整图 AI 来源检测', [model.name, model.version].filter(Boolean).join(' · ')]);
  for (const [label, part] of [['局部篡改检测', tamper], ['人像伪造分析', face], ['生成来源分析', source]]) {
    if (part?.status === 'completed' && (part.model || part.weightsSha256)) {
      versionRows.push([label, [part.model, part.weightsSha256 ? `权重指纹 ${String(part.weightsSha256).slice(0, 16)}…` : ''].filter(Boolean).join(' · ')]);
    }
  }
  if (diagnostics.statistics?.engineVersion) versionRows.push(['检测引擎', String(diagnostics.statistics.engineVersion)]);

  const chapters = [
    chapter('检测结论', conclusionBlocks),
    chapter('检测对象与文件信息', [table([{ title: '项目', width: 34 }, { title: '内容', width: 66 }], fileInfoRows, { caption: '文件信息' })]),
    chapter('分项检测过程与结果', sections),
    chapter('检测图像', imageBlocks),
    chapter('检测说明与限制', [list(notes)]),
  ];
  if (versionRows.length) chapters.push(chapter('模型与版本', [table([{ title: '检测项', width: 30 }, { title: '模型 / 版本', width: 70 }], versionRows, { caption: '模型与版本' })], { appendix: true }));

  return createStdReport({
    docTitle: '通用图片 AI 检测报告',
    subtitle: fileName,
    scenario: 'image-general',
    generatedAt,
    reportNo,
    meta: meta1,
    chapters,
  });
}
