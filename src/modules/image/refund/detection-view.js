import { refundDetection, refundDetectionKinds, refundRegionTypes } from './detection.js';

export function mountRefundDetection(host,{getFields,getImages,onBusyChange,isBlocked}) {
  host.innerHTML=`<section class="refund-detection" aria-labelledby="refund-detection-title">
    <div class="refund-detection-heading"><div><h2 id="refund-detection-title">凭证检测</h2><p>分别核查整图来源与局部修改线索。</p></div><span data-detection-progress role="status" aria-live="polite"></span></div>
    <div class="refund-detection-toolbar"><fieldset><legend class="refund-visually-hidden">选择检测类型</legend><label><input type="checkbox" value="ai" checked> AI生成凭证检测</label><label><input type="checkbox" value="tamper" checked> 局部篡改检测</label></fieldset><div><button type="button" class="refund-button refund-button-primary" data-detection-start>开始检测</button><button type="button" class="refund-button refund-button-secondary" data-detection-cancel hidden>取消检测</button></div></div>
    <p class="refund-status" data-detection-notice role="status" aria-live="polite" hidden></p>
    <p class="refund-detection-empty" data-detection-empty>添加图片后，可逐张查看检测情况。</p>
    <div class="refund-detection-layout" hidden><nav class="refund-detection-files" aria-label="凭证检测列表"></nav><div class="refund-detection-detail"></div></div>
  </section>`;
  const root=host.querySelector('section'), list=root.querySelector('nav'), detail=root.querySelector('.refund-detection-detail');
  const notice=root.querySelector('[data-detection-notice]');
  let selectedId=null,selectedRegion=null,showRegions=true,disposed=false;
  const statuses={idle:'未检测',queued:'排队中',running:'检测中',succeeded:'已完成',failed:'失败',cancelled:'已取消'};
  const risks={low:'低风险',medium:'中风险',high:'高风险',unknown:'无法判断'};
  const node=(tag,className,text)=>{const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;};
  const button=(text,className)=>{const el=node('button',className,text);el.type='button';return el;};
  const session=refundDetection.createSession({onChange:()=>{render();onBusyChange();}});
  if(globalThis.Veritas)globalThis.Veritas.refundDetection=refundDetection;
  function render() {
    if(disposed)return;
    const focused=root.contains(document.activeElement) ? document.activeElement.dataset.focus : null;
    const entries=session.entries;
    if(!entries.some(entry=>entry.id===selectedId)){selectedId=entries[0]?.id;selectedRegion=null;}
    root.querySelector('[data-detection-empty]').hidden=entries.length>0;
    root.querySelector('.refund-detection-layout').hidden=!entries.length;
    const attempted=entries.flatMap(entry=>[entry.ai,entry.tamper]).filter(item=>item.status!=='idle');
    const ended=attempted.filter(item=>!['running','queued'].includes(item.status)).length;
    root.querySelector('[data-detection-progress]').textContent=attempted.length ? `已结束 ${ended} / ${attempted.length} 项` : '';
    refreshControls();list.replaceChildren();detail.replaceChildren();
    for(const entry of entries) {
      const choice=button('', 'refund-detection-file');choice.dataset.selectImage=entry.id;choice.dataset.focus=`image-${entry.id}`;
      choice.setAttribute('aria-label',`查看检测 ${entry.file.name}`);choice.setAttribute('aria-pressed',String(selectedId===entry.id));
      const thumb=node('img');thumb.src=entry.url;thumb.alt='';
      const info=node('span','refund-detection-file-info');const name=node('strong','',entry.file.name);name.title=entry.file.name;info.append(name);
      for(const kind of ['ai','tamper']){const state=node('span','refund-detection-state',`${kind==='ai'?'AI来源':'局部篡改'} · ${statuses[entry[kind].status]}`);state.dataset.state=entry[kind].status;info.append(state);}
      choice.append(thumb,info);list.append(choice);
    }
    const selected=entries.find(entry=>entry.id===selectedId);
    if(selected)renderDetail(selected);
    if(focused)Array.from(root.querySelectorAll('[data-focus]')).find(el=>el.dataset.focus===focused)?.focus({preventScroll:true});
  }
  function refreshControls() {
    const blocked=isBlocked();
    root.querySelector('[data-detection-start]').disabled=session.busy || blocked;
    root.querySelector('[data-detection-cancel]').hidden=!session.busy;
    root.querySelector('fieldset').disabled=session.busy || blocked;
    for(const retry of root.querySelectorAll('[data-retry]'))retry.disabled=session.busy || blocked;
  }
  function renderDetail(entry) {
    const heading=node('div','refund-inspect-heading');heading.append(node('h3','',entry.file.name));
    const regions=entry.tamper.result?.regions || [];
    if(!regions.some(region=>region.id===selectedRegion))selectedRegion=regions[0]?.id || null;
    if(regions.length){const label=node('label');const toggle=node('input');toggle.type='checkbox';toggle.checked=showRegions;toggle.dataset.regionToggle='';toggle.dataset.focus='toggle';label.append(toggle,document.createTextNode(' 显示区域标注'));heading.append(label);}
    detail.append(heading);
    const canvas=node('div','refund-inspect-canvas'),frame=node('div','refund-inspect-frame');
    frame.style.width=`min(100%, ${420*entry.width/entry.height}px)`;
    const image=node('img');image.src=entry.url;image.alt=`核查原图 ${entry.file.name}`;frame.append(image);
    for(const [index,region] of regions.entries()){
      const overlay=button('','refund-region-box');overlay.append(node('span','',String(index+1)));overlay.dataset.regionBox=region.id;overlay.dataset.focus=`box-${region.id}`;
      overlay.hidden=!showRegions;overlay.setAttribute('aria-label',`区域${index+1}：${refundRegionTypes[region.type]}`);overlay.setAttribute('aria-pressed',String(selectedRegion===region.id));
      Object.assign(overlay.style,{left:`${region.box.x*100}%`,top:`${region.box.y*100}%`,width:`${region.box.width*100}%`,height:`${region.box.height*100}%`});frame.append(overlay);
    }
    canvas.append(frame);detail.append(canvas);
    const results=node('div','refund-detection-results');
    for(const kind of ['ai','tamper']) {
      const state=entry[kind];const panel=node('section','refund-result-panel');panel.setAttribute('aria-label',refundDetectionKinds[kind]);
      panel.append(node('h4','',kind==='ai'?'整图 AI 生成风险':'局部篡改风险'));
      if(state.result){
        const badge=node('span','refund-risk',risks[state.result.risk]);badge.dataset.risk=state.result.risk;panel.append(badge,node('p','refund-result-summary',state.result.summary));
        panel.append(node('p','refund-result-scope',`${state.result.coverage==='partial'?'部分覆盖':'完整覆盖'}：${state.result.scope}`));
        if(kind==='tamper'&&!regions.length)panel.append(node('p','refund-result-scope','未返回可定位区域，请结合风险说明核查。'));
      } else {
        panel.append(node('p','refund-result-pending',statuses[state.status]));
        if(state.error)panel.append(node('p','refund-result-error',state.error));
      }
      if(['failed','cancelled'].includes(state.status)){
        const retry=button(`重试${refundDetectionKinds[kind]}`,'refund-button refund-button-secondary');retry.dataset.retry=kind;retry.dataset.focus=`retry-${kind}`;retry.disabled=session.busy||isBlocked();panel.append(retry);
      }
      results.append(panel);
    }
    detail.append(results);
    if(regions.length){
      const regionSection=node('section','refund-regions');regionSection.append(node('h4','',`可疑区域（${regions.length}）`));
      const choices=node('div','refund-region-choices');
      for(const [index,region] of regions.entries()){
        const choice=button(`${index+1} · ${refundRegionTypes[region.type]}`,'refund-region-choice');choice.dataset.regionChoice=region.id;choice.dataset.focus=`region-${region.id}`;choice.setAttribute('aria-pressed',String(region.id===selectedRegion));choices.append(choice);
      }
      const active=regions.find(region=>region.id===selectedRegion);const description=node('p','refund-region-detail',`${refundRegionTypes[active.type]}：${active.description}`);description.dataset.regionDetail='';description.setAttribute('role','status');
      regionSection.append(choices,description);detail.append(regionSection);
    }
  }
  async function run(kinds,ids) {
    if(isBlocked()||session.busy)return;
    notice.hidden=true;session.sync(getImages(),getFields());
    try {await session.run(kinds,ids);} catch(error){if(!disposed){notice.textContent=error.message;notice.dataset.kind='warning';notice.hidden=false;}}
  }
  root.querySelector('[data-detection-start]').addEventListener('click',()=>void run(Array.from(root.querySelectorAll('input[value]:checked'),input=>input.value)));
  root.querySelector('[data-detection-cancel]').addEventListener('click',()=>session.cancel());
  root.addEventListener('click',event=>{
    const target=event.target.closest('button');if(!target)return;
    if(target.dataset.selectImage){selectedId=target.dataset.selectImage;selectedRegion=null;render();}
    if(target.dataset.regionBox || target.dataset.regionChoice){selectedRegion=target.dataset.regionBox || target.dataset.regionChoice;render();}
    if(target.dataset.retry)void run([target.dataset.retry],[selectedId]);
  });
  root.addEventListener('change',event=>{if(event.target.hasAttribute('data-region-toggle')){showRegions=event.target.checked;render();}});
  render();
  return {get busy(){return session.busy;},sync(){session.sync(getImages(),getFields());},refreshControls,dispose(){disposed=true;session.dispose();}};
}
