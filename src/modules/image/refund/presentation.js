import { refundSourceFusion } from './source-fusion-policy.js';

/** Product copy describes capabilities; implementation names remain internal. */
export function presentRefundResult(result) {
  if(result.kind==='tamper' && result.localization){
    const info=result.localization;
    if(info.status==='not_triggered'){
      const label=info.gate.provider===refundSourceFusion.provider?'综合来源信号':'来源信号';
      return {label:'未触发定位',summary:`${label} ${(info.gate.score*100).toFixed(1)}%，本次未执行局部定位。`,scope:'来源信号低于定位触发值；未执行不代表未修改'};
    }
    return {label:info.markedPixels?'发现可疑区域':'未返回可疑区域',summary:info.markedPixels?'已在原图上标记可疑位置。':'本次未标记可疑区域。',scope:'候选标记已映射至原图，供人工复核'};
  }
  if(result.kind==='ai' && Number.isFinite(result.provenance?.generatedScore)){
    const score=(result.provenance.generatedScore*100).toFixed(1);
    if(result.provenance.provider===refundSourceFusion.provider){
      const label=result.risk==='low'?'来源信号较低':'建议人工复核';
      return {label,summary:`综合来源信号 ${score}%。`,scope:'多路图片来源核验'};
    }
    return {summary:`AI 来源信号：${score}%。`,scope:'本次分析覆盖图片的部分区域'};
  }
  if(result.kind==='comparison')return {summary:result.summary,scope:'当前凭证与已填写的商品资料'};
  return {summary:result.summary,scope:result.scope};
}
