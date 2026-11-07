import { api } from '../../../api.js';
import { textLang, countUnits, unitLabel, styleScores } from '../../../lib/text-units.js';
import { saveDetectionHistory } from '../../../lib/report-history.js';

const MAX_TEXT_LENGTH = 200_000;
const escapeHtml = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const createId = () => `section-${Math.random().toString(36).slice(2, 9)}`;
const pct = item => Math.round(Number(item?.ai_score || 0) * 100);
// 中文后不能用 \b（JS 里汉字不算 word char）；英文保留词界，避免误伤 “Reference model”
const REF_TITLE_RE = /^(?:references|bibliography|参考文献)(?=$|[\s：:·\-—（(]|\))/i;
const LAYOUT_EXT = /\.(pdf|docx)$/i;
const TEXT_EXT = /\.(txt|md|markdown|html?|csv|tsv|json|xml|ya?ml|tex|bib|rst|log|srt|vtt|rtf|ini|cfg|conf|toml|sql|sh|py|js|ts|jsx|tsx|java|c|cc|cpp|h|hpp|cs|go|rs|rb|php|css|less|scss|vue|svelte|ipynb|org|adoc|asciidoc|textile|wiki|nfo|me|readme)$/i;
const FILE_ACCEPT = '.pdf,.docx,.txt,.md,.markdown,.html,.htm,.csv,.tsv,.json,.xml,.yaml,.yml,.tex,.bib,.rst,.log,.srt,.vtt,.rtf,.ini,.cfg,.conf,.toml,.sql,.sh,.py,.js,.ts,.jsx,.tsx,.java,.c,.cc,.cpp,.h,.hpp,.cs,.go,.rs,.rb,.php,.css,.less,.scss,.vue,.svelte,.ipynb,.org,.adoc,.asciidoc,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown,text/html,application/json,application/xml,text/csv,text/x-tex';
const FILE_HINT = 'PDF、DOCX、TXT、MD、HTML、CSV、JSON、XML、YAML、TEX、BIB、RST、代码与字幕等';

const SAMPLES = {
  zh: {
    id: 'sample-zh',
    tone: 'zh',
    lang: '中文示例',
    venue: '',
    focus: '改写鲁棒检测',
    tags: ['学术写作', '同义改写', '句级定位', '中文语料'],
    title: '人机协同改写下的学术 AI 文本检测：对抗增强与证据融合',
    excerpt: '针对“先生成、后润色”的滥用路径，构建改写感知检测器：在训练中注入同义替换与句序扰动，并结合引用异常与篇章连贯性证据，提升对润色后稿件的召回。',
    sections: ['摘要', '引言', '相关工作', '方法', '实验', '结果分析', '结论', '参考文献'],
    fileName: 'sample-zh.md',
    text: `# 摘要

在学位论文与期刊投稿中，作者可能先用大模型起草，再经人工或二次模型润色，以削弱检测器对机器痕迹的捕捉。现有方法在干净生成文本上表现尚可，却在同义改写、句式重组与局部人工替换后显著失效。本文面向学术中文场景，提出改写鲁棒的 AI 文本检测方法：以对抗式数据增强模拟人机协同修改，并融合似然轨迹、引用规范异常与篇章连贯性三类证据，输出篇章风险分与句级高亮。

# 引言

生成式工具降低了学术写作门槛，也带来代写与不当辅助风险。与“端到端整篇生成”相比，更常见的是分段生成后人工修订：保留论点框架，替换连接词、压缩长句、插入真实实验细节。这类混合文本会打破单纯依赖困惑度或模板短语的检测假设。因此，检测系统需要同时回答两个问题：整篇是否主要由机器参与，以及哪些句子仍保留可复核的生成痕迹。

# 相关工作

零样本检测通常利用参考模型的对数概率曲率或交叉模型似然差；监督检测则在人工与机器平行语料上训练分类器。针对改写攻击，已有研究引入回译、同义词典与风格迁移增强，但面向中文学术体裁（摘要、相关工作、方法描述）的系统评测仍不足。另有工作关注虚假引用与参考文献列表异常，可与正文检测互补。

# 方法

方法包含三个模块。第一，改写增强器对机器文本施加受控扰动：近义替换、状语前移、长句切分与相邻句对调，逼近人工润色分布。第二，证据提取器计算 token 级困惑度曲线、局部熵变化，并检测“有编号无对应文献”“引用年份失配”等规范异常；同时用句向量估计相邻句语义漂移。第三，融合分类器以注意力权重汇总证据，给出篇章分数，并按句贡献排序生成风险列表。

# 实验

我们在计算机与信息科学中文摘要、引言与方法段落上构建评测集，生成端覆盖多种开源指令模型，润色端包含人工轻改与二次模型改写。对比基线包括纯困惑度阈值、监督学习分类器与仅使用语义漂移的变体。指标报告 AUROC、F1，以及改写强度分层后的召回变化。

# 结果分析

在无润色设置下，各方法差距有限；随着改写强度上升，仅依赖表层模板词的方法下降最快。引入对抗增强后，本文方法在中高强度润色子集上保持更高召回，且句级高亮与人工标注风险句的重合率更好。消融显示，引用异常特征对“参考文献注水”样本贡献最大，而连贯性特征有助于发现被拆分后的生成段落。

# 结论

面向学术中文的 AI 文本检测不能只假设“干净机器文本”。通过改写增强与多证据融合，可以更稳健地识别人机协同稿件，并为审稿人提供可解释的句级线索。后续将扩展到图表说明文字与学位论文长文档场景。

# 参考文献

[1] 王某, 李某. 大模型生成文本检测综述. 中文信息学报, 2024.
[2] 赵某. 面向学术写作的 AI 内容识别方法. 计算机研究与发展, 2025.
[3] 陈某. 文本改写攻击下的机器痕迹评估. NLPCC, 2024.
`,
  },
  en: {
    id: 'sample-en',
    tone: 'en',
    lang: 'EN demo',
    venue: '',
    focus: 'Zero-shot cross-model',
    tags: ['zero-shot', 'cross-LLM', 'thesis sections', 'span highlight'],
    title: 'Cross-Model Zero-Shot Detection of LLM-Written Thesis Sections without Task-Specific Labels',
    excerpt: 'A label-free detector that contrasts surrogate-model likelihood geometry across generators, then localizes risky spans in Introduction/Related Work/Method sections of English theses.',
    sections: ['Abstract', 'Introduction', 'Related Work', 'Approach', 'Setup', 'Findings', 'Conclusion', 'References'],
    fileName: 'sample-en.md',
    text: `# Abstract

Supervised AI-text detectors require continual re-labeling whenever a new generator appears. For English graduate theses, this is costly: students may use unseen commercial models, and departments need decisions that remain calibrated across cohorts. We study a zero-shot setting that never trains on labeled human/AI pairs. Instead, we compare likelihood geometry under two frozen surrogate models and aggregate token-level disagreement into section-aware scores for Introduction, Related Work, and Method. The detector also returns contiguous spans for human review.

# Introduction

Thesis writing mixes boilerplate structure with domain-specific claims. LLM assistance can fill literature summaries or method templates while leaving experiment numbers untouched, creating mixed authorship that binary document labels oversimplify. Cross-model generalization is the central failure mode of classifiers trained on a single generator. We therefore ask whether surrogate likelihood contrasts—without fine-tuning—can flag machine-written thesis sections and explain where the signal concentrates.

# Related Work

DetectGPT and related zero-shot methods perturb text and measure log-probability curvature under a reference LM. Binoculars-style approaches contrast two models' likelihoods. Watermarking assumes generator cooperation and is rarely available for third-party detectors. Our focus differs: we target long academic sections, enforce section-level aggregation, and emphasize span localization for academic integrity workflows rather than leaderboard accuracy alone.

# Approach

Given a thesis section, we tokenize under two surrogates with mismatched pretraining mixtures. For each token we record rank, entropy, and cross-model log-prob gap. A sliding window aggregates these cues into a local AI-likeness curve; peaks become candidate spans. Section scores are length-normalized means of the top-k windows, which reduces dilution from short human-edited sentences. No gradient updates or labeled academic corpora are used at detection time.

# Setup

We assemble English thesis-like sections from public university repositories and synthesize machine counterparts with several instruction-tuned LLMs held out from the surrogate pair. Evaluation reports section-level AUROC, calibration error, and span IoU against highlights produced by independent annotators. We also stress-test with light copy-editing and citation insertion to mimic partial human revision.

# Findings

Zero-shot contrast remains competitive with a supervised RoBERTa detector trained on older generators when the test LLM is unseen, and degrades more gracefully under light editing. Span highlights concentrate in literature-review enumerations and template-like method descriptions, matching annotator intuition. Failures mainly occur in short formula-heavy paragraphs where both surrogates assign high uncertainty.

# Conclusion

Label-free cross-model likelihood contrast can support thesis-section screening and provide reviewable spans without retraining for every new LLM. Future work will combine this signal with bibliography verification and multilingual abstracts.

# References

[1] Mitchell E, et al. DetectGPT: Zero-shot machine-generated text detection. ICML, 2023.
[2] Hans A, et al. Spotting LLMs with binoculars. ICML, 2024.
[3] Bao G, et al. Fast-DetectGPT. ICLR, 2024.
`,
  },
};

