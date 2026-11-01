import { NotImplementedError } from '../../server/errors.js';

/** AI视频检测业务接入点。未接入的场景返回未实现；售后视频由 aftersales/server/api.js 处理当前会话与任务路由。 */
export async function runVideoScenario(scenario, payload, context) {
  void payload;
  void context;
  throw new NotImplementedError(scenario.api.operationId);
}
