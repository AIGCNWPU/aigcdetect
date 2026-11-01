const MAX_REQUEST_BYTES = 100 * 1024 * 1024 + 1024 * 1024;

/** Same-origin local gateway. No model code or credentials enter the browser. */
export async function forwardDeepfake(request, response, baseUrl, requestId) {
  const health = request.method === 'GET';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), health ? 3000 : 180000);
  const onClose = () => { if (!response.writableEnded) controller.abort(); };
  response.once('close', onClose);
  try {
    if (!health && !/^multipart\/form-data;\s*boundary=/i.test(request.headers['content-type'] || '')) {
      return { status: 400, body: { error: { code: 'INVALID_UPLOAD', message: '请通过 multipart 的 video 字段上传视频。' }, requestId } };
    }
    if (Number(request.headers['content-length']) > MAX_REQUEST_BYTES) {
      return { status: 413, body: { error: { code: 'UPLOAD_TOO_LARGE', message: '视频不能超过100 MiB。' }, requestId } };
    }
    async function* limitedBody() {
      let bytes = 0;
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > MAX_REQUEST_BYTES) throw Object.assign(new Error('Upload too large'), { code: 'UPLOAD_TOO_LARGE' });
        yield chunk;
      }
    }
    const upstream = await fetch(`${baseUrl.replace(/\/$/, '')}/${health ? 'health' : 'detect'}`, {
      method: health ? 'GET' : 'POST', signal: controller.signal,
      ...(!health && { headers: { 'Content-Type': request.headers['content-type'] }, body: limitedBody(), duplex: 'half' }),
    });
    const body = await upstream.json();
    if (!upstream.ok) return { status: upstream.status, body: { error: { code: 'DETECTION_FAILED', message: typeof body.detail === 'string' ? body.detail : '检测请求失败。' }, requestId } };
    return { status: upstream.status, body: { ...body, requestId } };
  } catch (error) {
    const tooLarge = error.code === 'UPLOAD_TOO_LARGE' || error.cause?.code === 'UPLOAD_TOO_LARGE';
    return { status: tooLarge ? 413 : 503, body: { error: { code: tooLarge ? 'UPLOAD_TOO_LARGE' : 'MODEL_UNAVAILABLE', message: tooLarge ? '视频不能超过100 MiB。' : '本地智鉴服务未就绪或请求中断，请稍后重试。' }, requestId } };
  } finally {
    clearTimeout(timer);
    response.off('close', onClose);
  }
}
