import { refundComparisonDimensions, refundComparisonOutcomes } from './comparison.js';
import { presentRefundResult } from './presentation.js';

export function renderRefundComparison(state,blocked) {
  const node=(tag,className,text)=>{const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;};
  const section=node('section','refund-comparison');section.tabIndex=-1;section.setAttribute('aria-label','商品与描述核对');
  section.append(node('h4','','商品与描述核对'));
  if(state.result){
    const result=state.result;
    const copy=presentRefundResult(result);
    section.append(node('p','refund-result-summary',copy.summary),node('p','refund-result-scope',`${result.coverage==='partial'?'部分覆盖':'完整覆盖'}：${copy.scope}`));
    const table=node('table','refund-comparison-table');const head=node('thead');const titles=node('tr');
    for(const title of ['核对项','参照资料','图片观察与依据','结论']){const th=node('th','',title);th.scope='col';titles.append(th);}
    head.append(titles);table.append(head);const body=node('tbody');
    for(const check of result.checks){
      const row=node('tr');row.dataset.comparisonCheck=check.dimension;
      const name=node('th','',refundComparisonDimensions[check.dimension]);name.scope='row';
      const reference=node('td','',result.references[check.dimension] || '未提供参照资料');reference.dataset.label='参照资料';
      const observed=node('td');observed.dataset.label='图片观察与依据';observed.append(node('p','',check.observed),node('p','refund-comparison-evidence',check.evidence));
      const outcome=node('td');outcome.dataset.label='结论';const badge=node('span','refund-outcome',refundComparisonOutcomes[check.outcome]);badge.dataset.outcome=check.outcome;outcome.append(badge);
      row.append(name,reference,observed,outcome);body.append(row);
    }
    table.append(body);section.append(table);
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
