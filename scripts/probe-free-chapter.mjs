import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBrowserRenderer, loadBrowserRendererEnv } from '../services/text-browser-renderer/server.mjs';
import { loadTextImportParserEnv, parseImageWithMineru } from '../services/text-import-parser/server.mjs';
import { extractNovelContent, fetchPublicPage } from '../src/modules/text/novel-import.js';

const minimumOcrLength = 60;

function serializeError(error) {
  if (!error) return null;
  return {
    name: error.name || 'Error',
    code: error.code || 'UNKNOWN_ERROR',
    status: error.status || null,
    message: error.message || String(error),
    reason: error.details?.reason || '',
  };
}

function normalizeText(value) {
  return String(value || '')
    .replace(/\r/gu, '')
    .split(/\n+/u)
    .map(line => line.replace(/[ \t\u00a0\u200b\ufeff]+/gu, ' ').trim())
    .filter(Boolean)
    .filter((line, index, lines) => index === 0 || line !== lines[index - 1])
    .join('\n')
    .trim();
}

function mergeOcrTexts(results) {
  const lines = [];
  const seen = new Set();
  for (const result of results) {
    for (const line of normalizeText(result?.text).split('\n')) {
      if (!line || seen.has(line)) continue;
      seen.add(line);
      lines.push(line);
    }
  }
  return lines.join('\n').trim();
}

function resultFromExtraction(page, extraction, extractionMethod) {
  return {
    sourceUrl: page.sourceUrl,
    finalUrl: page.finalUrl,
    ...extraction,
    extractionMethod,
  };
}

export async function probeFreeChapter(sourceUrl, options = {}) {
  const fetchPage = options.fetchPage || fetchPublicPage;
  const extract = options.extract || extractNovelContent;
  const parseImage = options.parseImage || parseImageWithMineru;
  const renderer = options.renderer || createBrowserRenderer();
  const ownsRenderer = !options.renderer;
  const diagnostic = {
    sourceUrl,
    status: 'failed',
    attempted: [],
    staticError: null,
    renderedError: null,
    ocrErrors: [],
    browser: null,
  };

  try {
    diagnostic.attempted.push('static-html');
    try {
      const page = await fetchPage(sourceUrl);
      const extraction = extract(page.html, page);
      diagnostic.status = 'completed';
      return { diagnostic, captures: [], result: resultFromExtraction(page, extraction, 'static-html') };
    } catch (error) {
      diagnostic.staticError = serializeError(error);
    }

    diagnostic.attempted.push('browser-rendered');
    let rendered;
    try {
      rendered = await renderer.probe(sourceUrl);
      diagnostic.browser = {
        finalUrl: rendered.finalUrl,
        title: rendered.title,
        renderer: rendered.renderer,
        readableCharacters: normalizeText(rendered.readable?.text).length,
        ...(rendered.probe?.diagnostics || {}),
      };
      try {
        const extraction = extract(rendered.html, rendered);
        diagnostic.status = 'completed';
        return {
          diagnostic,
          captures: rendered.probe?.captures || [],
          result: resultFromExtraction(rendered, extraction, 'browser-rendered'),
        };
      } catch (error) {
        diagnostic.renderedError = serializeError(error);
      }
    } catch (error) {
      diagnostic.renderedError = serializeError(error);
      return { diagnostic, captures: [], result: null };
    }

    const captures = rendered.probe?.captures || [];
    if (options.useOcr === false || !captures.length) return { diagnostic, captures, result: null };

    diagnostic.attempted.push('browser-screenshot-ocr');
    const parsed = [];
    for (const [index, capture] of captures.entries()) {
      try {
        parsed.push(await parseImage(capture.data, { extension: '.png' }));
      } catch (error) {
        diagnostic.ocrErrors.push({ capture: index + 1, ...serializeError(error) });
      }
    }
    const content = mergeOcrTexts(parsed);
    if (content.length < minimumOcrLength) return { diagnostic, captures, result: null };
    if (diagnostic.browser?.hasLoadingSignal && content.length < 300) {
      diagnostic.ocrErrors.push({ capture: 0, code: 'PAGE_STILL_LOADING', status: null, message: '页面仍停留在加载状态，OCR结果不足以作为章节正文。', reason: 'LOADING_SHELL' });
      return { diagnostic, captures, result: null };
    }

    const restricted = Boolean(diagnostic.browser?.hasRestrictionSignal);
    diagnostic.status = 'completed';
    return {
      diagnostic,
      captures,
      result: {
        sourceUrl,
        finalUrl: rendered.finalUrl,
        site: 'generic',
        workTitle: '',
        title: normalizeText(rendered.title) || 'OCR章节提取结果',
        content,
        extractionStatus: restricted ? 'partial' : 'completed',
        completeness: restricted ? 'partial' : 'unknown',
        extractionMethod: 'browser-screenshot-ocr',
        notice: restricted
          ? '实验性OCR仅识别当前公开可见区域；页面同时存在登录、会员、客户端或其他限制提示，结果必定不代表完整章节。'
          : '实验性OCR仅识别当前公开可见区域，可能存在错字、漏段和界面噪声，必须人工复核。',
      },
    };
  } finally {
    if (ownsRenderer) await renderer.close().catch(() => {});
  }
}

