import { refundComparisonDimensions, refundComparisonOutcomes } from './comparison.js';
import { presentRefundResult } from './presentation.js';
import { renderAftersalesComparisonTable } from '../../../lib/aftersales-comparison-table.js';

export function renderRefundComparison(state,blocked) {
  const node=(tag,className,text)=>{const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;};
  const section=node('section','refund-comparison');section.tabIndex=-1;section.setAttribute('aria-label','商品与描述核对');
  section.append(node('h4','','商品与描述核对'));
  if(state.result){
    const result=state.result;
    const copy=presentRefundResult(result);
    section.append(node('p','refund-result-summary',copy.summary),node('p','refund-result-scope',`${result.coverage==='partial'?'部分覆盖':'完整覆盖'}：${copy.scope}`));
    section.append(renderAftersalesComparisonTable(result,{
      dimensions:refundComparisonDimensions,outcomes:refundComparisonOutcomes,observationLabel:'图片观察与依据',
    }));
  } else {
    const states={idle:'未核对',queued:'排队中',running:'核对中',failed:'核对失败',cancelled:'已取消'};
    section.append(node('p','refund-result-pending',states[state.status] || '未核对'));
    if(state.error)section.append(node('p','refund-result-error',state.error));
  }
  if(['failed','cancelled'].includes(state.status)){
    const retry=node('button','refund-button refund-button-secondary','重试商品与描述核对');retry.type='button';retry.dataset.retry='comparison';retry.dataset.focus='retry-comparison';retry.disabled=blocked;section.append(retry);
  }
  return section;
}
