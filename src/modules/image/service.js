import {runGeneralReview,readImageExample} from './general/service.js';
import { NotImplementedError } from '../../server/errors.js';
import { runDocumentsReview } from './documents/server/review-service.js';

/** 2.1 来源检测与 2.3 材料工作台入口；售后场景由 refund/server/api.js 独立处理。 */
export async function runImageScenario(scenario, payload, context) {
  if(scenario.id==='general')return runGeneralReview(payload);
  if(scenario.id==='documents'&&payload?.action==='example')return readImageExample('documents');
  if(scenario.id==='documents')return runDocumentsReview(payload,context);
  void payload;
  void context;
  throw new NotImplementedError(scenario.api.operationId);
}
