import { NotImplementedError } from '../../server/errors.js';

/** AI文本检测业务接入点。当前所有场景均明确返回未实现。 */
export async function runTextScenario(scenario, payload, context) {
  void payload;
  void context;
  throw new NotImplementedError(scenario.api.operationId);
}
