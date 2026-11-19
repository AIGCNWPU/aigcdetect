// 小说文档先在当前页面读取为正文，检测时只提交用户核对后的文本。
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_XML_BYTES = 4 * 1024 * 1024;
const invalid = () => new Error('文档损坏、加密或格式不受支持，请另存为 DOCX 或 TXT 后重试。');

async function docxXml(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  for (; end >= Math.max(0, bytes.length - 65557); end--) {
    if (view.getUint32(end, true) === 0x06054b50 && end + 22 + view.getUint16(end + 20, true) === bytes.length) break;
  }
  if (end < Math.max(0, bytes.length - 65557)) throw invalid();
  const count = view.getUint16(end + 10, true), directoryEnd = view.getUint32(end + 16, true) + view.getUint32(end + 12, true);
  let cursor = view.getUint32(end + 16, true);
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || directoryEnd > end || count > 10000) throw invalid();
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > directoryEnd || view.getUint32(cursor, true) !== 0x02014b50) throw invalid();
    const flags = view.getUint16(cursor + 8, true), method = view.getUint16(cursor + 10, true);
    const compressed = view.getUint32(cursor + 20, true), expanded = view.getUint32(cursor + 24, true), offset = view.getUint32(cursor + 42, true);
    const nameLength = view.getUint16(cursor + 28, true), extraLength = view.getUint16(cursor + 30, true), commentLength = view.getUint16(cursor + 32, true);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    if (next > directoryEnd) throw invalid();
    const name = new TextDecoder().decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    if (name === 'word/document.xml') {
      if (flags & 1 || !expanded || expanded > MAX_XML_BYTES || offset + 30 > cursor || view.getUint32(offset, true) !== 0x04034b50) throw invalid();
      const start = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
      if (start + compressed > cursor) throw invalid();
      const data = bytes.subarray(start, start + compressed);
      let xmlBytes;
      if (method === 0) xmlBytes = data;
      else if (method === 8) {
        const reader = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
        const chunks = []; let total = 0;
        try {
          while (true) { const {done,value} = await reader.read(); if (done) break; total += value.length; if (total > MAX_XML_BYTES) throw invalid(); chunks.push(value); }
        } finally { await reader.cancel().catch(() => {}); }
        xmlBytes = new Uint8Array(total); let position = 0;
        for (const chunk of chunks) { xmlBytes.set(chunk, position); position += chunk.length; }
      } else throw invalid();
      if (xmlBytes.length !== expanded) throw invalid();
      return new TextDecoder('utf-8', {fatal:true}).decode(xmlBytes);
    }
    cursor = next;
  }
  throw invalid();
}

export async function readChapterDocument(file) {
  if (!file || !file.size) throw new Error('文档为空，请选择有正文的文档。');
  if (file.size > MAX_FILE_BYTES) throw new Error('文档不能超过 10 MB，请按章节拆分后上传。');
  const extension = file.name.split('.').pop().toLowerCase();
  if (!['txt','md','docx'].includes(extension)) throw new Error('请选择 TXT、MD 或 DOCX；旧版 DOC 请先另存为 DOCX 或 TXT。');
  const bytes = new Uint8Array(await file.arrayBuffer());
  let content;
  if (extension === 'docx') {
    try {
      const xml = await docxXml(bytes);
      if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw invalid();
      const document = new DOMParser().parseFromString(xml, 'application/xml');
      if (document.getElementsByTagName('parsererror').length) throw invalid();
      const namespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
      content = [...document.getElementsByTagNameNS(namespace, 'p')].map(paragraph => {
        const parts = [];
        function visit(node) {
          if (node.namespaceURI === namespace) {
            if (node.localName === 'del') return;
            if (node.localName === 't') { parts.push(node.textContent); return; }
            if (node.localName === 'tab') parts.push('\t');
            if (node.localName === 'br' || node.localName === 'cr') parts.push('\n');
          }
          for (const child of node.childNodes) visit(child);
        }
        visit(paragraph); return parts.join('');
      }).join('\n');
    } catch { throw invalid(); }
  } else {
    const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
    try { content = new TextDecoder(encoding, {fatal:true}).decode(bytes); }
    catch {
      try { content = new TextDecoder('gb18030', {fatal:true}).decode(bytes); }
      catch { throw new Error('无法识别文档编码，请另存为 UTF-8 文本后重试。'); }
    }
  }
  content = content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (!content.trim()) throw new Error('未读取到可用正文，请检查文档或直接粘贴正文。');
  if (content.includes('\0')) throw invalid();
  if (content.length > 100000) throw new Error('章节正文超过 100,000 字，请拆分为多个章节后上传。');
  return content;
}
