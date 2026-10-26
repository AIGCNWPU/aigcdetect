import { NotImplementedError } from '../../server/errors.js';
import { detectVideo, detectorHealth } from '../../server/detector.js';

const ALLOWED_EXTENSIONS = ['mp4', 'webm'];
const MAX_VIDEO_BYTES = 500 * 1024 * 1024;

/** AI视频检测业务接入点。3.1 通用检测已接入 Native-Scale 推理服务；其余场景返回未实现。 */
export async function runVideoScenario(scenario, payload, context) {
  if (scenario.id !== 'general') {
    throw new NotImplementedError(scenario.api.operationId);
  }
  const file = payload?.files?.find(item => item.name === 'video');
  const filename = String(file?.filename || '');
  const extension = filename.includes('.') ? filename.split('.').pop().toLowerCase() : '';
  if (!file) throw Object.assign(new Error('请通过 multipart 的 video 字段上传视频。'), { code: 'VALIDATION_ERROR', status: 400 });
  if (!ALLOWED_EXTENSIONS.includes(extension)) {
    throw Object.assign(new Error('仅支持 MP4 / WebM 格式的视频。'), { code: 'VALIDATION_ERROR', status: 400 });
  }
  if (file.data.length === 0) throw Object.assign(new Error('视频文件为空。'), { code: 'VALIDATION_ERROR', status: 400 });
  if (file.data.length > MAX_VIDEO_BYTES) {
    throw Object.assign(new Error('视频不能超过 500 MiB。'), { code: 'VALIDATION_ERROR', status: 413 });
  }
  const result = await detectVideo(file.data, { filename });
  void context;
  return result;
}

export { detectorHealth };
