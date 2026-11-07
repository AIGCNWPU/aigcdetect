import { createAftersalesCaseEvidence } from './case-evidence.js';
import { aftersalesDetectionKinds } from './detection.js';
import { aftersalesNode, aftersalesButton, aftersalesStateLabels, aftersalesRowFlags, aftersalesKindLabel, renderAftersalesResults } from './results-view.js';

export function mountAftersalesSummary(host,{getEntries,getCaseNumber,onLocalOpen}){
  host.innerHTML=`<div class="av-section-heading"><div><h3>图视频凭证汇总</h3><p>结合分类风险、问题位置和核对依据，逐项复核凭证。</p></div><label>筛选 <select aria-label="汇总筛选"><option value="all">全部凭证</option><option value="attention">待核对</option><option value="incomplete">未完成</option><option value="failed">失败或取消</option></select></label></div><div class="av-case-loader"><span data-av-case-label></span><button type="button" data-av-load>加载案件凭证</button><button type="button" data-av-load-cancel hidden>取消加载</button></div><p data-av-case-notice role="status" hidden></p><div data-av-local-summary></div><div data-av-linked-summary></div><dialog class="av-preview" aria-label="凭证预览"><header><h3 data-av-preview-title></h3><button type="button" aria-label="关闭凭证预览">关闭</button></header><p data-av-preview-status role="status" hidden></p><div class="av-image-frame" hidden><img alt=""><div class="av-region" hidden></div></div><video controls playsinline preload="metadata" hidden></video></dialog>`;
  const local=host.querySelector('[data-av-local-summary]'),linked=host.querySelector('[data-av-linked-summary]'),notice=host.querySelector('[data-av-case-notice]'),dialog=host.querySelector('dialog'),image=dialog.querySelector('img'),video=dialog.querySelector('video'),regionBox=dialog.querySelector('.av-region'),previewStatus=dialog.querySelector('[data-av-preview-status]');
  let lastCaseNumber=getCaseNumber(),disposed=false,generation=0,opener=null,pendingSeek=null;
  const service=createAftersalesCaseEvidence({onChange:()=>update()});
  if(globalThis.Veritas)globalThis.Veritas.videoAftersalesCase=service;
  function clearPreview(){video.pause();video.removeAttribute('src');video.load();image.removeAttribute('src');regionBox.hidden=true;pendingSeek=null;previewStatus.hidden=true;}
  function close(){if(dialog.open)dialog.close();clearPreview();}
  dialog.querySelector('button').addEventListener('click',close);dialog.addEventListener('close',()=>{clearPreview();if(opener?.isConnected)opener.focus({preventScroll:true});});
  const seek=()=>{
    if(!pendingSeek||video.readyState<2||pendingSeek.requested)return;const {time,end,duration}=pendingSeek;
    if(!Number.isFinite(video.duration)||Math.abs(video.duration-duration)>0.05||time>=video.duration||(end!=null&&end>video.duration)){pendingSeek=null;previewStatus.textContent='原视频时长与片段信息不符，请重新加载案件。';previewStatus.hidden=false;return;}
    video.pause();if(Math.abs(video.currentTime-time)<0.01){pendingSeek=null;return;}pendingSeek.requested=true;video.currentTime=time;
  };
  video.addEventListener('loadeddata',seek);video.addEventListener('canplay',seek);
  video.addEventListener('seeked',()=>{if(!pendingSeek?.requested)return;if(Math.abs(video.currentTime-pendingSeek.time)>0.05){previewStatus.textContent='未能定位到指定片段，请重新加载视频后重试。';previewStatus.hidden=false;}pendingSeek=null;});
  for(const media of [video,image])media.addEventListener('error',()=>{if(!media.getAttribute('src'))return;previewStatus.textContent='原件读取失败，请重新加载案件或核查访问权限。';previewStatus.hidden=false;});
  function preview(material,time=0,region=null,end=null){
    opener=document.activeElement;clearPreview();dialog.querySelector('h3').textContent=`${material.name} · 版本 ${material.version}`;video.hidden=material.type!=='video';dialog.querySelector('.av-image-frame').hidden=material.type!=='image';
    if(material.type==='video'){pendingSeek={time,end,duration:material.duration,requested:false};video.preload='auto';video.src=material.url;video.load();}else{image.alt=material.name;image.src=material.url;if(region){regionBox.hidden=false;const box=region.box;Object.assign(regionBox.style,{left:`${box.x*100}%`,top:`${box.y*100}%`,width:`${box.width*100}%`,height:`${box.height*100}%`});regionBox.textContent=region.description;}}
    if(!dialog.open)dialog.showModal();dialog.querySelector('button').focus();
  }
  function renderGroup(parent,title,rows){
    const expanded=new Set(Array.from(parent.querySelectorAll('[data-summary-key]')).filter(row=>row.querySelector('details').open).map(row=>row.dataset.summaryKey));
    const active=document.activeElement,focused=parent.contains(active)?{row:active.closest('[data-summary-key]')?.dataset.summaryKey,key:active.dataset.avFocus,summary:active.tagName==='SUMMARY',preview:active.dataset.summaryAction==='preview'}:null;
    const previewEntry=opener&&parent.contains(opener)?{row:opener.closest('[data-summary-key]')?.dataset.summaryKey,key:opener.dataset.avFocus}:null;
    parent.replaceChildren();parent.append(aftersalesNode('h4','av-group-title',title));
    const filter=host.querySelector('select').value;
    const shown=rows.filter(row=>{const f=aftersalesRowFlags(row.states);return filter==='attention'?f.attention:filter==='incomplete'?!f.complete:filter==='failed'?f.failed:true;});
    if(!shown.length){parent.append(aftersalesNode('p','av-empty',rows.length?'当前筛选下没有凭证。':'暂无凭证。'));if(previewEntry)opener=host.querySelector('select');return;}
    for(const row of shown){
      const article=aftersalesNode('article','av-summary-row');article.dataset.summaryRow='';article.dataset.summaryKey=JSON.stringify([row.local?'local':'linked',row.local?row.id:row.material.materialRef,row.version]);const head=aftersalesNode('div','av-summary-heading');head.append(aftersalesNode('h5','',row.name),aftersalesNode('span','av-muted',`${row.type==='image'?'图片':'视频'} · 版本 ${row.version}`));
      const open=aftersalesButton(`${row.local?'查看检测':'预览'} ${row.name}`,()=>row.local?onLocalOpen(row.id):preview(row.material));open.dataset.summaryAction='preview';open.disabled=!row.local&&!row.material.url;head.append(open);article.append(head);
      const brief=aftersalesNode('div','av-summary-brief');for(const kind of Object.keys(aftersalesDetectionKinds)){const state=row.states[kind],risk={low:'低风险',medium:'中风险',high:'高风险',unknown:'无法判断'}[state.result?.risk];brief.append(aftersalesNode('p','',`${aftersalesKindLabel(kind,row.type)}：${aftersalesStateLabels[state.status]}${state.result?` · ${risk?risk+' · ':''}${state.result.coverage==='full'?'完整覆盖':'部分覆盖'} · ${state.result.summary}`:''}`));}article.append(brief);
      const details=aftersalesNode('details'),summary=aftersalesNode('summary','','展开分类依据与位置');details.open=expanded.has(article.dataset.summaryKey);details.append(summary);const body=aftersalesNode('div','av-results');details.append(body);renderAftersalesResults(body,row.states,{mediaType:row.type,onPosition:row.type==='video'&&(row.local||row.material.url)?(time,end)=>row.local?onLocalOpen(row.id,time,end):preview(row.material,time,null,end):null,onRegion:row.type==='image'&&row.material.url?region=>preview(row.material,0,region):null});article.append(details);parent.append(article);
    }
    if(previewEntry){const row=Array.from(parent.querySelectorAll('[data-summary-key]')).find(e=>e.dataset.summaryKey===previewEntry.row);opener=(previewEntry.key?Array.from(row?.querySelectorAll('[data-av-focus]')||[]).find(e=>e.dataset.avFocus===previewEntry.key):row?.querySelector('[data-summary-action=preview]'))||row?.querySelector('summary')||host.querySelector('select');}
    if(focused?.row){const row=Array.from(parent.querySelectorAll('[data-summary-key]')).find(e=>e.dataset.summaryKey===focused.row);const target=focused.key?Array.from(row?.querySelectorAll('[data-av-focus]')||[]).find(e=>e.dataset.avFocus===focused.key):focused.preview?row?.querySelector('[data-summary-action=preview]'):null;(target||row?.querySelector('summary')||host.querySelector('select')).focus({preventScroll:true});}
  }
  function update(){
    if(disposed)return;
    host.querySelector('[data-av-case-label]').textContent=`案件 ${getCaseNumber()||'未填写'}${service.data?' · 已加载关联凭证':''}`;
    host.querySelector('[data-av-load]').disabled=service.busy;host.querySelector('[data-av-load-cancel]').hidden=!service.busy;
    renderGroup(local,'本页视频（尚未关联已保存案件）',getEntries().map(e=>({id:e.id,name:e.file.name,version:e.version,type:'video',local:true,states:Object.fromEntries(Object.keys(aftersalesDetectionKinds).map(kind=>[kind,e[kind]]))})));
    renderGroup(linked,service.data?`已关联案件 · ${service.data.caseNumber}`:'已保存的案件凭证',service.data?.materials.map(material=>({name:material.name,version:material.version,type:material.type,states:material.results,material}))||[]);
  }
  host.querySelector('select').addEventListener('change',update);
  host.querySelector('[data-av-load]').addEventListener('click',async()=>{
    const token=++generation;close();notice.hidden=true;
    try{await service.load(getCaseNumber());if(!disposed&&generation===token){notice.textContent='已加载案件凭证。';notice.hidden=false;}}
    catch(error){if(!disposed&&generation===token){notice.textContent=error.message;notice.hidden=false;}}
  });
  host.querySelector('[data-av-load-cancel]').addEventListener('click',()=>{generation++;service.cancel();close();notice.textContent='案件加载已取消。';notice.hidden=false;});
  update();
  return {update(){if(getCaseNumber()!==lastCaseNumber){lastCaseNumber=getCaseNumber();generation++;service.cancel();notice.hidden=true;close();}update();},close,dispose(){disposed=true;generation++;service.dispose();close();}};
}