function markdownReport(result) {
  return [
    `# ${result.title || '免费章节提取实验'}`,
    '',
    `- 来源：${result.sourceUrl}`,
    `- 最终地址：${result.finalUrl}`,
    `- 提取方式：${result.extractionMethod}`,
    `- 覆盖状态：${result.completeness}`,
    `- 提示：${result.notice}`,
    '',
    '## 识别正文',
    '',
    result.content,
    '',
  ].join('\n');
}

export async function writeProbeArtifacts(report, outputDirectory) {
  await mkdir(outputDirectory, { recursive: true });
  const captureFiles = [];
  for (const [index, capture] of report.captures.entries()) {
    const name = `capture-${String(index + 1).padStart(2, '0')}-${capture.kind || 'page'}.png`;
    await writeFile(path.join(outputDirectory, name), capture.data);
    captureFiles.push(name);
  }
  const diagnostic = {
    ...report.diagnostic,
    captures: report.captures.map((capture, index) => ({
      file: captureFiles[index],
      kind: capture.kind,
      id: capture.id,
      width: capture.width,
      height: capture.height,
      bytes: capture.data.length,
    })),
    result: report.result ? { ...report.result, content: undefined, characterCount: report.result.content.length } : null,
  };
  await writeFile(path.join(outputDirectory, 'diagnostic.json'), JSON.stringify(diagnostic, null, 2), 'utf8');
  if (report.result) await writeFile(path.join(outputDirectory, 'result.md'), markdownReport(report.result), 'utf8');
  return { outputDirectory, captureFiles, hasResult: Boolean(report.result) };
}

function cliOptions(argv) {
  const options = { sourceUrl: '', outputDirectory: '', useOcr: true };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--out') options.outputDirectory = argv[++index] || '';
    else if (value === '--no-ocr') options.useOcr = false;
    else if (!options.sourceUrl) options.sourceUrl = value;
    else throw new Error(`无法识别参数：${value}`);
  }
  return options;
}

async function main() {
  const options = cliOptions(process.argv.slice(2));
  if (!options.sourceUrl) {
    console.error('用法：npm run probe:free-chapter -- <公开单章节URL> [--out 输出目录] [--no-ocr]');
    process.exitCode = 1;
    return;
  }
  await Promise.all([loadBrowserRendererEnv(), loadTextImportParserEnv()]);
  const timestamp = new Date().toISOString().replace(/[:.]/gu, '-');
  const outputDirectory = path.resolve(options.outputDirectory || path.join('output', 'free-chapter-probe', timestamp));
  const report = await probeFreeChapter(options.sourceUrl, { useOcr: options.useOcr });
  const artifacts = await writeProbeArtifacts(report, outputDirectory);
  console.log(JSON.stringify({ status: report.result ? 'completed' : 'failed', ...artifacts, result: report.result ? {
    title: report.result.title,
    characterCount: report.result.content.length,
    extractionMethod: report.result.extractionMethod,
    completeness: report.result.completeness,
  } : null, diagnostic: report.diagnostic }, null, 2));
  if (!report.result) process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch(error => {
    console.error(JSON.stringify({ status: 'failed', error: serializeError(error) }, null, 2));
    process.exitCode = 1;
  });
}
