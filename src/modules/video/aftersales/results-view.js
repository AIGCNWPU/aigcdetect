import { aftersalesDetectionKinds, aftersalesModificationTypes, aftersalesComparisonDimensions } from './detection.js';
import { videoSourceDefinitions, videoDetailDefinition, aftersalesIncomplete } from './source-analysis.js';
import { renderFrameLocalization } from './frame-localization-view.js';

export const aftersalesStateLabels=Object.freeze({idle:'未检测',queued:'排队中',running:'检测中',succeeded:'已完成',failed:'失败',cancelled:'已取消'});
export function aftersalesStateText(state){return state?.status==='succeeded'&&aftersalesIncomplete(state)?'部分完成':aftersalesStateLabels[state?.status]||'未检测';}
export function aftersalesNode(tag,className='',text){const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;}
export function aftersalesButton(text,action){const button=aftersalesNode('button','',text);button.type='button';if(action)button.addEventListener('click',action);return button;}
export function aftersalesTime(seconds){const rounded=Math.round(seconds*1000)/1000,remainder=Number((rounded%60).toFixed(3));return `${Math.floor(rounded/60)}:${remainder<10?'0':''}${remainder}`;}
export function aftersalesKindLabel(kind,type='video'){return type==='image'?{ai:'AI生成凭证检测',tamper:'局部篡改检测',comparison:'商品与描述核对'}[kind]:aftersalesDetectionKinds[kind];}
export function aftersalesRowFlags(states){
  const values=Object.values(states);
  return {complete:values.length===3&&values.every(s=>s.status==='succeeded'&&s.result?.coverage==='full'),failed:values.some(s=>['failed','cancelled'].includes(s.status)),attention:values.some(s=>s.result&&(['medium','high','unknown'].includes(s.result.risk)||s.result.segments?.length||s.result.regions?.length||s.result.checks?.some(c=>c.outcome!=='match')))};
}
export function renderAftersalesResults(host,states,{onPosition,onRegion,onRetry,blocked=false,mediaType='video',kinds=Object.keys(aftersalesDetectionKinds)}={}){
  const openEvidence=new Set(Array.from(host.querySelectorAll('details[data-av-evidence][open]'),element=>element.dataset.avEvidence));
  const maskVisibility=new Map(Array.from(host.querySelectorAll('[data-av-frame]'),element=>[element.dataset.avFrame,element.querySelector('[data-av-mask-switch]')?.checked]));
  host.replaceChildren();
  const outcomes={match:'一致',mismatch:'不一致',unknown:'无法判断'},risks={low:'低风险',medium:'中风险',high:'高风险',unknown:'无法判断'};
  const locations=(parent,segments)=>{for(const segment of segments||[]){const button=aftersalesButton(`${segment.point?'画面':'片段'} ${aftersalesTime(segment.start)}${segment.point?'':'—'+aftersalesTime(segment.end)} · ${segment.description}`,()=>onPosition?.(segment.start,segment.point?undefined:segment.end));button.disabled=!onPosition;button.className='av-position';parent.append(button);if(segment.type)parent.append(aftersalesNode('small','av-muted',aftersalesModificationTypes[segment.type]));}};
  for(const kind of kinds){const label=aftersalesKindLabel(kind,mediaType);
    const state=states[kind]||{status:'idle'},card=aftersalesNode('section','av-result-card');card.dataset.resultKind=kind;
    const heading=aftersalesNode('div','av-result-heading');heading.append(aftersalesNode('h4','',label),aftersalesNode('span','av-state',aftersalesStateText(state)));card.append(heading);
    const result=state.status==='succeeded'?state.result:null;
    if(result){
      if(result.risk){const pill=aftersalesNode('strong','av-risk',result.sourceAnalysis?{review:'建议人工复核',not_triggered:'未触发来源复核',incomplete:'来源结果不完整'}[result.sourceAnalysis.policies.complementary]:result.applicability==='not_applicable'?'不适用':risks[result.risk]);pill.dataset.risk=result.risk;card.append(pill);}
      card.append(aftersalesNode('p','av-result-summary',result.summary),aftersalesNode('p','av-muted',`${result.coverage==='full'?'完整覆盖':'部分覆盖'} · ${result.scope}`));
      if(result.sourceAnalysis){
        const multiFrame=result.sourceAnalysis.version===3;
        const group=aftersalesNode('div','av-source-channels');
        for(const [id,definition] of Object.entries(videoSourceDefinitions)){
          const channel=result.sourceAnalysis.channels[id],section=aftersalesNode('section','av-source-channel');section.dataset.sourceChannel=id;
          section.append(aftersalesNode('h5','',definition.label));
          if(channel.status==='failed')section.append(aftersalesNode('strong','av-source-missing','未取得结果'),aftersalesNode('p','av-muted',channel.error));
          else{
            section.append(aftersalesNode('strong','av-source-score',`${(channel.score*100).toFixed(1)}%`),aftersalesNode('span','av-muted',multiFrame?(channel.triggered?'达到本路参考门槛':'未达到本路参考门槛'):(channel.triggered?'触发复核门槛':'未触发复核门槛')));
            const meter=aftersalesNode('div','av-source-meter'),fill=aftersalesNode('span'),mark=aftersalesNode('i');
            fill.style.width=`${channel.score*100}%`;mark.style.left=`${channel.threshold*100}%`;meter.append(fill,mark);meter.setAttribute('role','img');meter.setAttribute('aria-label',`来源分数 ${(channel.score*100).toFixed(1)}%，复核门槛 ${(channel.threshold*100).toFixed(1)}%`);
            section.append(meter,aftersalesNode('small','av-muted',`${channel.sampleCount} 个抽样画面 · 本路门槛 ${(channel.threshold*100).toFixed(1)}%`));
          }
          group.append(section);
        }
        const detail=result.sourceAnalysis.detail;
        if(detail){
          const section=aftersalesNode('section','av-source-channel av-source-detail');section.dataset.sourceChannel='detail';
          section.append(aftersalesNode('h5','',`${videoDetailDefinition.label} · 补充依据`));
          if(detail.status==='skipped'){
            const reasons={baseline_triggered:'已取得复核线索，无需追加细节采样。',context_below_guard:'当前整幅画面未达到补充细节复核条件。',context_unavailable:'关键画面分析未完成，细节复核暂未运行。',frame_triggered:'基础关键画面已提供复核依据，无需追加细节采样。',prerequisite_unavailable:'基础来源结果不完整，细节与多帧核验暂未运行。'};
            section.append(aftersalesNode('strong','','未运行'),aftersalesNode('p','av-muted',reasons[detail.reason]));
          }else if(detail.status==='failed')section.append(aftersalesNode('strong','av-source-missing','未取得结果'),aftersalesNode('p','av-muted',detail.error));
          else{
            section.append(aftersalesNode('strong','av-source-score',`${(detail.score*100).toFixed(1)}%`),aftersalesNode('span','av-muted',detail.triggered?'触发细节复核门槛':multiFrame?'纳入多帧共同核验':'未触发细节复核门槛'));
            const meter=aftersalesNode('div','av-source-meter'),fill=aftersalesNode('span'),mark=aftersalesNode('i');fill.style.width=`${detail.score*100}%`;mark.style.left=`${detail.threshold*100}%`;meter.append(fill,mark);meter.setAttribute('role','img');meter.setAttribute('aria-label',`细节分数 ${(detail.score*100).toFixed(1)}%，复核门槛 ${(detail.threshold*100).toFixed(1)}%`);
            section.append(meter,aftersalesNode('small','av-muted',`8 个原像素中心细节画面 · 本项门槛 ${(detail.threshold*100).toFixed(1)}%`));
            const evidence=aftersalesNode('details'),list=aftersalesNode('div','av-detail-frame-list');evidence.dataset.avEvidence=`${kind}-detail`;evidence.open=openEvidence.has(evidence.dataset.avEvidence);evidence.append(aftersalesNode('summary','','查看细节采样时间与分数'));
            for(const frame of detail.frames){const button=aftersalesButton(`${aftersalesTime(frame.time)} · 细节分数 ${(frame.score*100).toFixed(1)}%`,()=>onPosition?.(frame.time));button.className='av-position';button.disabled=!onPosition;list.append(button);}evidence.append(list);section.append(evidence);
          }
          section.append(aftersalesNode('small','av-muted',multiFrame?'中心细节结合基础画面和连续采样共同核验；不代表已定位篡改区域。':'满足整幅画面支持条件后核对中心细节；复核线索不代表已定位篡改区域。'));group.append(section);
        }
        card.append(group,aftersalesNode('p','av-muted',`${detail?'各项':'两路'}分数含义与门槛不同，不能相加或直接比较，也不代表造假概率。`));
        const strategies=aftersalesNode('div','av-source-policies'),states={review:'建议复核',not_triggered:'未触发',incomplete:'结果不完整'};
        for(const [id,text] of [['conservative','画面优先 · 基础画面建议'],['complementary',multiFrame?'多帧综合核验':detail?'互补复核 · 含细节检查':'双路互补 · 减少漏报']])strategies.append(aftersalesNode('p','',`${text}：${states[result.sourceAnalysis.policies[id]]}`));
        strategies.append(aftersalesNode('small','av-muted',multiFrame?'当前建议保留基础画面阳性，并核对跨画面的证据强度与细节分布；单路参考门槛不等于综合结论。':`${detail?'互补复核结合各项有效线索':'双路互补以任一路触发为复核线索'}，会增加人工核查；当前复核建议采用此方式。`));card.append(strategies);
      }
      if(result.frameLocalization)card.append(renderFrameLocalization(result.frameLocalization,{onPosition,open:openEvidence.has('frame-localization'),visibility:maskVisibility}));
      if(result.checks){for(const check of result.checks){const group=aftersalesNode('div','av-check');group.append(aftersalesNode('h5','',`${aftersalesComparisonDimensions[check.dimension]} · ${outcomes[check.outcome]}`),aftersalesNode('p','',`参照：${result.references?.[check.dimension]||'未提供'}`),aftersalesNode('p','',`画面观察：${check.observed}`),aftersalesNode('p','',`依据：${check.evidence}`));locations(group,check.segments);card.append(group);}}
      locations(card,result.segments);
      let frameHost=card;
      if(result.sourceAnalysis&&result.frames?.length){frameHost=aftersalesNode('details','av-sample-times');frameHost.dataset.avEvidence=`${kind}-base`;frameHost.open=openEvidence.has(frameHost.dataset.avEvidence);frameHost.append(aftersalesNode('summary','','查看基础采样时间与分数'));card.append(frameHost);}
      for(const frame of result.frames||[]){const button=aftersalesButton(`画面 ${aftersalesTime(frame.time)} · ${frame.label}`,()=>onPosition?.(frame.time));button.disabled=!onPosition;button.className='av-position';frameHost.append(button);}
      for(const [index,region] of (result.regions||[]).entries()){const button=aftersalesButton(`区域 ${index+1} · ${region.description}`,()=>onRegion?.(region));button.disabled=!onRegion;button.className='av-position';card.append(button);}
      if(kind!=='comparison'&&result.applicability!=='not_applicable'&&!result.segments?.length&&!result.regions?.length&&!result.frames?.length&&!result.sourceAnalysis?.detail?.frames?.length)card.append(aftersalesNode('p','av-muted','未返回可定位位置，请结合风险与覆盖范围复核。'));
    }else card.append(aftersalesNode('p','av-muted',state.error||'暂无检测结果。'));
    if(onRetry&&(['failed','cancelled'].includes(state.status)||state.status==='succeeded'&&aftersalesIncomplete(state))){const retry=aftersalesButton(`重试 ${label}`,()=>onRetry(kind));retry.disabled=blocked;card.append(retry);}
    Array.from(card.querySelectorAll('button')).forEach((button,index)=>{button.dataset.avFocus=`${kind}-${index}-${button.textContent}`;});host.append(card);
  }
}
