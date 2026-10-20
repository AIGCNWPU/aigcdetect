import { NotImplementedError } from '../../server/errors.js';

/** AI图片检测业务接入点。当前所有场景均明确返回未实现。 */
export async function runImageScenario(scenario, payload, context) {
  void payload;
  void context;
  throw new NotImplementedError(scenario.api.operationId);
}
