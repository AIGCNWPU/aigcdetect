import { NotImplementedError } from '../../server/errors.js';

/** 未接入的 AI 图片场景入口。图片售后由 refund/server/api.js 处理当前分析会话与任务路由。 */
export async function runImageScenario(scenario, payload, context) {
  void payload;
  void context;
  throw new NotImplementedError(scenario.api.operationId);
}
