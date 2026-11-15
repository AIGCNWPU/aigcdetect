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
    || (codePoint >= 0xFE00 && codePoint <= 0xFE0F)
    || (codePoint >= 0xE0000 && codePoint <= 0xE007F)
    || (codePoint >= 0xE0100 && codePoint <= 0xE01EF)
    || [0x00AD, 0x034F, 0x061C, 0x115F, 0x1160, 0x17B4, 0x17B5, 0x180E, 0x3164, 0xFFA0, 0xFEFF].includes(codePoint)) return 'invisible-format';
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
  // 纯文本本身是合法Markdown；NFKC与空白归一化用于生成稳定的Markdown兼容送检副本。
  const text = output.join('').normalize('NFKC').replace(/\s+/gu, ' ').trim();
  return {
    text,
    changed: text !== original,
    removedCharacters,
    originalCharacters: [...original].length,
    sanitizedCharacters: [...text].length,
    categories,
  };
}
