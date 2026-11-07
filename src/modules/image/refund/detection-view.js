import { refundDetection, refundDetectionKinds, refundRegionTypes } from './detection.js';
import { renderRefundComparison } from './comparison-view.js';
import { mountRefundCaseSummary } from './case-summary-view.js';
import { mountRefundTabs } from './tabs.js';
import { refundMaskSvg } from './localization.js';
import { presentRefundResult } from './presentation.js';

export function mountRefundDetection(host,{getFields,getImages,onBusyChange,isBlocked,summaryHost,onOpen=()=>{},onProgress=()=>{}}) {
  host.innerHTML=`<section class="refund-detection" aria-labelledby="refund-detection-title">
    <div class="refund-detection-heading"><div><h2 id="refund-detection-title" tabindex="-1">凭证检测</h2><p>查看图片来源信号，核对商品与问题描述。</p></div><span data-detection-progress role="status" aria-live="polite"></span></div>
    <div class="refund-detection-toolbar"><fieldset><legend class="refund-visually-hidden">选择检测类型</legend><label><input type="checkbox" value="ai" checked> AI生成凭证检测</label><label title="暂不开放局部篡改检测"><input type="checkbox" value="tamper" disabled> 局部篡改检测<span data-tamper-auto hidden>（自动联动）</span><span data-tamper-unavailable>（不可用）</span></label><label><input type="checkbox" value="comparison"> 商品与描述核对</label></fieldset><div><button type="button" class="refund-button refund-button-primary" data-detection-start>开始检测</button></div></div>
    <p class="refund-status" data-detection-notice role="status" aria-live="polite" hidden></p>
    <p class="refund-detection-empty" data-detection-empty>添加图片后，可逐张查看检测情况。</p>
    <div class="refund-detection-layout" hidden><nav class="refund-detection-files" aria-label="凭证检测列表"></nav><div class="refund-detection-detail"></div></div>
  </section>`;
  const root=host.querySelector('section'), list=root.querySelector('nav'), detail=root.querySelector('.refund-detection-detail');
  const notice=root.querySelector('[data-detection-notice]');
  let selectedId=null,selectedRegion=null,showRegions=true,maskOpacity=.5,disposed=false,resultMode='risk',capabilities={tamper:false},preferredKinds=null;
  const statuses={idle:'未检测',queued:'排队中',running:'检测中',succeeded:'已完成',failed:'失败',cancelled:'已取消'};
  const risks={low:'低风险',medium:'中风险',high:'高风险',unknown:'无法判断'};
  const node=(tag,className,text)=>{const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;};
  const button=(text,className)=>{const el=node('button',className,text);el.type='button';return el;};
  const session=refundDetection.createSession({onChange:()=>{render();onBusyChange();}});
  const summaryView=mountRefundCaseSummary(summaryHost,{onOpen(imageId,section,regionId){
    if(!session.entries.some(entry=>entry.id===imageId))return;
    onOpen();resultMode=section==='comparison'?'comparison':'risk';
    selectedId=imageId;selectedRegion=regionId || null;if(section==='region'||section==='mask')showRegions=true;render();
    const target=section==='comparison' ? detail.querySelector('.refund-comparison') : section==='region' ? Array.from(detail.querySelectorAll('[data-region-box]')).find(el=>el.dataset.regionBox===regionId) : detail.querySelector('h3');
    if(target){target.tabIndex=target.tagName==='BUTTON'?0:-1;target.focus({preventScroll:true});target.scrollIntoView({block:'center'});}
  }});
  if(globalThis.Veritas)globalThis.Veritas.refundDetection=refundDetection;
  function render() {
    if(disposed)return;
    const focused=root.contains(document.activeElement) ? document.activeElement.dataset.focus : null;
    const entries=session.entries;
    if(!entries.some(entry=>entry.id===selectedId)){selectedId=entries[0]?.id;selectedRegion=null;}
    root.querySelector('[data-detection-empty]').hidden=entries.length>0;
    root.querySelector('.refund-detection-layout').hidden=!entries.length;
    const attempted=entries.flatMap(entry=>Object.keys(refundDetectionKinds).map(kind=>entry[kind])).filter(item=>item.status!=='idle');
    const ended=attempted.filter(item=>!['running','queued'].includes(item.status)).length;
    root.querySelector('[data-detection-progress]').textContent=attempted.length ? `已结束 ${ended} / ${attempted.length} 项` : '';
    onProgress({busy:session.busy,text:root.querySelector('[data-detection-progress]').textContent});
    refreshControls();list.replaceChildren();detail.replaceChildren();
    for(const entry of entries) {
      const choice=button('', 'refund-detection-file');choice.dataset.selectImage=entry.id;choice.dataset.focus=`image-${entry.id}`;
      choice.setAttribute('aria-label',`查看检测 ${entry.file.name}`);choice.setAttribute('aria-pressed',String(selectedId===entry.id));
      const thumb=node('img');thumb.src=entry.url;thumb.alt='';
      const info=node('span','refund-detection-file-info');const name=node('strong','',entry.file.name);name.title=entry.file.name;info.append(name);
      for(const [kind,label] of [['ai','AI来源'],['tamper','局部篡改'],['comparison','商品核对']]){const state=node('span','refund-detection-state',`${label} · ${entry[kind].result?.localization?.status==='not_triggered'?'未触发定位':capabilities?.[kind]===false?(kind==='tamper'?'不可用':'未接入'):statuses[entry[kind].status]}`);state.dataset.state=entry[kind].status;info.append(state);}
      choice.append(thumb,info);list.append(choice);
    }
    const selected=entries.find(entry=>entry.id===selectedId);
    if(selected)renderDetail(selected);
    summaryView.update(entries,getFields().caseNumber,capabilities);
    if(focused){
      const replacement=Array.from(root.querySelectorAll('[data-focus]')).find(el=>el.dataset.focus===focused);
      const target=replacement?.checkVisibility() && !replacement.matches(':disabled') ? replacement : root.querySelector('#refund-detection-title');
      if(target.checkVisibility())target.focus({preventScroll:true});
    }
  }
  function refreshControls() {
    const blocked=isBlocked();
    root.querySelector('[data-detection-start]').disabled=session.busy || blocked;
    root.querySelector('fieldset').disabled=session.busy || blocked;
    for(const retry of root.querySelectorAll('[data-retry]'))retry.disabled=session.busy || blocked || capabilities?.[retry.dataset.retry]===false;
  }
  function renderDetail(entry) {
    const original=node('div','refund-original'),resultArea=node('div','refund-inspection-results');
    const heading=node('div','refund-inspect-heading'),title=node('h3','',entry.file.name);title.tabIndex=-1;title.dataset.focus=`detail-${entry.id}`;heading.append(title);
    const localization=entry.tamper.result?.localization;
    const regions=localization?[]:entry.tamper.result?.regions || [];
    const mask=localization?.markedPixels?localization.mask:null;
    if(!regions.some(region=>region.id===selectedRegion))selectedRegion=regions[0]?.id || null;
    if(regions.length || mask){const label=node('label');const toggle=node('input');toggle.type='checkbox';toggle.checked=showRegions;toggle.dataset.regionToggle='';toggle.dataset.focus='toggle';label.append(toggle,document.createTextNode(' 显示区域标注'));heading.append(label);}
    original.append(heading);
    const canvas=node('div','refund-inspect-canvas'),frame=node('div','refund-inspect-frame');
    frame.style.width=`min(100%, ${420*entry.width/entry.height}px)`;
    const image=node('img');image.src=entry.url;image.alt=`核查原图 ${entry.file.name}`;frame.append(image);
    if(mask){const overlay=node('div','refund-mask-overlay');overlay.hidden=!showRegions;overlay.setAttribute('aria-hidden','true');overlay.innerHTML=refundMaskSvg(mask,{opacity:maskOpacity});frame.append(overlay);}
    for(const [index,region] of regions.entries()){
      const overlay=button('','refund-region-box');overlay.append(node('span','',String(index+1)));overlay.dataset.regionBox=region.id;overlay.dataset.focus=`box-${region.id}`;
      overlay.hidden=!showRegions || Boolean(mask && region.id!==selectedRegion);overlay.setAttribute('aria-label',`区域${index+1}：${refundRegionTypes[region.type]}`);overlay.setAttribute('aria-pressed',String(selectedRegion===region.id));
      Object.assign(overlay.style,{left:`${region.box.x*100}%`,top:`${region.box.y*100}%`,width:`${region.box.width*100}%`,height:`${region.box.height*100}%`});frame.append(overlay);
    }
    canvas.append(frame);original.append(canvas);
    if(mask){
      const tools=node('div','refund-mark-tools'),legend=node('p','refund-mark-legend','候选编辑区域');
      legend.prepend(node('span','refund-mark-swatch'));tools.append(legend);
      const control=node('label','refund-mark-strength','标记强度'),slider=node('input');
      slider.type='range';slider.min='25';slider.max='75';slider.step='5';slider.value=String(Math.round(maskOpacity*100));slider.dataset.maskStrength='';slider.dataset.focus='mask-strength';slider.setAttribute('aria-label','标记强度');slider.setAttribute('aria-valuetext',`${slider.value}%`);slider.disabled=!showRegions;
      const amount=node('output','',`${slider.value}%`);amount.dataset.maskStrengthValue='';control.append(slider,amount);tools.append(control);
      original.append(tools,node('p','refund-mark-hint','关闭区域标注可对照原图；标记仅供复核。'));
    }
    detail.append(original,resultArea);
    const resultTabs=node('div','refund-tabs refund-result-tabs');resultTabs.id='refund-result-tabs';resultTabs.setAttribute('aria-label','查看检测结果');
    for(const [value,label] of [['risk','风险检测'],['comparison','商品核对']]){const tab=button(label);tab.dataset.tab=value;tab.dataset.focus=`result-tab-${value}`;resultTabs.append(tab);}
    const riskPanel=node('div');riskPanel.dataset.tabPanel='risk';
    const comparisonPanel=node('div');comparisonPanel.dataset.tabPanel='comparison';
    resultArea.append(resultTabs,riskPanel,comparisonPanel);
    const results=node('div','refund-detection-results');
    for(const kind of ['ai','tamper']) {
      const state=entry[kind];const panel=node('section','refund-result-panel');panel.setAttribute('aria-label',refundDetectionKinds[kind]);
      panel.append(node('h4','',kind==='ai'?'图片 AI 来源信号':'局部篡改定位'));
      if(state.result){
        const label=state.result.localization?presentRefundResult(state.result).label:kind==='ai' && capabilities?{low:'来源信号较低',medium:'来源信号中等',high:'来源信号较高',unknown:'无法判断'}[state.result.risk]:risks[state.result.risk];
        const copy=presentRefundResult(state.result);
        const badge=node('span','refund-risk',label);badge.dataset.risk=state.result.risk;panel.append(badge,node('p','refund-result-summary',copy.summary));
        panel.append(node('p','refund-result-scope',`${state.result.coverage==='partial'?'部分覆盖':'完整覆盖'}：${copy.scope}`));
        if(kind==='tamper'&&!state.result.localization&&!regions.length)panel.append(node('p','refund-result-scope','未返回可定位区域，请结合风险说明核查。'));
      } else {
        panel.append(node('p','refund-result-pending',capabilities?.[kind]===false?(kind==='tamper'?'不可用':'未接入'):statuses[state.status]));
        if(state.error)panel.append(node('p','refund-result-error',state.error));
      }
      if(['failed','cancelled'].includes(state.status)){
        const retry=button(`重试${refundDetectionKinds[kind]}`,'refund-button refund-button-secondary');retry.dataset.retry=kind;retry.dataset.focus=`retry-${kind}`;retry.disabled=session.busy||isBlocked()||capabilities?.[kind]===false;panel.append(retry);
      }
      results.append(panel);
    }
    riskPanel.append(results);
    if(regions.length){
      const regionSection=node('section','refund-regions');regionSection.append(node('h4','','可疑区域'));
      const choices=node('div','refund-region-choices');
      for(const [index,region] of regions.entries()){
        const choice=button(`${index+1} · ${refundRegionTypes[region.type]}`,'refund-region-choice');choice.dataset.regionChoice=region.id;choice.dataset.focus=`region-${region.id}`;choice.setAttribute('aria-pressed',String(region.id===selectedRegion));choices.append(choice);
      }
      const active=regions.find(region=>region.id===selectedRegion);const description=node('p','refund-region-detail',`${refundRegionTypes[active.type]}：${active.description}`);description.dataset.regionDetail='';description.setAttribute('role','status');
      regionSection.append(choices,description);riskPanel.append(regionSection);
    }
    const comparison=renderRefundComparison(entry.comparison,session.busy||isBlocked());comparison.dataset.focus=`comparison-${entry.id}`;comparisonPanel.append(comparison);
    mountRefundTabs(resultTabs,[riskPanel,comparisonPanel],{initial:resultMode,onSelect:value=>{resultMode=value;}});
  }
  async function run(kinds,ids) {
    if(isBlocked()||session.busy)return;
    notice.hidden=true;session.sync(getImages(),getFields());
    const linked=capabilities.tamper&&kinds.includes('ai')?[...new Set([...kinds,'tamper'])]:kinds;
    try {await session.run(linked,ids);} catch(error){if(!disposed){notice.textContent=error.message;notice.dataset.kind='warning';notice.hidden=false;}}
  }
  function linkLocalizationSelection(){
    const source=root.querySelector('input[value="ai"]'),local=root.querySelector('input[value="tamper"]');
    const linked=Boolean(capabilities.tamper&&source.checked);
    if(linked)local.checked=true;
    root.querySelector('[data-tamper-auto]').hidden=!linked;
    local.disabled=!capabilities.tamper||linked;
    local.closest('label').title=linked?'来源检测后自动筛查并补充局部定位':capabilities.tamper?'已接入':'局部定位服务尚未配置';
  }
  root.querySelector('[data-detection-start]').addEventListener('click',()=>void run(Array.from(root.querySelectorAll('input[value]:checked'),input=>input.value)));
  root.addEventListener('click',event=>{
    const target=event.target.closest('button');if(!target)return;
    if(target.dataset.selectImage){selectedId=target.dataset.selectImage;selectedRegion=null;render();}
    if(target.dataset.regionBox || target.dataset.regionChoice){resultMode='risk';selectedRegion=target.dataset.regionBox || target.dataset.regionChoice;render();}
    if(target.dataset.retry)void run([target.dataset.retry],[selectedId]);
  });
  root.addEventListener('change',event=>{
    if(event.target.hasAttribute('data-region-toggle')){showRegions=event.target.checked;render();}
    else if(event.target.matches('input[value]')){linkLocalizationSelection();preferredKinds=Array.from(root.querySelectorAll('input[value]:checked'),input=>input.value);}
  });
  root.addEventListener('input',event=>{
    if(!event.target.hasAttribute('data-mask-strength'))return;
    maskOpacity=Number(event.target.value)/100;
    detail.querySelector('[data-mask-fill]')?.setAttribute('fill-opacity',String(maskOpacity));
    event.target.setAttribute('aria-valuetext',`${event.target.value}%`);
    detail.querySelector('[data-mask-strength-value]').textContent=`${event.target.value}%`;
  });
  render();
  return {get entries(){return session.entries;},get busy(){return session.busy;},cancel(){session.cancel();},sync(){session.sync(getImages(),getFields());},getKinds(){return Array.from(root.querySelectorAll('input[value]:checked'),input=>input.value);},setKinds(kinds){
    if(session.busy || !Array.isArray(kinds) || kinds.some(kind=>!Object.hasOwn(refundDetectionKinds,kind)))return;
    preferredKinds=[...new Set(kinds)];
    for(const input of root.querySelectorAll('input[value]'))input.checked=preferredKinds.includes(input.value) && capabilities?.[input.value]!==false;
    linkLocalizationSelection();
    resultMode=preferredKinds.length===1 && preferredKinds[0]==='comparison'?'comparison':'risk';render();
  },setCapabilities(value){
    capabilities=value;
    root.querySelector('[data-tamper-unavailable]').hidden=Boolean(value.tamper);
    for(const input of root.querySelectorAll('input[value]')){input.disabled=!value[input.value];input.checked=Boolean(value[input.value]) && (!preferredKinds || preferredKinds.includes(input.value));input.closest('label').title=value[input.value]?'已接入':input.value==='tamper'?'局部定位服务尚未配置':'当前版本未接入';}
    linkLocalizationSelection();
    render();
  },refreshControls,dispose(){disposed=true;session.dispose();}};
}
