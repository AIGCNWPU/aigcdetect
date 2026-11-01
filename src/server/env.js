import { readFileSync } from 'node:fs';

const ALLOWED_KEY = /^(?:TEXT_MODEL|EGTE)_[A-Z0-9_]+$/u;

function decodeValue(raw) {
  const value = raw.trim();
  if (value.length >= 2 && value[0] === "'" && value.at(-1) === "'") return value.slice(1, -1);
  if (value.length >= 2 && value[0] === '"' && value.at(-1) === '"') {
    return value.slice(1, -1).replace(/\\n/gu, '\n').replace(/\\r/gu, '\r').replace(/\\"/gu, '"').replace(/\\\\/gu, '\\');
  }
  return value;
}

export function parseServerEnv(text) {
  const values = {};
  for (const originalLine of String(text).replace(/^\uFEFF/u, '').split(/\r?\n/u)) {
    const line = originalLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/u.exec(line);
    if (!match || !ALLOWED_KEY.test(match[1])) continue;
    values[match[1]] = decodeValue(match[2]);
  }
  return values;
}

export function applyServerEnv(text, target = process.env) {
  const values = parseServerEnv(text);
  let applied = 0;
  for (const [key, value] of Object.entries(values)) {
    if (target[key] !== undefined) continue;
    target[key] = value;
    applied += 1;
  }
  return applied;
}

export function loadServerEnv(file, target = process.env) {
  try {
    return applyServerEnv(readFileSync(file, 'utf8'), target);
  } catch (error) {
    if (error?.code === 'ENOENT') return 0;
    throw error;
  }
}
