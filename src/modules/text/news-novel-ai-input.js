function riskyCategory(codePoint) {
  if (codePoint >= 0xD800 && codePoint <= 0xDFFF) return 'invalid-surrogate';
  if (codePoint === 0xFFFD) return 'replacement-character';
  if ((codePoint >= 0xE000 && codePoint <= 0xF8FF)
    || (codePoint >= 0xF0000 && codePoint <= 0xFFFFD)
    || (codePoint >= 0x100000 && codePoint <= 0x10FFFD)) return 'private-use';
  if ((codePoint >= 0 && codePoint <= 0x1F) || (codePoint >= 0x7F && codePoint <= 0x9F)) return 'control';
  if ((codePoint >= 0x200B && codePoint <= 0x200F)
    || (codePoint >= 0x202A && codePoint <= 0x202E)
    || (codePoint >= 0x2060 && codePoint <= 0x206F)
    || codePoint === 0xFEFF) return 'invisible-format';
  if ((codePoint >= 0xFDD0 && codePoint <= 0xFDEF) || (codePoint & 0xFFFF) >= 0xFFFE) return 'noncharacter';
  return '';
}

/** 仅供新闻和小说在送入AI检测算法前清洗副本；不修改存储、展示或定位使用的原文。 */
export function sanitizeNewsNovelAiText(value) {
  const original = String(value || '');
  const categories = {};
  const output = [];
  let removedCharacters = 0;
  for (const character of original) {
    const category = riskyCategory(character.codePointAt(0));
    if (!category) {
      output.push(character);
      continue;
    }
    removedCharacters += 1;
    categories[category] = (categories[category] || 0) + 1;
    output.push(' ');
  }
  const text = output.join('').normalize('NFC').replace(/\s+/gu, ' ').trim();
  return {
    text,
    changed: text !== original,
    removedCharacters,
    originalCharacters: [...original].length,
    sanitizedCharacters: [...text].length,
    categories,
  };
}