function renderSampleCards(disabled) {
  return Object.values(SAMPLES).map(sample => {
    const langMode = sample.tone === 'zh' ? 'zh' : 'en';
    const units = countUnits(sample.text, langMode);
    const unit = unitLabel(langMode);
    return `<button type="button" class="academic-sample-card tone-${escapeHtml(sample.tone)}" data-action="${escapeHtml(sample.id)}" ${disabled ? 'disabled' : ''}>
      <div class="academic-sample-ribbon" aria-hidden="true"></div>
      <div class="academic-sample-top">
        <em>${escapeHtml(sample.lang)}</em>
        <span>${sample.sections.length} 个章节 · ${units.toLocaleString()} ${unit}</span>
      </div>
      <strong>${escapeHtml(sample.title)}</strong>
      <p>${escapeHtml(sample.excerpt)}</p>
      <div class="academic-sample-cta"><span>填入正文</span><span aria-hidden="true">→</span></div>
    </button>`;
  }).join('');
}

async function extractDocumentText(file, signal) {
  const form = new FormData();
  form.append('file', file, file.name);
  const res = await fetch(`${api.baseUrl}/api/v1/pdf/layout`, {
    method: 'POST', headers: { Accept: 'application/json' }, body: form, signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || data.error?.message || `HTTP ${res.status}`);
  const p = data.data || data;
  return { text: p.text || '', sections: layoutSections(p.chapters || []), markdown_path: p.markdown_path || '', skipped: p.skipped || null };
}

function layoutSections(chapters) {
  return chapters.map((item, i) => {
    const children = (item.children || []).map(c => layoutSections([c])[0]).filter(Boolean);
    const content = String(item.text || item.content || '').trim() || children.map(c => c.content).join('\n\n');
    if (!item.title || !content) return null;
    return {
      id: String(item.id || `ch-${i + 1}`), title: String(item.raw || item.title), content,
      level: Number(item.level) || 1, kind: item.kind || 'section', children,
    };
  }).filter(Boolean);
}

function numParts(title) {
  const m = String(title || '').trim().match(/^(\d{1,2}(?:\.\d{1,2}){0,3})\b/);
  return m ? m[1].split('.').map(Number) : null;
}

function nestByNumbering(list) {
  const roots = [];
  const stack = [];
  for (const raw of list) {
    const depth = (numParts(raw.title) || []).length || 1;
    const node = { ...raw, children: [...(raw.children || [])], _depth: depth };
    while (stack.length && stack.at(-1)._depth >= depth) stack.pop();
    if (stack.length) {
      stack.at(-1).children.push(node);
      node.level = (stack.at(-1).level || 1) + 1;
      node.kind = 'subsection';
    } else {
      roots.push(node);
      node.level = 1;
    }
    stack.push(node);
  }
  const strip = n => {
    const { _depth, ...rest } = n;
    return { ...rest, children: (n.children || []).map(strip) };
  };
  return roots.map(strip);
}

function organizeSections(sections) {
  const prepared = (sections || []).map(s => ({ ...s, children: organizeSections(s.children || []) }));
  const depths = prepared.map(s => (numParts(s.title) || []).length);
  return depths.some(d => d === 1) && depths.some(d => d >= 2) ? nestByNumbering(prepared) : prepared;
}

const flattenSections = sections => sections.flatMap(s => [s, ...flattenSections(s.children || [])]);
const isReferenceSection = s => s && (s.kind === 'references' || REF_TITLE_RE.test(String(s.title || '').replace(/^#{1,6}\s+/, '').trim()));

function dropReferencesFromText(text) {
  const lines = String(text || '').split(/\n/);
  const cut = lines.findIndex(line => REF_TITLE_RE.test(line.replace(/^#{1,6}\s+/, '').trim()));
  return (cut >= 0 ? lines.slice(0, cut) : lines).join('\n').trim();
}

function splitDocument(text) {
  const lines = text.replace(/\r\n?/g, '\n').trim().split('\n');
  if (!lines[0] && lines.length === 1) return [];
  const isHeading = line => /^#{1,6}\s+\S/.test(line)
    || /^第[一二三四五六七八九十百千0-9]+[章节篇部]/.test(line)
    || /^\d{1,2}(?:\.\d{1,2}){0,3}[.)、．]?\s+\S/.test(line)
    || /^(?:abstract|introduction|method|experiments?|results?|discussion|conclusion|references|摘要|引言|结论|参考文献)$/i.test(line);
  const sections = [];
  let cur = { id: createId(), title: '正文', content: [] };
  for (const line of lines) {
    const t = line.trim();
    if (isHeading(t) && t.length <= 160) {
      const body = cur.content.join('\n').trim();
      if (body) sections.push({ ...cur, content: body, children: [] });
      cur = { id: createId(), title: t.replace(/^#{1,6}\s+/, ''), content: [] };
    } else cur.content.push(line);
  }
  const body = cur.content.join('\n').trim();
  if (body) sections.push({ ...cur, content: body, children: [] });
  return sections;
}

function subtreeText(section) {
  const kids = section.children || [];
  const own = String(section.content || '').trim();
  if (!kids.length) return own;
  const childJoin = kids.map(subtreeText).filter(Boolean).join('\n\n');
  if (!childJoin) return own;
  if (!own) return childJoin;
  const probes = kids.map(k => String(k.content || '').trim().slice(0, 24)).filter(t => t.length >= 12);
  if (probes.length && probes.every(p => own.includes(p))) return own;
  return `${own}\n\n${childJoin}`;
}

function selectedContent(state) {
  const flat = flattenSections(state.sections);
  if (!flat.length) return state.excludeReferences ? dropReferencesFromText(state.text) : state.text;
  const picked = new Set(state.selectedIds);
  const parts = [];
  const walk = list => {
    for (const s of list || []) {
      if (state.excludeReferences && isReferenceSection(s)) continue;
      if (picked.has(s.id)) parts.push(subtreeText(s));
      else walk(s.children || []);
    }
  };
  walk(state.sections);
  return parts.filter(Boolean).join('\n\n');
}

const normSpace = s => String(s || '').replace(/\s+/g, ' ').trim();

/** NFKC 后可能与原文长度不同，建立归一化串 → 原文下标映射 */
function buildNormMap(str, transform) {
  const map = [];
  let out = '';
  for (let i = 0; i < str.length; ) {
    const cp = str.codePointAt(i);
    const ch = String.fromCodePoint(cp);
    const step = cp > 0xffff ? 2 : 1;
    const piece = transform(ch);
    for (let j = 0; j < piece.length; j++) map.push(i);
    out += piece;
    i += step;
  }
  return { text: out, map };
}

function rangeFromNormMap(map, at, len, fullText) {
  if (at < 0 || len <= 0 || !map.length) return null;
  const start = map[at];
  const last = map[Math.min(at + len - 1, map.length - 1)];
  if (start == null || last == null) return null;
  const cp = fullText.codePointAt(last);
  const end = last + (cp > 0xffff ? 2 : 1);
  return { start, end };
}

/** 在全文中定位句子：精确 → NFKC（后端 format_article 会归一化标点）→ 忽略空白 */
function findSentenceRange(fullText, needle, from = 0) {
  const raw = String(needle || '');
  if (!raw || !fullText) return null;
  let idx = fullText.indexOf(raw, from);
  if (idx < 0 && from > 0) idx = fullText.indexOf(raw);
  if (idx >= 0) return { start: idx, end: idx + raw.length };

  // 后端 sentences() 经 NFKC，中文逗号等会变成 ASCII，需对齐后再找
  const fullN = buildNormMap(fullText, ch => ch.normalize('NFKC'));
  const needleN = raw.normalize('NFKC');
  const fromN = from > 0 ? fullText.slice(0, from).normalize('NFKC').length : 0;
  let at = fullN.text.indexOf(needleN, fromN);
  if (at < 0) at = fullN.text.indexOf(needleN);
  if (at >= 0) return rangeFromNormMap(fullN.map, at, needleN.length, fullText);

  const target = normSpace(needleN);
  if (!target) return null;
  const map = [];
  let collapsed = '';
  for (let i = 0; i < fullN.text.length; i++) {
    const ch = fullN.text[i];
    if (/\s/.test(ch)) {
      if (collapsed.length && collapsed[collapsed.length - 1] !== ' ') {
        map.push(fullN.map[i]);
        collapsed += ' ';
      }
    } else {
      map.push(fullN.map[i]);
      collapsed += ch;
    }
  }
  const fromC = from > 0 ? normSpace(fullText.slice(0, from).normalize('NFKC')).length : 0;
  at = collapsed.indexOf(target, fromC);
  if (at < 0) at = collapsed.indexOf(target);
  if (at < 0) return null;
  const start = map[at];
  const last = map[Math.min(at + target.length - 1, map.length - 1)];
  if (start == null || last == null) return null;
  const cp = fullText.codePointAt(last);
  return { start, end: last + (cp > 0xffff ? 2 : 1) };
}

/** 用送检全文还原原文高亮；未定位到的句子不再追加到文末，避免参考文献后“拼出”一段 */
function renderOriginalHighlight(fullText, items) {
  const sentences = items || [];
  if (!fullText) {
    return sentences.map((item, i) => {
      const s = pct(item);
      return `<span class="academic-hl academic-hl-${scoreTone(s)[0]}" data-jump="${i}" id="orig-sent-${i}" title="${s}%">${escapeHtml(item.text || '')}</span>`;
    }).join(' ');
  }
  let searchFrom = 0;
  const ranges = sentences.map((item, i) => {
    const hit = findSentenceRange(fullText, item?.text || '', searchFrom);
    if (hit) searchFrom = hit.end;
    return hit ? { i, ...hit, s: pct(item) } : null;
  });
  const placed = ranges.filter(Boolean).sort((a, b) => a.start - b.start || a.i - b.i);
  let html = '';
  let cursor = 0;
  for (const r of placed) {
    if (r.start < cursor) continue;
    if (r.start > cursor) html += `<span class="academic-orig-gap">${escapeHtml(fullText.slice(cursor, r.start))}</span>`;
    html += `<span class="academic-hl academic-hl-${scoreTone(r.s)[0]}" data-jump="${r.i}" id="orig-sent-${r.i}" title="${r.s}%">${escapeHtml(fullText.slice(r.start, r.end))}</span>`;
    cursor = r.end;
  }
  if (cursor < fullText.length) html += `<span class="academic-orig-gap">${escapeHtml(fullText.slice(cursor))}</span>`;
  return html;
}

function estimateParseSeconds(bytes) {
  const mb = Math.max(bytes / (1024 * 1024), 0.2);
  try {
    const hist = JSON.parse(localStorage.getItem('academicParseRate') || 'null');
    if (hist?.secPerMb > 2) return Math.max(60, Math.round(hist.secPerMb * mb));
  } catch { /* ignore */ }
  // 大 PDF + MinerU 往往数分钟起；约 12MB ≈ 8–10 分钟量级
  return Math.max(60, Math.round(45 + mb * 40));
}

function rememberParseRate(bytes, elapsedSec) {
  const mb = Math.max(bytes / (1024 * 1024), 0.2);
  if (elapsedSec >= 5) localStorage.setItem('academicParseRate', JSON.stringify({ secPerMb: elapsedSec / mb }));
}

function formatDuration(sec) {
  const s = Math.max(0, Math.round(sec));
  return s < 60 ? `${s} 秒` : `${Math.floor(s / 60)} 分 ${s % 60} 秒`;
}

function startParseProgressTicker(container, startedAt, estimateSec) {
  const tick = () => {
    const root = container.querySelector('.academic-parse-progress');
    if (!root) return;
    const elapsed = (Date.now() - startedAt) / 1000;
    const ratio = Math.min(0.95, elapsed / Math.max(estimateSec, 1));
    const remain = Math.max(0, estimateSec - elapsed);
    root.querySelector('.academic-parse-bar').style.width = `${Math.round(ratio * 100)}%`;
    root.querySelector('.academic-parse-pct').textContent = `${Math.round(ratio * 100)}%`;
    root.querySelector('.academic-parse-eta').textContent = remain < 2
      ? '即将完成…'
      : `已用 ${formatDuration(elapsed)} · 预计还需 ${formatDuration(remain)}`;
  };
  tick();
  return setInterval(tick, 500);
}

function sectionCharCount(s, lang) {
  const kids = s.children || [];
  return kids.length ? kids.reduce((n, c) => n + sectionCharCount(c, lang), 0) : countUnits(s.content || '', lang);
}

function selectableSectionIds(sections, excludeReferences = false) {
  return flattenSections(sections)
    .filter(s => !(excludeReferences && isReferenceSection(s)))
    .map(s => s.id);
}

function renderSections(sections, selectedIds, expandedIds = [], lang = 'zh', excludeReferences = false) {
  if (!sections.length) return '<p class="academic-empty-hint">解析正文后，可在这里选择整篇论文或指定章节。</p>';
  const selected = new Set(selectedIds);
  const expanded = new Set(expandedIds);
  const selectable = selectableSectionIds(sections, excludeReferences);
  const allSelected = selectable.length > 0 && selectable.every(id => selected.has(id));
  const u = unitLabel(lang);
  const row = (s, depth, chars) => {
    const isRef = isReferenceSection(s);
    const locked = excludeReferences && isRef;
    const checked = !locked && selected.has(s.id);
    return `<label class="academic-section-option academic-section-level-${depth}${locked ? ' is-locked' : ''}"><input type="checkbox" name="academic-section" value="${escapeHtml(s.id)}" ${checked ? 'checked' : ''} ${locked ? 'disabled' : ''}><span><strong title="${escapeHtml(s.title)}">${escapeHtml(s.title)}</strong><small>${locked ? '已排除' : `${chars.toLocaleString()} ${u}`}</small></span></label>`;
  };
  const node = (s, depth = 0) => {
    const kids = s.children || [];
    const chars = sectionCharCount(s, lang);
    if (!kids.length) return depth === 0 ? `<div class="academic-section-card academic-section-row">${row(s, depth, chars)}</div>` : row(s, depth, chars);
    const label = depth === 0 ? '二级标题' : '下级标题';
    return `<details class="academic-section-tree academic-section-card" data-section-id="${escapeHtml(s.id)}" ${expanded.has(s.id) ? 'open' : ''}>
      <summary class="academic-section-summary">${row(s, depth, chars)}<span class="academic-section-toggle"><i data-open="收起${label}（${kids.length}）" data-closed="展开${label}（${kids.length}）"></i></span></summary>
      <div class="academic-section-children">${kids.map(c => node(c, depth + 1)).join('')}</div>
    </details>`;
  };
  return `<label class="academic-select-all"><input id="academic-select-all" type="checkbox" ${allSelected ? 'checked' : ''}><span>全选章节（${sections.length}）</span></label><div class="academic-section-rail"><div class="academic-section-track">${sections.map(s => node(s, 0)).join('')}</div></div>`;
}

function scoreTone(score) {
  if (score >= 62) return ['high', '疑似较高'];
  if (score >= 42) return ['medium', '需复核'];
  return ['low', '较低'];
}

const scopeLine = state => `已选 ${state.selectedIds?.length || '全部'} 章`;

function riskMetrics(result, text) {
  const lang = textLang(text);
  const items = result?.sentences || [];
  const total = Math.max(countUnits(text, lang), 1);
  const buckets = { high: 0, medium: 0, low: 0 };
  let highChars = 0;
  for (const item of items) {
    const [tone] = scoreTone(pct(item));
    buckets[tone]++;
    if (tone === 'high') highChars += countUnits(item.text, lang);
  }
  const modelScore = Math.round(Number(result?.ai_score || 0) * 100);
  return {
    modelScore,
    humanScore: Math.max(0, 100 - modelScore),
    ...styleScores(text, items, lang),
    label: result?.label_zh || scoreTone(modelScore)[1],
    highChars,
    highShare: Math.round(highChars / total * 1000) / 10,
    buckets,
    n: items.length,
    lang,
    unit: unitLabel(lang),
  };
}

function metricTone(value) {
  if (value >= 62) return 'good';
  if (value >= 38) return 'mid';
  return 'weak';
}

const metricCard = ({ value, title, label, hint, stats }) => {
  const tone = metricTone(value);
  const statHtml = (stats || [])
    .map(([k, v]) => `<span><i>${escapeHtml(k)}</i><b>${escapeHtml(v)}</b></span>`)
    .join('');
  return `<div class="metric-card metric-tone-${tone}">
    <div class="metric-head">
      <span>${escapeHtml(title)}</span>
      <strong>${value}<small>%</small></strong>
      <em>${escapeHtml(label)}</em>
    </div>
    <div class="metric-bar" aria-hidden="true"><i style="width:${value}%"></i></div>
    <div class="metric-stats">${statHtml}</div>
    <small>${escapeHtml(hint)}</small>
  </div>`;
};

function aiGaugeHtml(m, tip) {
  const circ = 2 * Math.PI * 48;
  const arc = ((circ * m.modelScore) / 100).toFixed(2);
  const [tone] = scoreTone(m.modelScore);
  // 环色与图例共用同一套色值，避免档位 class 不同步时对不上
  const aiColor = tone === 'low' ? '#2c8662' : tone === 'medium' ? '#d4a017' : '#d96b72';
  return `<div class="ai-gauge academic-tone-${tone}" style="--gauge-ai:${aiColor}" aria-label="AI ${m.modelScore}%，人工 ${m.humanScore}%">
    <div class="ai-gauge-ring">
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle class="gauge-track" cx="60" cy="60" r="48"></circle>
        <circle class="gauge-ai" cx="60" cy="60" r="48" stroke="${aiColor}" stroke-dasharray="${arc} ${circ.toFixed(2)}"></circle>
      </svg>
      <div class="gauge-center"><strong>${m.modelScore}<small>%</small></strong><em>AI 评分</em></div>
    </div>
    <div class="ai-gauge-side">
      <div class="gauge-legend"><span class="g-ai" style="color:${aiColor}"><i style="background:${aiColor}"></i>AI ${m.modelScore}%</span><span class="g-human"><i></i>人工 ${m.humanScore}%</span></div>
      <p class="gauge-verdict"><strong>${escapeHtml(m.label)}</strong>${tip}</p>
    </div>
  </div>`;
}

function downloadBlob(name, blob) {
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: name,
  });
  a.click();
  URL.revokeObjectURL(a.href);
}

function reportFileName(fileName, kind, ext = 'pdf') {
  const stem = String(fileName || 'academic').replace(/\.[^.]+$/, '').trim() || 'academic';
  return `${stem}-${kind}.${ext}`;
}

function fileNameFromDisposition(header, fallback) {
  if (!header) return fallback;
  const star = /filename\*=(?:UTF-8''|utf-8'')([^;]+)/i.exec(header);
  if (star) {
    try { return decodeURIComponent(star[1].trim().replace(/^["']|["']$/g, '')); } catch { /* keep */ }
  }
  const plain = /filename="([^"]+)"/i.exec(header) || /filename=([^;]+)/i.exec(header);
  return plain ? plain[1].trim().replace(/^["']|["']$/g, '') : fallback;
}

async function downloadDetectionReport(state) {
  const text = selectedContent(state);
  const fallback = reportFileName(state.fileName, 'AI检测报告', 'pdf');
  const res = await fetch(`${api.baseUrl}/api/v1/reports/detection?format=pdf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/pdf' },
    body: JSON.stringify({
      result: state.result,
      text,
      scope: scopeLine(state),
      file_name: state.fileName || 'academic',
    }),
  });
  if (!res.ok) {
    let detail = await res.text();
    try { detail = JSON.parse(detail).detail || detail; } catch { /* keep */ }
    throw new Error(detail || `HTTP ${res.status}`);
  }
  const blob = await res.blob();
  downloadBlob(fileNameFromDisposition(res.headers.get('Content-Disposition'), fallback), blob);
}

function renderDetectionReport(state) {
  if (state.parsing) return '<p class="academic-empty-hint">正在解析文档…</p>';
  if (state.loading) return '<span class="academic-report-loading"><i></i>正在检测，请稍候…</span>';
  if (!state.result) return '<p class="academic-empty-hint">提交检测后，将在此展示 AI 率结论、风险分布，并可点击定位到原文。</p>';

  const text = state.submittedText || selectedContent(state);
  const m = riskMetrics(state.result, text);
  const [tone] = scoreTone(m.modelScore);
  const tip = { low: '整体风险较低，可抽查复核', medium: '存在可疑片段，建议重点复核', high: '疑似较高，请结合原文逐段核查' }[tone];
  const items = state.result.sentences || [];
  const totalUnits = Math.max(countUnits(text, m.lang), 1);
  const scoredUnits = items.reduce((n, item) => n + countUnits(item.text || '', m.lang), 0);
  const totalBucket = Math.max(m.n, 1);
  const w = k => {
    const n = m.buckets[k] || 0;
    return n ? Math.max(1, Math.round(n / totalBucket * 100)) : 0;
  };
  const frags = items.map((item, i) => ({ item, i, s: pct(item) })).filter(x => x.s >= 42).sort((a, b) => b.s - a.s);
  const { unit: u } = m;
  const origView = state.reportOrigView === 'risk' ? 'risk' : 'all';
  const fragFilter = state.reportFragFilter || 'all';

  return `<div class="academic-report-body is-fluid">
    <div class="academic-report-hero academic-tone-${tone}">
      <div class="academic-score-row">
        ${aiGaugeHtml(m, tip)}
        <div class="academic-metric-grid academic-metric-bars">
          ${metricCard({
            value: m.readability,
            title: '可读性',
            label: m.readLabel,
            hint: '句子长短是否合适、读起来是否顺畅',
            stats: [
              ['平均句长', `${m.avgLen} ${m.unit}`],
              ['参考值', `${m.ideal} ${m.unit}`],
            ],
          })}
          ${metricCard({
            value: m.structure,
            title: '句子结构',
            label: m.structLabel,
            hint: '句子有没有变化，会不会显得单调、机械',
            stats: [
              ['变化度', `${m.variety}`],
              ['连接词', `${m.clausePerSent}/句`],
            ],
          })}
        </div>
      </div>
      <div class="academic-report-dist-strip">
        <div class="academic-dist-copy">
          <strong>风险分布</strong>
          <span>送检 ${totalUnits.toLocaleString()} ${u} · 打分 ${items.length} 句（${scoredUnits.toLocaleString()} ${u}）</span>
        </div>
        <div class="academic-dist">
          <div class="academic-dist-bar">${[['low', w('low')], ['medium', w('medium')], ['high', w('high')]].filter(([, pct]) => pct > 0).map(([k, pct]) => `<span class="dist-${k}" style="width:${pct}%"></span>`).join('')}</div>
          <div class="academic-dist-legend"><span class="legend-low">较低 ${m.buckets.low}</span><span class="legend-medium">需复核 ${m.buckets.medium}</span><span class="legend-high">较高 ${m.buckets.high}</span></div>
        </div>
      </div>
    </div>
    <div class="academic-report-workspace">
      <div class="academic-report-toolbar" role="toolbar" aria-label="报告视图">
        <div class="report-seg" role="group" aria-label="原文视图">
          <button type="button" class="report-seg-btn${origView === 'all' ? ' is-active' : ''}" data-orig-view="all">全文对照</button>
          <button type="button" class="report-seg-btn${origView === 'risk' ? ' is-active' : ''}" data-orig-view="risk">仅风险句</button>
        </div>
        <div class="report-seg" role="group" aria-label="片段筛选">
          <button type="button" class="report-seg-btn${fragFilter === 'all' ? ' is-active' : ''}" data-frag-filter="all">全部疑似 ${frags.length}</button>
          <button type="button" class="report-seg-btn${fragFilter === 'high' ? ' is-active' : ''}" data-frag-filter="high">较高 ${m.buckets.high}</button>
          <button type="button" class="report-seg-btn${fragFilter === 'medium' ? ' is-active' : ''}" data-frag-filter="medium">需复核 ${m.buckets.medium}</button>
        </div>
      </div>
      <div class="academic-report-split is-fluid">
        <div class="academic-report-orig">
          <div class="academic-report-heading"><div><h3>原文高亮</h3></div></div>
          <div class="academic-orig-pane" id="academic-orig-pane" data-view="${origView}"><div class="academic-orig-text">${renderOriginalHighlight(text, items)}</div></div>
        </div>
        <div class="academic-report-frags">
          <div class="academic-report-heading"><div><h3>疑似片段</h3><p>点击卡片或左侧句子，互相定位高亮</p></div></div>
          ${frags.length ? `<div class="academic-fragment-list" data-frag-filter="${fragFilter}">${frags.map(({ item, i, s }) => {
            const [t, level] = scoreTone(s);
            const c = countUnits(item.text, m.lang);
            const hidden = fragFilter !== 'all' && fragFilter !== t ? ' is-filtered-out' : '';
            return `<div class="academic-fragment academic-fragment-${t}${hidden}" role="button" tabindex="0" data-tone="${t}" data-frag-id="${i}" data-jump="${i}">
              <span class="academic-fragment-score">${s}%</span>
              <span class="academic-fragment-body"><strong>${level}</strong><em>${c} ${u} · 占 ${Math.round(c / totalUnits * 1000) / 10}%</em><p>${escapeHtml(item.text || '')}</p></span>
            </div>`;
          }).join('')}</div>` : '<p class="academic-empty-hint">未发现需复核或较高风险的片段。</p>'}
        </div>
      </div>
    </div>
  </div>`;
}

function renderFormalReport(state) {
  if (state.parsing) return '<span class="academic-badge">正在解析文档…</span>';
  if (state.loading) return '<span class="academic-report-loading"><i></i>正在检测，请稍候…</span>';
  if (!state.result) return '<span class="academic-badge">等待正式检测</span>';
  const score = Math.round(Number(state.result.ai_score || 0) * 100);
  const [tone] = scoreTone(score);
  return `<div class="academic-formal-result">
    <div class="academic-formal-summary formal-tone-${tone}"><strong>${escapeHtml(state.result.label_zh || '检测完成')}</strong><span>AI 风险分 ${score}%</span></div>
    <div class="academic-download-actions">
      <button type="button" class="academic-button academic-button-secondary academic-download-button" data-action="download-report">下载 PDF</button>
      <a class="academic-guide-button" href="#/text/academic/ai-reduction">AI降重指南</a>
    </div>
  </div>`;
}

function renderWorkspace(container, state) {
  const content = selectedContent(state);
  const busy = state.parsing || state.loading;
  const alert = state.message
    ? `<div class="academic-alert academic-alert-${state.status === 'ready' ? 'success' : 'error'}" role="status">${escapeHtml(state.message)}</div>`
    : '';
  const lang = textLang(content || state.text);

  container.innerHTML = `<div class="academic-workspace${state.result ? ' is-result' : ''}">
    <div class="academic-intro"><div><p class="academic-kicker">PAPER WORKSPACE / 1.1</p><h2>提交论文并设置检测范围</h2><p>上传文件，或直接粘贴正文；勾选检测范围后提交检测。</p></div><span class="academic-state">${state.result ? '检测完成' : '尚未检测'}</span></div>
    ${alert}
    <div class="academic-grid">
      <section class="academic-panel academic-input-panel">
        <div class="academic-panel-heading"><div><span class="academic-step">01</span><h3>提交论文</h3></div></div>
        <label class="academic-upload"><input id="academic-file" type="file" accept="${FILE_ACCEPT}" ${state.parsing ? 'disabled' : ''}><span class="academic-upload-icon">↑</span><span><strong>上传论文文件</strong><small>${FILE_HINT}</small></span></label>
        <div class="academic-divider"><span>或试用 AI 检测论文示例</span></div>
        <div class="academic-sample-grid" role="group" aria-label="示例论文">${renderSampleCards(busy || state.parsing)}</div>
        <div class="academic-divider"><span>或直接粘贴正文</span></div>
        <div class="academic-text-heading"><label class="academic-text-label" for="academic-text">正文内容</label>${state.parsing ? '<span class="academic-parse-inline">读取中</span>' : ''}</div>
        ${state.parsing ? `<div class="academic-parse-progress" role="status" data-estimate="${state.parseEstimate || 60}">
          <div class="academic-parse-progress-label"><i class="academic-parse-spinner"></i><span class="academic-parse-msg" title="${escapeHtml(state.fileName)}">正在读取 ${escapeHtml(state.fileName)}…</span><button type="button" class="academic-parse-cancel" data-action="cancel-parse">取消读取</button></div>
          <div class="academic-parse-meta"><span class="academic-parse-pct">0%</span><span class="academic-parse-eta">预计约 ${formatDuration(state.parseEstimate || 60)}</span></div>
          <div class="academic-parse-track"><div class="academic-parse-bar" style="width:0%"></div></div>
        </div>` : ''}
        <textarea id="academic-text" maxlength="${MAX_TEXT_LENGTH}" placeholder="请粘贴论文正文，建议保留章节标题。" ${state.parsing ? 'disabled' : ''}>${escapeHtml(state.text)}</textarea>
        <div class="academic-input-footer"><span>${countUnits(state.text).toLocaleString()} ${unitLabel(textLang(state.text))}（上限 ${MAX_TEXT_LENGTH.toLocaleString()} 字符）</span><button class="academic-button academic-button-secondary" data-action="clear-text" ${busy || !state.text.trim() ? 'disabled' : ''}>清除正文</button></div>
      </section>
      <section class="academic-panel academic-selection-panel">
        <div class="academic-panel-heading"><div><span class="academic-step">02</span><h3>设置检测范围</h3></div></div>
        <div class="academic-section-list">${state.parsing ? '<p class="academic-empty-hint">文档解析中，完成后将显示可选章节…</p>' : renderSections(state.sections, state.selectedIds, state.expandedIds, lang, state.excludeReferences)}</div>
        <div class="academic-selection-footer">
          <label class="academic-check"><input id="academic-exclude" type="checkbox" ${state.excludeReferences ? 'checked' : ''} ${state.parsing ? 'disabled' : ''}><span><strong>检测时排除参考文献</strong></span></label>
          <button class="academic-button academic-button-primary" data-action="submit" ${content.trim() && !busy ? '' : 'disabled'}>${state.loading ? '正在检测…' : '提交检测'}</button>
        </div>
      </section>
    </div>
    <section class="academic-report-card${state.result ? ' has-result' : ''}">
      <div class="academic-report-header">
        <div class="academic-report-title"><span class="academic-step">03</span><div><h3>AI 检测报告</h3></div></div>
        <div class="academic-report-actions">${renderFormalReport(state)}</div>
      </div>
      <div class="academic-report-branch">${renderDetectionReport(state)}</div>
    </section>
  </div>`;

  const applyParsed = (parsed, fileName = '') => {
    state.text = parsed.text || '';
    state.layoutSections = organizeSections(parsed.sections || []);
    state.sections = state.layoutSections.length ? state.layoutSections : organizeSections(splitDocument(state.text));
    // 仍无章节但有正文时，兜底成单块「正文」，避免误报「未能识别」
    if (!state.sections.length && state.text.trim()) {
      state.sections = [{ id: createId(), title: '正文', content: state.text.trim(), children: [], kind: 'section', level: 1 }];
    }
    state.selectedIds = selectableSectionIds(state.sections, state.excludeReferences);
    state.expandedIds = [];
    state.fileName = fileName;
    state.markdownPath = parsed.markdown_path || '';
    state.skipped = parsed.skipped || null;
    state.result = null;
    state.submittedText = '';
    state.status = state.sections.length ? 'ready' : 'error';
    state.message = state.sections.length
      ? `已解析 ${state.sections.length} 个内容区块${state.skipped?.summary ? ` · 已跳过 ${state.skipped.summary}` : ''}`
      : (state.text.trim()
        ? '未能识别出章节（请查看落盘 markdown 是否含 # 标题）'
        : '正文为空，请重新上传论文或粘贴正文');
  };

  container.querySelector('#academic-text').addEventListener('input', e => {
    state.text = e.target.value;
    state.result = null;
    if (!state.fileName) {
      state.sections = [];
      state.layoutSections = [];
      state.selectedIds = [];
      state.expandedIds = [];
      state.status = 'idle';
      state.message = '';
    }
  });

  const handleFile = async file => {
    if (!file) return;
    if (/\.doc$/i.test(file.name) && !/\.docx$/i.test(file.name)) {
      state.status = 'error';
      state.message = '旧版 DOC 请另存为 DOCX 或 PDF 后上传';
      return renderWorkspace(container, state);
    }
    if (!LAYOUT_EXT.test(file.name) && !TEXT_EXT.test(file.name)) {
      state.status = 'error';
      state.message = `暂不支持该格式。可选：${FILE_HINT}`;
      return renderWorkspace(container, state);
    }
    state.parseAbort?.abort();
    const abort = new AbortController();
    Object.assign(state, {
      parsing: true, fileName: file.name, sections: [], selectedIds: [], expandedIds: [],
      result: null, message: '', parseAbort: abort,
      parseEstimate: LAYOUT_EXT.test(file.name) ? estimateParseSeconds(file.size) : 3,
    });
    const startedAt = Date.now();
    renderWorkspace(container, state);
    const ticker = startParseProgressTicker(container, startedAt, state.parseEstimate);
    try {
      const parsed = LAYOUT_EXT.test(file.name)
        ? await extractDocumentText(file, abort.signal)
        : { text: await file.text(), sections: [] };
      if (abort.signal.aborted) return;
      applyParsed(parsed, file.name);
      if (LAYOUT_EXT.test(file.name)) rememberParseRate(file.size, (Date.now() - startedAt) / 1000);
    } catch (error) {
      if (error?.name === 'AbortError' || abort.signal.aborted) {
        state.status = 'idle';
        state.message = '已取消读取';
        state.fileName = '';
        state.sections = [];
      } else {
        state.status = 'error';
        state.message = error.message;
        state.sections = [];
      }
    } finally {
      clearInterval(ticker);
      if (state.parseAbort === abort) state.parseAbort = null;
      state.parsing = false;
      renderWorkspace(container, state);
    }
  };

  container.querySelector('[data-action="cancel-parse"]')?.addEventListener('click', () => {
    state.parseAbort?.abort();
  });

  const upload = container.querySelector('.academic-upload');
  container.querySelector('#academic-file').addEventListener('change', e => handleFile(e.target.files?.[0]));
  upload.addEventListener('dragover', e => { e.preventDefault(); upload.classList.add('academic-upload-dragging'); });
  upload.addEventListener('dragleave', () => upload.classList.remove('academic-upload-dragging'));
  upload.addEventListener('drop', e => { e.preventDefault(); upload.classList.remove('academic-upload-dragging'); handleFile(e.dataTransfer.files?.[0]); });

  const loadSample = sample => {
    state.layoutSections = [];
    applyParsed({ text: sample.text, sections: [] }, sample.fileName);
    state.message = `已填入${sample.lang}示例《${sample.title}》，可直接提交检测`;
    renderWorkspace(container, state);
  };
  container.querySelector('[data-action="sample-zh"]')?.addEventListener('click', () => loadSample(SAMPLES.zh));
  container.querySelector('[data-action="sample-en"]')?.addEventListener('click', () => loadSample(SAMPLES.en));

  container.querySelector('[data-action="clear-text"]')?.addEventListener('click', () => {
    if (busy) return;
    Object.assign(state, {
      text: '',
      sections: [],
      layoutSections: [],
      selectedIds: [],
      expandedIds: [],
      fileName: '',
      markdownPath: '',
      skipped: null,
      result: null,
      submittedText: '',
      status: 'idle',
      message: '已清除正文',
    });
    const fileInput = container.querySelector('#academic-file');
    if (fileInput) fileInput.value = '';
    renderWorkspace(container, state);
  });

  container.querySelector('#academic-select-all')?.addEventListener('change', e => {
    state.selectedIds = e.target.checked
      ? selectableSectionIds(state.sections, state.excludeReferences)
      : [];
    renderWorkspace(container, state);
  });
  container.querySelectorAll('details.academic-section-tree').forEach(el => {
    el.addEventListener('toggle', () => {
      const id = el.dataset.sectionId;
      if (!id) return;
      const set = new Set(state.expandedIds || []);
      el.open ? set.add(id) : set.delete(id);
      state.expandedIds = [...set];
    });
  });
  container.querySelectorAll('input[name="academic-section"]').forEach(input => {
    input.addEventListener('click', e => e.stopPropagation());
    input.addEventListener('change', () => {
      state.selectedIds = [...container.querySelectorAll('input[name="academic-section"]:checked')].map(el => el.value);
      renderWorkspace(container, state);
    });
  });
  container.querySelector('#academic-exclude').addEventListener('change', e => {
    state.excludeReferences = e.target.checked;
    if (state.excludeReferences) {
      const refIds = new Set(flattenSections(state.sections).filter(isReferenceSection).map(s => s.id));
      state.selectedIds = state.selectedIds.filter(id => !refIds.has(id));
    }
    renderWorkspace(container, state);
  });

  container.querySelectorAll('[data-action="download-report"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!state.result || btn.disabled) return;
      const prev = btn.textContent;
      btn.disabled = true;
      btn.textContent = '生成报告中…';
      try {
        await downloadDetectionReport(state);
        state.message = 'PDF 报告已下载';
      } catch (error) {
        state.message = `下载失败：${error.message}`;
        renderWorkspace(container, state);
        return;
      } finally {
        btn.disabled = false;
        btn.textContent = prev;
      }
    });
  });

  const findOrigHl = (key, frag) => {
    const nodes = [...container.querySelectorAll('.academic-orig-pane .academic-hl')];
    const byJump = nodes.find(el => el.getAttribute('data-jump') === key)
      || container.querySelector(`#orig-sent-${key}`);
    if (byJump) return byJump;
    const needle = normSpace(
      frag?.querySelector('.academic-fragment-body p')?.textContent
      || state.result?.sentences?.[Number(key)]?.text
      || '',
    );
    if (!needle) return null;
    const head = needle.slice(0, Math.min(64, needle.length));
    return nodes.find(el => {
      const t = normSpace(el.textContent);
      return t === needle || (head.length >= 12 && t.includes(head)) || (t.length >= 12 && needle.includes(t.slice(0, 48)));
    }) || null;
  };

  const scrollChildCenter = (scroller, el) => {
    if (!scroller || !el) return;
    const sRect = scroller.getBoundingClientRect();
    const eRect = el.getBoundingClientRect();
    const top = eRect.top - sRect.top + scroller.scrollTop - (scroller.clientHeight - eRect.height) / 2;
    scroller.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  };

  const locateSentence = (id) => {
    const key = String(id ?? '');
    if (!key) return;
    const pane = container.querySelector('#academic-orig-pane');
    const list = container.querySelector('.academic-fragment-list');
    const frag = container.querySelector(`.academic-fragment[data-frag-id="${key}"]`);
    let target = findOrigHl(key, frag);
    pane?.querySelectorAll('.academic-hl.is-active').forEach(el => el.classList.remove('is-active'));
    container.querySelectorAll('.academic-fragment.is-active').forEach(el => el.classList.remove('is-active'));
    // 仍找不到时：在原文纯文本里建 Range 并滚动（最后兜底）
    if (!target && pane) {
      const needle = normSpace(
        frag?.querySelector('.academic-fragment-body p')?.textContent
        || state.result?.sentences?.[Number(key)]?.text
        || '',
      );
      if (needle) {
        const walker = document.createTreeWalker(pane, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          const t = node.textContent || '';
          const at = normSpace(t).indexOf(needle.slice(0, Math.min(32, needle.length)));
          if (at < 0 && !t.includes(needle.slice(0, Math.min(24, needle.length)))) continue;
          const range = document.createRange();
          const rawAt = Math.max(0, t.indexOf(needle.slice(0, Math.min(24, needle.length))));
          range.setStart(node, rawAt);
          range.setEnd(node, Math.min(t.length, rawAt + Math.min(needle.length, 80)));
          const mark = document.createElement('span');
          mark.className = 'academic-hl academic-hl-high is-active';
          mark.setAttribute('data-jump', key);
          try {
            range.surroundContents(mark);
            target = mark;
          } catch {
            target = node.parentElement;
          }
          break;
        }
      }
    }
    if (target) target.classList.add('is-active');
    if (frag) frag.classList.add('is-active');
    target?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
    frag?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
    requestAnimationFrame(() => {
      scrollChildCenter(pane, target);
      scrollChildCenter(list, frag);
    });
  };

  const jumpTo = (id) => {
    if (container.querySelector('#academic-orig-pane')?.dataset.view === 'risk') {
      state.reportOrigView = 'all';
      renderWorkspace(container, state);
      requestAnimationFrame(() => requestAnimationFrame(() => locateSentence(id)));
      return;
    }
    locateSentence(id);
  };

  // 工具条
  container.querySelectorAll('[data-orig-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.reportOrigView = btn.getAttribute('data-orig-view') || 'all';
      renderWorkspace(container, state);
    });
  });
  container.querySelectorAll('[data-frag-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.reportFragFilter = btn.getAttribute('data-frag-filter') || 'all';
      renderWorkspace(container, state);
    });
  });
  // 左右互定位：直接绑在节点上，不依赖冒泡委托
  container.querySelectorAll('.academic-fragment[data-frag-id]').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      jumpTo(el.getAttribute('data-frag-id'));
    });
    el.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      jumpTo(el.getAttribute('data-frag-id'));
    });
  });
  container.querySelectorAll('.academic-orig-pane .academic-hl[data-jump]').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      jumpTo(el.getAttribute('data-jump'));
    });
  });

  container.querySelector('[data-action="submit"]').addEventListener('click', async () => {
    const text = selectedContent(state).trim();
    if (!text) return;
    if (text.length > MAX_TEXT_LENGTH) {
      state.status = 'error';
      state.message = `已选正文 ${text.length.toLocaleString()} 字符，超过上限 ${MAX_TEXT_LENGTH.toLocaleString()}，请减少勾选章节后再测`;
      return renderWorkspace(container, state);
    }
    state.loading = true;
    state.message = '';
    state.submittedText = text;
    renderWorkspace(container, state);
    try {
      // api.invoke 已解包 { data: ... }，这里拿到的就是检测结果本体
      const result = await api.invoke('/text/academic', { content: text, excludeReferences: state.excludeReferences });
      if (!result || typeof result !== 'object') throw new Error('检测服务未返回有效结果');
      state.result = result;
      state.status = 'ready';
      const units = countUnits(text);
      const scored = (state.result.sentences || []).length;
      const riskN = (state.result.sentences || []).filter(item => Number(item.ai_score || 0) >= 0.42).length;
      state.message = `检测已完成 · 送检 ${units.toLocaleString()} ${unitLabel(textLang(text))} · ${scored} 句打分`;
      saveDetectionHistory({
        text,
        aiScore: Math.round(Number(state.result.ai_score || 0) * 100),
        label: state.result.label_zh || '',
        sentenceCount: scored,
        riskCount: riskN,
        scope: scopeLine(state),
        fileName: state.fileName || '',
      });
      sessionStorage.setItem('academicReductionInput', JSON.stringify({
        text, result: state.result, scope: scopeLine(state), skipped: state.skipped, fileName: state.fileName, createdAt: Date.now(),
      }));
    } catch (error) {
      state.status = 'error';
      state.message = `检测失败：${error.message}`;
      state.result = null;
      state.submittedText = '';
    } finally {
      state.loading = false;
      renderWorkspace(container, state);
    }
  });
}

export function renderTextAcademic(container, route) {
  void route;
  if (!container?.querySelector) return;
  renderWorkspace(container, {
    text: '', fileName: '', sections: [], layoutSections: [], selectedIds: [], expandedIds: [],
    excludeReferences: false, result: null, submittedText: '', loading: false, parsing: false, skipped: null,
    reportOrigView: 'all', reportFragFilter: 'all',
    status: 'idle', message: '',
  });
}
