import { aftersalesDetectionKinds, aftersalesProductKinds } from './detection.js';
import { aftersalesNode, aftersalesButton, aftersalesStateText, renderAftersalesResults } from './results-view.js';
import { mountRefundTabs } from '../../image/refund/tabs.js';
import { aftersalesIncomplete } from './source-analysis.js';
import { renderContentCredentials } from '../../../lib/content-credentials-view.js';
import { renderCreditButtonHtml } from '../../../lib/credit-badge.js';

export function mountAftersalesReview(host,{session,getContentCredentials=()=>null,validateCase=()=>true,isBlocked,onVideo,onProgress}){
  host.innerHTML=`
    <div class="av-section-heading"><div><h3>检测与核对</h3><p>核查商品视频的 AI 来源信号，并对照商品资料与问题描述。</p></div></div>
    <div class="av-review-toolbar">
      <fieldset><legend class="av-sr-only">选择检测类型</legend>${aftersalesProductKinds.map(kind=>`<label><input type="checkbox" value="${kind}" checked> ${aftersalesDetectionKinds[kind]}<span data-kind-unavailable hidden>（未接入）</span></label>`).join('')}</fieldset>
      <button type="button" data-av-start>${renderCreditButtonHtml('开始检测')}</button>
    </div>
    <p class="aftersales-start-hint" data-av-review-hint role="status" hidden></p>
    <p data-av-review-notice role="status" hidden></p>
    <p data-av-review-empty class="av-empty">先在“案件与凭证”添加视频，再开始检测。</p>
    <div class="av-review-layout" hidden>
      <div class="av-review-detail aftersales-review-workspace">
        <nav aria-label="视频检测列表"></nav>
        <div class="av-review-media"><h3 data-av-review-title></h3><div data-av-player-host></div></div>
        <div class="av-review-inspection aftersales-review-results">
          <div id="aftersales-result-tabs" class="av-tabs" aria-label="视频结果分类"><button data-tab="risk">来源分析</button><button data-tab="comparison">商品核对</button></div>
          <div class="av-results" data-result-panel data-tab-panel="risk"></div>
          <div class="av-results" data-result-panel data-tab-panel="comparison" hidden></div>
        </div>
      </div>
    </div>`;
  let selected=null;
  const list=host.querySelector('nav'),notice=host.querySelector('[data-av-review-notice]'),title=host.querySelector('[data-av-review-title]');
  const fieldset=host.querySelector('fieldset'),start=host.querySelector('[data-av-start]'),hint=host.querySelector('[data-av-review-hint]');
  const kindInputs=Array.from(fieldset.querySelectorAll('input[value]'));
  const selectedKinds=()=>kindInputs.filter(input=>input.checked).map(input=>input.value);
  title.tabIndex=-1;
  const resultTabs=mountRefundTabs(host.querySelector('.av-tabs'),Array.from(host.querySelectorAll('[data-result-panel]')));
  function message(text){notice.textContent=text;notice.hidden=false;}
  function refreshControls(hasVideos){
    const blocked=session.busy||isBlocked(),hasSelection=selectedKinds().length>0;
    fieldset.disabled=blocked;
    start.disabled=blocked||!hasVideos||!hasSelection;
    hint.hidden=blocked||!hasVideos||hasSelection;
    if(!hint.hidden)hint.textContent=kindInputs.every(input=>input.disabled)?'当前没有可用的检测项目。':'请选择要运行的检测项目。';
  }
  async function run(kinds,ids){
    if(session.busy||isBlocked()||!kinds.length||!session.entries.length||!validateCase())return;
    if(kinds.every(kind=>kind==='comparison'))resultTabs.select('comparison');
    else if(!kinds.includes('comparison'))resultTabs.select('risk');
    try{notice.hidden=true;await session.run(kinds,ids);}catch(error){message(error.message);}
  }
  start.addEventListener('click',()=>void run(selectedKinds()));
  fieldset.addEventListener('change',()=>{notice.hidden=true;refreshControls(session.entries.length>0);});
  const view={
    playerHost:host.querySelector('[data-av-player-host]'),
    setCapabilities(capabilities){
      for(const input of kindInputs){
        input.disabled=capabilities?.[input.value]===false;
        if(input.disabled)input.checked=false;
        input.closest('label').querySelector('[data-kind-unavailable]').hidden=!input.disabled;
      }
      view.update();
    },
    select(id,time,end){selected=id;onVideo(id,time,end);view.update();},
    update(){
      const entries=session.entries;if(!entries.some(e=>e.id===selected))selected=entries[0]?.id||null;
      host.querySelector('[data-av-review-empty]').hidden=entries.length>0;host.querySelector('.av-review-layout').hidden=!entries.length;
      refreshControls(entries.length>0);
      const states=entries.flatMap(e=>aftersalesProductKinds.map(kind=>e[kind])).filter(s=>s.status!=='idle'),finished=states.filter(s=>!['queued','running'].includes(s.status)).length;
      const partial=states.filter(s=>s.status==='succeeded'&&aftersalesIncomplete(s)).length;
      onProgress({busy:session.busy,text:states.length?`已结束 ${finished} / ${states.length} 项${partial?` · ${partial} 项部分完成`:''}`:'尚未开始检测'});
      const focused=host.contains(document.activeElement)?{label:document.activeElement.getAttribute('aria-label'),key:document.activeElement.dataset.avFocus}:null;
      list.replaceChildren();for(const entry of entries){const button=aftersalesButton('',()=>view.select(entry.id));button.setAttribute('aria-label',`查看检测 ${entry.file.name}`);button.setAttribute('aria-pressed',String(entry.id===selected));button.append(aftersalesNode('strong','',entry.file.name));for(const kind of aftersalesProductKinds)button.append(aftersalesNode('span','av-muted',`${aftersalesDetectionKinds[kind]} · ${aftersalesStateText(entry[kind])}`));list.append(button);}
      const entry=entries.find(e=>e.id===selected);title.textContent=entry?.file.name||'';
      for(const [panel,kinds] of [['risk',['ai']],['comparison',['comparison']]])renderAftersalesResults(host.querySelector(`[data-tab-panel=${panel}]`),entry||{},{kinds,onPosition:entry?(time,end)=>view.select(entry.id,time,end):null,onRetry:entry?kind=>run([kind],[entry.id]):null,blocked:session.busy||isBlocked()});
      const credentialView=entry&&renderContentCredentials(getContentCredentials(entry.file));
      if(credentialView)host.querySelector('[data-result-panel][data-tab-panel=risk]').prepend(credentialView);
      if(focused?.key||focused?.label){const target=Array.from(host.querySelectorAll('[data-av-focus],[aria-label]')).find(e=>focused.key?e.dataset.avFocus===focused.key:e.getAttribute('aria-label')===focused.label);(target||title).focus({preventScroll:true});}
    },
  };view.update();return view;
}
