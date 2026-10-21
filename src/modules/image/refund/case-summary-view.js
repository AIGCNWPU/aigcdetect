import { buildRefundSummary, filterRefundSummary } from './case-summary.js';
import { refundComparisonDimensions, refundComparisonOutcomes } from './comparison.js';
import { refundRegionTypes } from './detection.js';

export function mountRefundCaseSummary(host,{onOpen}) {
  host.innerHTML=`<section class="refund-case-summary" aria-labelledby="refund-summary-title"><div class="refund-summary-heading"><div><h2 id="refund-summary-title">案件风险汇总</h2><p data-summary-case></p></div><label>筛选凭证<select aria-label="筛选凭证"><option value="all">全部凭证</option><option value="attention">需关注</option><option value="incomplete">未完成或部分覆盖</option><option value="failed">失败或已取消</option></select></label></div><p class="refund-summary-count" data-summary-count role="status" aria-live="polite"></p><div class="refund-summary-list"></div><p class="refund-summary-empty" role="status" hidden></p></section>`;
  const root=host.querySelector('section'),list=root.querySelector('.refund-summary-list'),select=root.querySelector('select'),empty=root.querySelector('.refund-summary-empty');
  let entries=[],caseNumber='';
  const expandedRegions=new Map();
  const expandedDetails=new Map();
  const labels={idle:'未检测',queued:'排队中',running:'处理中',succeeded:'已完成',failed:'失败',cancelled:'已取消'};
  const risks={low:'低风险',medium:'中风险',high:'高风险',unknown:'无法判断'};
  const node=(tag,className,text)=>{const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;};
  function link(label,row,section,regionId) {
    const button=node('button','refund-summary-link',label);button.type='button';button.dataset.summaryImage=row.id;button.dataset.summarySection=section;
    if(regionId!==undefined)button.dataset.summaryRegion=regionId;
    button.dataset.summaryFocus=JSON.stringify([row.id,section,regionId || '']);return button;
  }
  function render(){
    const focused=list.contains(document.activeElement)?document.activeElement.dataset.summaryFocus:null;
    const summary=buildRefundSummary(entries),rows=filterRefundSummary(summary.rows,select.value);
    for(const details of list.querySelectorAll('details[data-summary-image]'))expandedRegions.set(details.dataset.summaryImage,details.open);
    for(const id of expandedRegions.keys())if(!summary.rows.some(row=>row.id===id && row.regions.length))expandedRegions.delete(id);
    for(const details of list.querySelectorAll('details[data-summary-details]'))expandedDetails.set(details.dataset.summaryDetails,details.open);
    for(const id of expandedDetails.keys())if(!summary.rows.some(row=>row.id===id && [row.ai,row.tamper,row.comparison].some(state=>state.status!=='idle')))expandedDetails.delete(id);
    root.querySelector('[data-summary-case]').textContent=caseNumber ? `案件 ${caseNumber}` : '当前案件';
    root.querySelector('[data-summary-count]').textContent=`凭证 ${summary.total} 张 · 三项完整处理 ${summary.complete} 张 · 当前显示 ${rows.length} 张`;
    empty.hidden=rows.length>0;empty.textContent=summary.total?'没有符合当前筛选的凭证。':'添加图片后，可集中查看案件凭证和核对问题。';list.replaceChildren();
    for(const row of rows){
      const article=node('article','refund-summary-row');article.dataset.summaryRow=row.id;
      const header=node('div','refund-summary-row-heading');header.append(node('h3','',row.name));const open=link('查看原图',row,'image');open.setAttribute('aria-label',`查看${row.name}的原图`);header.append(open);article.append(header);
      const compact=node('div','refund-summary-compact');
      for(const [kind,title] of [['ai','AI来源风险'],['tamper','局部篡改'],['comparison','商品核对']]){
        const state=row[kind],cell=node('div','refund-summary-cell');cell.append(node('span','refund-summary-cell-title',title));
        if(state.result){
          const label=kind==='comparison'?`${row.issues.length} 项待核对${row.issues.some(issue=>issue.outcome==='unknown')?' · 含无法判断':''}`:risks[state.result.risk];
          const value=node('strong','refund-summary-label',label);if(kind!=='comparison')value.dataset.risk=state.result.risk;cell.append(value);
          if(kind==='tamper')cell.append(node('span','refund-summary-meta',`可疑区域 ${row.regions.length} 处`));
          cell.append(node('span','refund-summary-meta',`已完成 · ${state.result.coverage==='partial'?'部分覆盖':'完整覆盖'}`));
        }else cell.append(node('strong','refund-summary-label',labels[state.status]));
        compact.append(cell);
      }
      article.append(compact);
      const more=node('details','refund-summary-details');more.dataset.summaryDetails=row.id;more.open=expandedDetails.get(row.id)||false;
      const moreToggle=node('summary','','查看说明与依据');moreToggle.dataset.summaryFocus=JSON.stringify([row.id,'details']);more.append(moreToggle);
      const columns=node('div','refund-summary-columns');
      for(const [kind,title] of [['ai','AI来源风险'],['tamper','局部篡改'],['comparison','商品与描述核对']]){
        const state=row[kind],column=node('section','refund-summary-column');column.append(node('h4','',title));
        if(state.result){
          if(kind==='comparison'){
            const counts=Object.keys(refundComparisonOutcomes).map(outcome=>`${state.result.checks.filter(check=>check.outcome===outcome).length}项${refundComparisonOutcomes[outcome]}`).join(' / ');
            column.append(node('p','refund-summary-label',counts));
            if(row.issues.length){const issues=node('ul','refund-summary-issues');for(const issue of row.issues)issues.append(node('li','',`${refundComparisonDimensions[issue.dimension]}：${refundComparisonOutcomes[issue.outcome]}；${issue.evidence}`));column.append(issues);}
          }else{
            const badge=node('span','refund-summary-label',risks[state.result.risk]);badge.dataset.risk=state.result.risk;column.append(badge,node('p','refund-summary-description',state.result.summary));
          }
          column.append(node('p','refund-result-scope',`${state.result.coverage==='partial'?'部分覆盖':'完整覆盖'}：${state.result.scope}`));
        }else{column.append(node('p','refund-summary-label',labels[state.status]));if(state.error)column.append(node('p','refund-result-error',state.error));}
        if(kind==='tamper' && state.result){
          if(row.regions.length){
            const details=node('details','refund-summary-regions');details.dataset.summaryImage=row.id;details.open=expandedRegions.get(row.id) || false;
            const disclosure=node('summary','',`可疑区域 ${row.regions.length} 处`);disclosure.dataset.summaryFocus=JSON.stringify([row.id,'disclosure']);details.append(disclosure);const regions=node('div');
            for(const [index,region] of row.regions.entries()){const button=link(`区域${index+1} · ${refundRegionTypes[region.type]}`,row,'region',region.id);button.setAttribute('aria-label',`查看${row.name}的区域${index+1}：${refundRegionTypes[region.type]}`);regions.append(button);}
            details.append(regions);column.append(details);
          }else column.append(node('p','refund-result-scope','无可定位区域，需结合风险说明。'));
        }
        columns.append(column);
      }
      more.append(columns);article.append(more);
      const comparisonLink=link('核对详情',row,'comparison');comparisonLink.setAttribute('aria-label',`查看${row.name}的核对详情`);article.append(comparisonLink);list.append(article);
    }
    if(focused){const target=Array.from(list.querySelectorAll('[data-summary-focus]')).find(el=>el.dataset.summaryFocus===focused);(target||select).focus({preventScroll:true});}
  }
  select.addEventListener('change',render);
  root.addEventListener('click',event=>{
    const button=event.target.closest('button[data-summary-image]');if(button)onOpen(button.dataset.summaryImage,button.dataset.summarySection,button.dataset.summaryRegion);
  });
  return {update(nextEntries,nextCaseNumber){entries=nextEntries;caseNumber=String(nextCaseNumber||'').trim();render();}};
}
