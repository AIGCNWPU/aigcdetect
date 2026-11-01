import { createAftersalesVideoMaterials, aftersalesVideoFieldLimits, validateAftersalesVideoFields } from '../aftersales/materials.js';
import { aftersalesVideoSubmission } from '../aftersales/submission.js';
import { aftersalesVideoDetection } from '../aftersales/detection.js';
import { mountAftersalesReview } from '../aftersales/review-view.js';
import { mountCurrentAftersalesSummary } from '../aftersales/current-summary-view.js';
import { createAftersalesBackend } from '../aftersales/backend.js';
import { aftersalesVideoPresets } from '../aftersales/presets.js';
import { aftersalesTime } from '../aftersales/results-view.js';
import { mountRefundTabs } from '../../image/refund/tabs.js';

export function renderVideoAftersales(container) {
  container.classList.add('aftersales-video-workspace');
  const field=(key,label,placeholder,multiline=false)=>`<label for="aftersales-${key}">${label} ${['caseNumber','productName','description'].includes(key)?'<span aria-hidden="true">*</span>':'<small>选填</small>'}</label>
    <${multiline?'textarea':'input'} id="aftersales-${key}" name="${key}" aria-label="${label}" maxlength="${aftersalesVideoFieldLimits[key]}" ${['caseNumber','productName','description'].includes(key)?'required':''} aria-describedby="aftersales-error-${key}" placeholder="${placeholder}" ${multiline?'rows="3"></textarea>':'>'}
    <p class="aftersales-video-field-error" id="aftersales-error-${key}" hidden></p>`;
  container.innerHTML=`
    <header class="aftersales-video-heading"><div><p>售后案件 · 视频凭证</p><h2>还原问题发生的过程</h2><span>整理开箱、破损或故障展示视频，对照商品与问题描述。</span></div><div class="av-workspace-status"><output data-video-count aria-live="polite">0 / 5 个视频</output><span data-av-progress role="status"></span><button type="button" data-av-cancel hidden>取消检测</button></div></header>
    <div id="aftersales-tabs" class="av-tabs" aria-label="售后视频工作区"><button data-tab="materials">案件与凭证</button><button data-tab="review">检测与核对</button><button data-tab="summary">本次分析汇总</button></div>
    <p class="aftersales-video-status" data-video-status role="status" aria-live="polite" hidden></p>
    <form novalidate data-tab-panel="materials"><section class="av-video-presets"><strong>演示素材</strong><p>示例只填充资料与视频，检测结果由实际服务产生。添加视频后可在下方提交。</p>${aftersalesVideoPresets.map(p=>`<button type="button" data-video-preset="${p.id}">${p.label}</button>`).join('')}</section><div class="aftersales-video-columns">
      <fieldset class="aftersales-video-details"><legend><span>01</span> 案件资料</legend><p class="aftersales-video-hint">带 * 的项目为提交材料时的必填项。</p>
        ${field('caseNumber','案件编号','例如：AS-20261021-003')}${field('productName','商品名称','填写需要核查的商品名称')}${field('style','商品款式','颜色、规格或型号')}${field('productInfo','商品资料','补充外观、材质或规格说明',true)}${field('description','问题描述','描述开箱情况、破损部位或故障现象',true)}
      </fieldset>
      <section class="aftersales-video-evidence" aria-labelledby="aftersales-evidence-title">
        <h3 id="aftersales-evidence-title"><span>02</span> 视频凭证</h3>
        <div class="aftersales-video-drop" data-video-drop><div><strong>拖拽视频到这里</strong><p>MP4 / WebM · 单个 ≤ 200 MiB · 时长 ≤ 10 分钟</p></div><button type="button" data-video-choose>选择视频</button><input type="file" accept="video/mp4,video/webm,.mp4,.webm" multiple hidden aria-label="选择视频文件"></div>
        <ul class="aftersales-video-errors" data-video-errors role="alert" hidden></ul>
        <div data-av-material-player><div data-av-player-group><div class="aftersales-video-player-area"><div class="aftersales-video-empty" data-video-empty><span aria-hidden="true">▷</span><strong>还没有视频凭证</strong><p>添加视频后，在这里播放并核查问题现象。</p></div><video controls playsinline preload="metadata" aria-label="当前视频凭证" hidden></video></div>
        <div class="aftersales-video-current" data-video-current hidden><strong data-video-title></strong><span data-video-meta></span></div>
        <p data-av-position class="av-position-note" role="status" hidden></p><p class="aftersales-video-status" data-av-player-error data-kind="error" role="alert" hidden></p></div></div>
        <ul class="aftersales-video-list" aria-label="视频凭证列表"></ul>
      </section>
    </div><footer class="aftersales-video-actions"><div><strong>检查资料后提交</strong><p>确认视频包含完整的问题过程，并核对案件资料。</p></div><button type="submit" class="aftersales-video-primary">提交材料</button></footer></form><section data-tab-panel="review" hidden></section><section data-tab-panel="summary" hidden></section>`;
  const materials=createAftersalesVideoMaterials(),form=container.querySelector('form'),chooser=container.querySelector('input[type=file]'),drop=container.querySelector('[data-video-drop]'),list=container.querySelector('.aftersales-video-list'),player=container.querySelector('video'),status=container.querySelector('[data-video-status]');
  let currentId=null,loading=false,submitting=false,disposed=false,requestController=null,review=null,summary=null,tabs=null,session=null,pendingPosition=null;
  if(globalThis.Veritas)globalThis.Veritas.videoAftersales=aftersalesVideoSubmission;
  const readFields=()=>Object.fromEntries(Object.keys(aftersalesVideoFieldLimits).map(key=>[key,form.elements.namedItem(key).value]));
  const playerGroup=container.querySelector('[data-av-player-group]'),materialPlayer=container.querySelector('[data-av-material-player]'),positionNote=container.querySelector('[data-av-position]'),playerError=container.querySelector('[data-av-player-error]');
  session=aftersalesVideoDetection.createSession({onChange(){if(disposed)return;controls();summary?.update();}});
  if(globalThis.Veritas)globalThis.Veritas.videoAftersalesDetection=aftersalesVideoDetection;
  review=mountAftersalesReview(container.querySelector('[data-tab-panel=review]'),{session,isBlocked:()=>loading||submitting,onVideo:select,onProgress(progress){container.querySelector('[data-av-progress]').textContent=progress.text;const cancel=container.querySelector('[data-av-cancel]'),restoreFocus=!progress.busy&&document.activeElement===cancel;cancel.hidden=!progress.busy;if(restoreFocus)container.querySelector('#aftersales-tabs [aria-selected=true]')?.focus({preventScroll:true});}});
  summary=mountCurrentAftersalesSummary(container.querySelector('[data-tab-panel=summary]'),{getEntries:()=>session.entries,onLocalOpen(id,time,end){tabs.select('review');review.select(id,time,end);player.focus({preventScroll:true});}});
  tabs=mountRefundTabs(container.querySelector('.av-tabs'),Array.from(container.querySelectorAll(':scope > [data-tab-panel]')),{onSelect(value){player.pause();summary.close();if(value==='review'){review.playerHost.append(playerGroup);review.select(currentId);}else if(value==='materials')materialPlayer.append(playerGroup);}});
  container.querySelector('[data-av-cancel]').addEventListener('click',()=>session.cancel());
  session.sync(materials.items,readFields());
  const backend=createAftersalesBackend({getVideos:()=>session.entries});
  aftersalesVideoSubmission.configure(backend.submit);
  aftersalesVideoDetection.configure(backend.handlers);
  const onPageHide=()=>backend.reset();window.addEventListener('pagehide',onPageHide);
  const durationLabel=seconds=>`${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;
  const meta=item=>`${durationLabel(item.duration)} · ${item.width} × ${item.height} · ${(item.file.size/1024/1024).toFixed(2)} MiB`;
  function message(text,kind='info'){status.textContent=text;status.dataset.kind=kind;status.hidden=false;}
  function controls(){
    const busy=submitting||Boolean(session?.busy);
    container.querySelector('fieldset').disabled=busy;
    container.querySelector('[data-video-choose]').disabled=loading||busy;chooser.disabled=loading||busy;
    for(const button of container.querySelectorAll('[data-video-preset]'))button.disabled=loading||busy||materials.items.length>0;
    for(const button of list.querySelectorAll('[data-remove]'))button.disabled=loading||busy;
    const submit=form.querySelector('[type=submit]');submit.disabled=loading||busy;submit.textContent=submitting?'正在提交…':'提交材料';drop.setAttribute('aria-busy',String(loading));review?.update();
  }
  function unload(){pendingPosition=null;player.pause();player.removeAttribute('src');player.load();positionNote.hidden=true;playerError.hidden=true;playerError.textContent='';}
  function applyPosition(){if(pendingPosition===null||player.readyState<1)return;const {time,end}=pendingPosition;pendingPosition=null;player.pause();if(time>=player.duration||(end!=null&&end>player.duration)){positionNote.textContent='片段信息与视频时长不符，请重新检测。';positionNote.hidden=false;return;}player.currentTime=time;positionNote.textContent=`已定位 ${aftersalesTime(time)}${end!=null?`—${aftersalesTime(end)}`:''}，可播放原视频复核。`;positionNote.hidden=false;}
  player.addEventListener('loadedmetadata',applyPosition);
  function select(id,time,end){
    const changed=currentId!==id;if(changed)unload();currentId=id;const item=materials.items.find(value=>value.id===id);
    player.hidden=!item;container.querySelector('[data-video-empty]').hidden=Boolean(item);container.querySelector('[data-video-current]').hidden=!item;
    if(item){if(changed){player.src=item.url;player.load();}container.querySelector('[data-video-title]').textContent=item.file.name;container.querySelector('[data-video-meta]').textContent=meta(item);if(Number.isFinite(time)&&time>=0&&time<item.duration){pendingPosition={time,end};applyPosition();}}
    for(const button of list.querySelectorAll('[data-select]'))button.setAttribute('aria-pressed',String(button.dataset.select===id));
  }
  function renderList(){
    backend.reset();
    list.replaceChildren();
    for(const item of materials.items){
      const li=document.createElement('li');li.className='aftersales-video-item';
      const button=document.createElement('button');button.type='button';button.dataset.select=item.id;button.setAttribute('aria-label',`查看 ${item.file.name}`);button.setAttribute('aria-pressed',String(currentId===item.id));
      const title=document.createElement('strong');title.textContent=item.file.name;
      const detail=document.createElement('span');detail.textContent=meta(item);button.append(title,detail);
      const remove=document.createElement('button');remove.type='button';remove.dataset.remove=item.id;remove.textContent='移除';remove.setAttribute('aria-label',`移除 ${item.file.name}`);
      li.append(button,remove);list.append(li);
    }
    container.querySelector('[data-video-count]').textContent=`${materials.items.length} / 5 个视频`;session.sync(materials.items,readFields());controls();
  }
  async function addFiles(files){
    if(disposed||submitting||session.busy||!files.length)return;
    if(loading){message('视频正在读取，请稍候再添加。');return;}
    loading=true;controls();message('正在读取视频…');
    try{
      const result=await materials.add(files);if(disposed)return;
      renderList();if(!currentId&&materials.items.length)select(materials.items[0].id);
      const errors=container.querySelector('[data-video-errors]');errors.replaceChildren();
      for(const error of result.errors){const li=document.createElement('li');li.textContent=`${error.name}：${error.message}`;errors.append(li);}
      errors.hidden=!result.errors.length;
      message(`已添加 ${result.added} 个视频${result.errors.length?`，${result.errors.length} 个文件未能添加，请查看原因。`:'。'}`,result.errors.length?'warning':'info');
    }finally{loading=false;if(!disposed)controls();}
  }
  container.querySelector('[data-video-choose]').addEventListener('click',()=>chooser.click());
  for(const button of container.querySelectorAll('[data-video-preset]'))button.addEventListener('click',async()=>{
    if(loading||submitting||session.busy||materials.items.length)return;
    const preset=aftersalesVideoPresets.find(p=>p.id===button.dataset.videoPreset);loading=true;requestController=new AbortController();controls();
    try{
      const response=await fetch(preset.file.url,{signal:requestController.signal});if(!response.ok)throw new Error('示例视频读取失败。');
      const bytes=await response.arrayBuffer(),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
      if(hash!==preset.file.sha256)throw new Error('示例视频校验失败。');if(disposed)return;
      const added=await materials.add([new File([bytes],preset.file.name,{type:'video/mp4'})]);if(disposed)return;if(!added.added)throw new Error(added.errors[0]?.message||'示例视频无法读取。');
      for(const [key,value] of Object.entries(preset.fields))form.elements.namedItem(key).value=value;
      renderList();select(materials.items[0].id);message(`已载入示例。${preset.group}。请提交材料后开始检测。`);
    }catch(error){if(!disposed)message(error.message||'示例载入失败。','error');}
    finally{loading=false;requestController=null;if(!disposed)controls();}
  });
  chooser.addEventListener('change',()=>{const files=Array.from(chooser.files);chooser.value='';void addFiles(files);});
  for(const type of ['dragenter','dragover','dragleave','drop'])drop.addEventListener(type,event=>{
    event.preventDefault();drop.classList.toggle('is-dragging',['dragenter','dragover'].includes(type)&&!loading&&!submitting&&!session.busy);
    if(type==='drop')void addFiles(Array.from(event.dataTransfer?.files||[]));
  });
  list.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button||disposed)return;
    if(button.dataset.select)select(button.dataset.select);
    else if(button.dataset.remove&&!loading&&!submitting&&!session.busy){
      const id=button.dataset.remove;if(currentId===id)select(null);
      materials.remove(id);renderList();if(!currentId&&materials.items.length)select(materials.items[0].id);
      message('已移除视频，其余资料保持不变。');container.querySelector('[data-video-choose]').focus();
    }
  });
  player.addEventListener('error',()=>{if(!disposed&&player.getAttribute('src')){playerError.textContent='视频播放失败，请检查文件或选择浏览器支持的视频。';playerError.hidden=false;}});
  form.addEventListener('input',event=>{
    const key=event.target.name;if(!(key in aftersalesVideoFieldLimits))return;
    event.target.removeAttribute('aria-invalid');container.querySelector(`#aftersales-error-${key}`).hidden=true;status.hidden=true;
    positionNote.hidden=true;backend.reset();session.sync(materials.items,readFields());
  });
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(loading||submitting||session.busy||disposed)return;
    const fields=readFields(),errors=validateAftersalesVideoFields(fields);
    for(const key of Object.keys(aftersalesVideoFieldLimits)){
      const element=container.querySelector(`#aftersales-error-${key}`);element.textContent=errors[key]||'';element.hidden=!errors[key];form.elements.namedItem(key).setAttribute('aria-invalid',String(Boolean(errors[key])));
    }
    if(Object.keys(errors).length){form.elements.namedItem(Object.keys(errors)[0]).focus();return;}
    if(!materials.items.length){message('请至少添加一个视频凭证。','error');return;}
    submitting=true;requestController=new AbortController();controls();message('正在提交材料，可以离开页面；未完成的提交会取消。');
    try{await aftersalesVideoSubmission.submit(fields,materials.items,{signal:requestController.signal});if(!disposed){message('材料已准备完成，请选择检测项目并开始分析。','success');tabs.select('review');}}
    catch(error){if(!disposed)message(error.message||'提交失败，请重试。','error');}
    finally{submitting=false;requestController=null;if(!disposed)controls();}
  });
  const observer=new MutationObserver(()=>{if(!container.isConnected)dispose();});observer.observe(document.body,{childList:true,subtree:true});
  function dispose(){if(disposed)return;disposed=true;requestController?.abort();session.dispose();backend.dispose();window.removeEventListener('pagehide',onPageHide);summary.dispose();unload();materials.dispose();observer.disconnect();}
  return dispose;
}
