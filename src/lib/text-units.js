/** 中文按汉字、英文按词；不计标点与空白。中文稿夹杂英文词时计入词数。 */
export function textLang(text) {
  const s = String(text || '');
  const zh = (s.match(/[\u4e00-\u9fff]/g) || []).length;
  const en = (s.match(/[A-Za-z]/g) || []).length;
  return zh >= en ? 'zh' : 'en';
}

export function countUnits(text, lang) {
  const s = String(text || '');
  const mode = lang || textLang(s);
  const words = (s.match(/[A-Za-z0-9]+(?:'[A-Za-z0-9]+)*/g) || []).length;
  if (mode === 'en') return words;
  return (s.match(/[\u4e00-\u9fff]/g) || []).length + words;
}

export const unitLabel = lang => (lang === 'en' ? '词' : '字');

/** 与润色后端一致：汉字略多即 zh */
export function detectTextLanguage(text) {
  const s = String(text || '');
  const zh = (s.match(/[\u3400-\u9fff]/g) || []).length;
  const en = (s.match(/[A-Za-z]/g) || []).length;
  return zh > en * 0.08 ? 'zh' : 'en';
}

/** 可读性 / 句子结构：本地启发式，非模型分 */
export function styleScores(text, sentences, lang) {
  const mode = lang || textLang(text);
  const unit = unitLabel(mode);
  const parts = (sentences?.length ? sentences.map(s => String(s.text || '')) : [String(text || '')])
    .map(t => t.trim()).filter(Boolean);
  const lens = parts.map(t => countUnits(t, mode)).filter(n => n > 0);
  if (!lens.length) {
    return {
      readability: 0, structure: 0, avgLen: 0, ideal: mode === 'en' ? 18 : 45,
      unit, clausePerSent: 0, variety: 0, readLabel: '暂无', structLabel: '暂无',
    };
  }
  const avg = lens.reduce((a, b) => a + b, 0) / lens.length;
  const ideal = mode === 'en' ? 18 : 45;
  const spread = mode === 'en' ? 12 : 30;
  const delta = avg - ideal;
  const readability = Math.max(0, Math.min(100, Math.round(100 - (Math.abs(delta) / spread) * 55)));
  // 标签描述句长相对参考值，不是分数档；接近参考 → 合适（高分），偏离 → 偏短/偏长
  const readLabel = Math.abs(delta) <= spread * 0.35 ? '合适' : (delta < 0 ? '偏短' : '偏长');
  const variance = lens.reduce((s, n) => s + (n - avg) ** 2, 0) / lens.length;
  const cv = avg ? Math.sqrt(variance) / avg : 0;
  const variety = Math.max(0, Math.min(100, Math.round(cv * 180)));
  const joined = parts.join(' ');
  const clauseHits = mode === 'en'
    ? (joined.match(/\b(which|that|although|because|while|whereas|however|if|when)\b/gi) || []).length
    : (joined.match(/[，；：]|因为|虽然|然而|因此|并且|如果|当/g) || []).length;
  const clausePerSent = Math.round((clauseHits / parts.length) * 100) / 100;
  const structure = Math.max(0, Math.min(100, Math.round(variety * 0.55 + Math.min(1, clauseHits / parts.length) * 45)));
  const structLabel = structure >= 62 ? '较丰富' : (structure >= 38 ? '适中' : '偏平直');
  return {
    readability,
    structure,
    avgLen: Math.round(avg * 10) / 10,
    ideal,
    unit,
    clausePerSent,
    variety,
    readLabel,
    structLabel,
  };
}
