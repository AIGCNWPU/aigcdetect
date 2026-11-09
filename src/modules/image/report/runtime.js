// Shared browser runtime for report exports: loads the vendored pdf-lib stack
// (same assets as the refund scenario) and decodes data/object URLs for embedding.

const reportAssets = './public/vendor/refund-pdf/';
let reportRuntime;

function loadScript(file, globalName) {
  if (globalThis[globalName]) return Promise.resolve(globalThis[globalName]);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL(reportAssets + file, document.baseURI).href;
    script.onload = () => (globalThis[globalName] ? resolve(globalThis[globalName]) : reject(new Error('PDF 组件加载失败。')));
    script.onerror = () => { script.remove(); reject(new Error('PDF 组件读取失败，请重试。')); };
    document.head.append(script);
  });
}

export function loadReportPdfRuntime() {
  if (!reportRuntime) {
    reportRuntime = (async () => {
      const [PDFLib, fontkit, response] = await Promise.all([
        loadScript('pdf-lib.min.js', 'PDFLib'),
        loadScript('fontkit.umd.min.js', 'fontkit'),
        fetch(new URL(reportAssets + 'NotoSansSC-Regular.ttf', document.baseURI)),
      ]);
      if (!response.ok) throw new Error('中文字体读取失败，请重试。');
      return { PDFLib, fontkit, fontBytes: new Uint8Array(await response.arrayBuffer()) };
    })().catch((error) => { reportRuntime = null; throw error; });
  }
  return reportRuntime;
}

// Decode a data/object/relative URL into {type,bytes,width,height} for embedding.
// WebP and oversized images are re-encoded through a canvas as JPEG.
export async function decodeReportImage(src, { signal, maxPixels = 3_500_000 } = {}) {
  if (!src || typeof src !== 'string') return null;
  const dataMatch = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(src);
  let bytes, mime;
  if (dataMatch) {
    mime = dataMatch[1];
    if (mime === 'image/webp') {
      // fall through to canvas path below using the raw data URL
    } else {
      const binary = atob(dataMatch[2]);
      bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return { type: mime === 'image/png' ? 'image/png' : 'image/jpeg', bytes };
    }
  }
  try {
    const response = await fetch(src, { signal });
    if (!response.ok) return null;
    const blob = await response.blob();
    signal?.throwIfAborted();
    const bitmap = await createImageBitmap(blob);
    let { width, height } = bitmap;
    if (width * height > maxPixels) {
      const scale = Math.sqrt(maxPixels / (width * height));
      width = Math.max(1, Math.round(width * scale));
      height = Math.max(1, Math.round(height * scale));
    }
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    const encoded = await new Promise((resolve, reject) => canvas.toBlob((value) => (value ? resolve(value) : reject(new Error('报告图片转换失败。'))), 'image/jpeg', 0.92));
    signal?.throwIfAborted();
    return { type: 'image/jpeg', bytes: new Uint8Array(await encoded.arrayBuffer()) };
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    return null;
  }
}

export function downloadReportBytes(bytes, filename, mime = 'application/pdf') {
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
