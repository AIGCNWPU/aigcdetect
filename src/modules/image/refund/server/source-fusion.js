import { readFileSync } from 'node:fs';
import { refundSourceFusion } from '../source-fusion-policy.js';

const model = JSON.parse(readFileSync(new URL('./source-fusion-trees.json', import.meta.url), 'utf8'));
if (model.format !== refundSourceFusion.profile ||
    model.features.join(',') !== 'forgelens,cospy,dear_c' || model.trees.length !== 400) {
  throw new Error('图片来源融合模型与当前配置不匹配。');
}

/** The reference Extra Trees classifier converts its input features to float32. */
export function evaluateRefundSourceFusion(forgelensLogit, cospyLogit, dearCLogit) {
  const logits = [forgelensLogit, cospyLogit, dearCLogit].map(Math.fround);
  if (logits.some(logit => !Number.isFinite(logit))) {
    throw new TypeError('图片来源融合需要三个有效的模型分数。');
  }
  let positiveScore = 0;
  for (const tree of model.trees) {
    // A leaf is [positive probability]; a branch is [feature, split, left, right].
    let node = tree[0];
    while (node.length === 4) {
      const [feature, split, left, right] = node;
      node = tree[logits[feature] <= split ? left : right];
    }
    positiveScore += node[0];
  }
  return positiveScore / model.trees.length;
}
