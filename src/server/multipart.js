// 极简 multipart/form-data 解析器：项目约定零第三方运行依赖，仅覆盖
// 本服务需要的场景——单个文件字段 + 少量文本字段，整体缓存在内存并限制大小。
// 复杂场景（多文件、超大分片）仍应交给专业解析库或对象存储直传。

const MAX_BODY_BYTES = 510 * 1024 * 1024; // 500 MiB 视频上限 + 边界开销

export async function readMultipartBody(request, { maxBytes = MAX_BODY_BYTES } = {}) {
  const contentType = String(request.headers['content-type'] || '');
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!match) throw Object.assign(new Error('缺少 multipart 边界。'), { code: 'BAD_MULTIPART', status: 400 });
  const boundary = Buffer.from(`--${match[1] || match[2]}`);
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBytes) throw Object.assign(new Error('上传内容超过大小限制。'), { code: 'PAYLOAD_TOO_LARGE', status: 413 });
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks);
  const parts = [];
  let cursor = body.indexOf(boundary);
  while (cursor !== -1) {
    const next = body.indexOf(boundary, cursor + boundary.length);
    if (next === -1) break;
    // 跳过边界行与结尾的 "--"，去掉分片首尾的 CRLF
    let start = cursor + boundary.length;
    if (body.slice(start, start + 2).toString() === '--') break;
    if (body[start] === 0x0d && body[start + 1] === 0x0a) start += 2;
    let end = next - 2; // 每个分片以 CRLF 结束、紧贴下一边界
    if (end < start) end = start;
    parts.push(body.slice(start, end));
    cursor = next;
  }
  const fields = new Map();
  const files = [];
  for (const part of parts) {
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;
    const headerText = part.slice(0, headerEnd).toString('utf8');
    const data = part.slice(headerEnd + 4);
    const disposition = /content-disposition:\s*form-data;([^\r\n]*)/i.exec(headerText)?.[1] || '';
    const name = /name="([^"]*)"/i.exec(disposition)?.[1];
    if (name === undefined) continue;
    const filename = /filename="([^"]*)"/i.exec(disposition)?.[1];
    if (filename === undefined) {
      fields.set(name, data.toString('utf8'));
    } else if (filename) {
      files.push({ name, filename, data });
    }
  }
  return { fields, files };
}
