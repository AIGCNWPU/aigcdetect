const DEFAULT_THRESHOLDS = Object.freeze({
  humanMax: 0.5,
  aiMin: 0.8,
  dominanceMin: 0.6,
});

const LABELS = Object.freeze({
  human: '人工',
  suspectedAi: '疑似AI',
  ai: 'AI',
  unscored: '无法评分',
});

function finiteRatio(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 1 ? number : fallback;
}

export function normalizeAiThresholds(value = {}) {
  const thresholds = {
    humanMax: finiteRatio(value.humanMax, DEFAULT_THRESHOLDS.humanMax),
    aiMin: finiteRatio(value.aiMin, DEFAULT_THRESHOLDS.aiMin),
    dominanceMin: finiteRatio(value.dominanceMin, DEFAULT_THRESHOLDS.dominanceMin),
  };
  if (thresholds.humanMax >= thresholds.aiMin) {
    thresholds.humanMax = DEFAULT_THRESHOLDS.humanMax;
    thresholds.aiMin = DEFAULT_THRESHOLDS.aiMin;
  }
  return thresholds;
}

export function contentCharacterCount(value) {
  return Array.from(String(value || '').replace(/\s/gu, '')).length;
}

export function classifyAiScore(score, thresholds = DEFAULT_THRESHOLDS) {
  if (!Number.isFinite(score)) return { label: 'unscored', labelZh: LABELS.unscored };
  if (score < thresholds.humanMax) return { label: 'human', labelZh: LABELS.human };
  if (score >= thresholds.aiMin) return { label: 'ai', labelZh: LABELS.ai };
  return { label: 'suspected-ai', labelZh: LABELS.suspectedAi };
}

function weightedScore(items) {
  let weighted = 0;
  let characters = 0;
  for (const item of items) {
    if (!Number.isFinite(item.aiScore)) continue;
    const length = item.characterCount || contentCharacterCount(item.text);
    weighted += item.aiScore * length;
    characters += length;
  }
  return { score: characters ? weighted / characters : null, characterCount: characters };
}

function metadataOf(items) {
  const modelVersions = [...new Set(items.map(item => item.modelVersion).filter(Boolean))];
  return {
    modelVersion: modelVersions.length === 1 ? modelVersions[0] : undefined,
    modelVersions,
    thresholds: items[0]?.thresholds,
  };
}

function paragraphScores(parts) {
  const groups = new Map();
  for (const part of parts) {
    for (const item of part.findings.filter(value => value.status === 'success')) {
      const paragraphIndexes = Array.isArray(item.paragraphIndexes) && item.paragraphIndexes.length ? item.paragraphIndexes : [item.paragraphIndex];
      const key = `${item.chapterId || ''}:${paragraphIndexes.join(',')}`;
      const group = groups.get(key) || [];
      group.push(item);
      groups.set(key, group);
    }
  }
  return [...groups.values()].map(items => {
    const weighted = weightedScore(items);
    const classified = classifyAiScore(weighted.score, items[0].thresholds);
    const paragraphIndexes = [...new Set(items.flatMap(item => Array.isArray(item.paragraphIndexes) && item.paragraphIndexes.length ? item.paragraphIndexes : [item.paragraphIndex]))];
    return {
      ...(items[0].chapterId ? { chapterId: items[0].chapterId, chapter: items[0].chapter } : {}),
      paragraphIndex: paragraphIndexes[0],
      paragraphIndexes,
      paragraphStart: paragraphIndexes[0],
      paragraphEnd: paragraphIndexes.at(-1),
      start: Math.min(...items.map(item => item.start)),
      end: Math.max(...items.map(item => item.end)),
      score: weighted.score,
      characterCount: weighted.characterCount,
      label: classified.label,
      labelZh: classified.labelZh,
      ...metadataOf(items),
    };
  });
}

function suspiciousFragments(parts) {
  const fragments = [];
  for (const part of parts) {
    let current = [];
    const flush = () => {
      if (!current.length) return;
      const weighted = weightedScore(current);
      const classified = classifyAiScore(weighted.score, current[0].thresholds);
      const start = current[0].start;
      const end = current.at(-1).end;
      const sentenceIndexes = current.flatMap(item => item.sentenceIndexes);
      fragments.push({
        fragmentId: `ai-fragment-${String(fragments.length + 1).padStart(4, '0')}`,
        ...(current[0].chapterId ? { chapterId: current[0].chapterId, chapter: current[0].chapter } : {}),
        paragraphStart: current[0].paragraphIndexes?.[0] || current[0].paragraphIndex,
        paragraphEnd: current.at(-1).paragraphIndexes?.at(-1) || current.at(-1).paragraphIndex,
        sentenceIndexes,
        start,
        end,
        text: part.content.slice(start, end),
        characterCount: weighted.characterCount,
        score: weighted.score,
        label: classified.label,
        labelZh: classified.labelZh,
        ...metadataOf(current),
      });
      current = [];
    };
    for (const item of part.findings) {
      if (item.status !== 'success' || item.label === 'human') {
        flush();
        continue;
      }
      const previous = current.at(-1);
      const gap = previous ? part.content.slice(previous.end, item.start) : '';
      if (previous && (previous.chapterId !== item.chapterId || /\S/u.test(gap))) flush();
      current.push(item);
    }
    flush();
  }
  return fragments;
}

function distribution(findings, thresholds) {
  const characters = { human: 0, ai: 0, suspectedAi: 0, unscored: 0 };
  for (const item of findings) {
    const length = item.characterCount || contentCharacterCount(item.text);
    if (item.label === 'human') characters.human += length;
    else if (item.label === 'ai') characters.ai += length;
    else if (item.label === 'suspected-ai') characters.suspectedAi += length;
    else characters.unscored += length;
  }
  const scoredCharacters = characters.human + characters.ai + characters.suspectedAi;
  const totalCharacters = scoredCharacters + characters.unscored;
  const ratios = {
    human: scoredCharacters ? characters.human / scoredCharacters : 0,
    ai: scoredCharacters ? characters.ai / scoredCharacters : 0,
    suspectedAi: scoredCharacters ? characters.suspectedAi / scoredCharacters : 0,
  };
  const aiRelated = ratios.ai + ratios.suspectedAi;
  const composition = scoredCharacters === 0
    ? '无法判定'
    : ratios.human >= thresholds.dominanceMin
      ? '人工为主'
      : aiRelated >= thresholds.dominanceMin ? 'AI为主' : '人机混写';
  return { characters, ratios, scoredCharacters, totalCharacters, composition };
}

export function aggregateAiFindings(parts) {
  const findings = parts.flatMap(part => part.findings);
  const successful = findings.filter(item => item.status === 'success');
  const thresholds = successful[0]?.thresholds || normalizeAiThresholds();
  const overall = weightedScore(successful);
  const classified = classifyAiScore(overall.score, thresholds);
  return {
    fragments: suspiciousFragments(parts),
    paragraphScores: paragraphScores(parts),
    documentScore: {
      score: overall.score,
      characterCount: overall.characterCount,
      label: classified.label,
      labelZh: classified.labelZh,
      ...metadataOf(successful),
    },
    distribution: distribution(findings, thresholds),
  };
}

