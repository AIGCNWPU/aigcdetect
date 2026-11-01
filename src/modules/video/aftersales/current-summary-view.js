import { aftersalesDetectionKinds, aftersalesProductKinds } from './detection.js';
import { aftersalesNode, aftersalesButton, renderAftersalesResults, aftersalesStateLabels } from './results-view.js';

export function mountCurrentAftersalesSummary(host,{getEntries,onLocalOpen}){
  host.innerHTML='<div class="av-section-heading"><div><h3>本次视频分析汇总</h3><p>仅展示当前上传的视频。离开页面后不保留历史分析记录。</p></div><label>筛选 <select aria-label="汇总筛选"><option value="all">全部视频</option><option value="attention">需要复核</option><option value="incomplete">未完成</option><option value="failed">失败或取消</option></select></label></div><div data-current-summary></div>';
  const list=host.querySelector('[data-current-summary]');let disposed=false;
  function update(){
    if(disposed)return;const expanded=new Set([...list.querySelectorAll('details[open]')].map(e=>e.dataset.video));list.replaceChildren();
    const filter=host.querySelector('select').value,entries=getEntries().filter(entry=>{
      const states=aftersalesProductKinds.map(k=>entry[k]);
      if(filter==='incomplete')return states.some(s=>s.status!=='succeeded');
      if(filter==='failed')return states.some(s=>['failed','cancelled'].includes(s.status));
      if(filter==='attention')return states.some(s=>s.result&&s.result.applicability!=='not_applicable'&&(['high','medium'].includes(s.result.risk)||s.result.checks?.some(c=>c.outcome!=='match')));
      return true;
    });
    if(!entries.length)list.append(aftersalesNode('p','av-empty','当前筛选下没有视频。'));
    for(const entry of entries){
      const article=aftersalesNode('article','av-summary-row'),heading=aftersalesNode('div','av-summary-heading');
      heading.append(aftersalesNode('h4','',entry.file.name),aftersalesButton('查看视频',()=>onLocalOpen(entry.id)));article.append(heading);
      for(const kind of aftersalesProductKinds){
        const label=aftersalesDetectionKinds[kind];
        const state=entry[kind],result=state.result;article.append(aftersalesNode('p','',`${label}：${result?.applicability==='not_applicable'?'不适用':aftersalesStateLabels[state.status]}${result?' · '+result.summary:state.error?' · '+state.error:''}`));
      }
      const details=aftersalesNode('details');details.dataset.video=entry.id;details.open=expanded.has(entry.id);details.append(aftersalesNode('summary','','展开依据与采样位置'));const body=aftersalesNode('div','av-results');details.append(body);renderAftersalesResults(body,entry,{kinds:aftersalesProductKinds,onPosition:(time,end)=>onLocalOpen(entry.id,time,end)});article.append(details);list.append(article);
    }
  }
  host.querySelector('select').addEventListener('change',update);update();return {update,close(){},dispose(){disposed=true;}};
}
