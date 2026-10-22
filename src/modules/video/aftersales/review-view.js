import { aftersalesDetectionKinds } from './detection.js';
import { aftersalesNode, aftersalesButton, aftersalesStateLabels, renderAftersalesResults } from './results-view.js';
import { mountRefundTabs } from '../../image/refund/tabs.js';

export function mountAftersalesReview(host,{session,isBlocked,onVideo,onProgress}){
  host.innerHTML=`<div class="av-section-heading"><div><h3>检测与核对</h3><p>分别核查视频来源、修改线索和商品问题。</p></div></div><div class="av-review-toolbar"><fieldset><legend class="av-sr-only">选择检测类型</legend>${Object.entries(aftersalesDetectionKinds).map(([kind,label])=>`<label><input type="checkbox" value="${kind}" checked> ${label}</label>`).join('')}</fieldset><button type="button" data-av-start>开始检测</button></div><p data-av-review-notice role="status" hidden></p><p data-av-review-empty class="av-empty">先在“案件与凭证”添加视频，再开始检测。</p><div class="av-review-layout" hidden><nav aria-label="视频检测列表"></nav><div class="av-review-detail"><div class="av-review-media"><h3 data-av-review-title></h3><div data-av-player-host></div></div><div class="av-review-inspection"><div id="aftersales-result-tabs" class="av-tabs" aria-label="视频结果分类"><button data-tab="risk">来源与修改</button><button data-tab="comparison">商品核对</button></div><div class="av-results" data-result-panel data-tab-panel="risk"></div><div class="av-results" data-result-panel data-tab-panel="comparison" hidden></div></div></div></div>`;
  let selected=null;
  const list=host.querySelector('nav'),notice=host.querySelector('[data-av-review-notice]'),title=host.querySelector('[data-av-review-title]');
  title.tabIndex=-1;
  mountRefundTabs(host.querySelector('.av-tabs'),Array.from(host.querySelectorAll('[data-result-panel]')));
  function message(text){notice.textContent=text;notice.hidden=false;}
  async function run(kinds,ids){try{notice.hidden=true;await session.run(kinds,ids);}catch(error){message(error.message);}}
  host.querySelector('[data-av-start]').addEventListener('click',()=>run(Array.from(host.querySelectorAll('input:checked')).map(input=>input.value)));
  const view={
    playerHost:host.querySelector('[data-av-player-host]'),
    select(id,time,end){selected=id;onVideo(id,time,end);view.update();},
    update(){
      const entries=session.entries;if(!entries.some(e=>e.id===selected))selected=entries[0]?.id||null;
      host.querySelector('[data-av-review-empty]').hidden=entries.length>0;host.querySelector('.av-review-layout').hidden=!entries.length;
      host.querySelector('fieldset').disabled=session.busy||isBlocked();host.querySelector('[data-av-start]').disabled=session.busy||isBlocked();
      const states=entries.flatMap(e=>Object.keys(aftersalesDetectionKinds).map(kind=>e[kind])).filter(s=>s.status!=='idle'),finished=states.filter(s=>!['queued','running'].includes(s.status)).length;
      onProgress({busy:session.busy,text:states.length?`已结束 ${finished} / ${states.length} 项`:'尚未开始检测'});
      const focused=host.contains(document.activeElement)?{label:document.activeElement.getAttribute('aria-label'),key:document.activeElement.dataset.avFocus}:null;
      list.replaceChildren();for(const entry of entries){const button=aftersalesButton('',()=>view.select(entry.id));button.setAttribute('aria-label',`查看检测 ${entry.file.name}`);button.setAttribute('aria-pressed',String(entry.id===selected));button.append(aftersalesNode('strong','',entry.file.name));for(const [kind,label] of Object.entries(aftersalesDetectionKinds))button.append(aftersalesNode('span','av-muted',`${label} · ${aftersalesStateLabels[entry[kind].status]}`));list.append(button);}
      const entry=entries.find(e=>e.id===selected);title.textContent=entry?.file.name||'';
      for(const [panel,kinds] of [['risk',['ai','tamper']],['comparison',['comparison']]])renderAftersalesResults(host.querySelector(`[data-tab-panel=${panel}]`),entry||{},{kinds,onPosition:entry?(time,end)=>view.select(entry.id,time,end):null,onRetry:entry?kind=>run([kind],[entry.id]):null,blocked:session.busy||isBlocked()});
      if(focused?.key||focused?.label){const target=Array.from(host.querySelectorAll('[data-av-focus],[aria-label]')).find(e=>focused.key?e.dataset.avFocus===focused.key:e.getAttribute('aria-label')===focused.label);(target||title).focus({preventScroll:true});}
    },
  };view.update();return view;
}
