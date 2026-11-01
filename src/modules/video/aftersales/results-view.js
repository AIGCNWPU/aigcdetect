import { aftersalesDetectionKinds, aftersalesModificationTypes, aftersalesComparisonDimensions } from './detection.js';

export const aftersalesStateLabels=Object.freeze({idle:'未检测',queued:'排队中',running:'检测中',succeeded:'已完成',failed:'失败',cancelled:'已取消'});
export function aftersalesNode(tag,className='',text){const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;}
export function aftersalesButton(text,action){const button=aftersalesNode('button','',text);button.type='button';if(action)button.addEventListener('click',action);return button;}
export function aftersalesTime(seconds){const rounded=Math.round(seconds*1000)/1000,remainder=Number((rounded%60).toFixed(3));return `${Math.floor(rounded/60)}:${remainder<10?'0':''}${remainder}`;}
export function aftersalesKindLabel(kind,type='video'){return type==='image'?{ai:'AI生成凭证检测',tamper:'局部篡改检测',comparison:'商品与描述核对'}[kind]:aftersalesDetectionKinds[kind];}
export function aftersalesRowFlags(states){
  const values=Object.values(states);
  return {complete:values.length===3&&values.every(s=>s.status==='succeeded'&&s.result?.coverage==='full'),failed:values.some(s=>['failed','cancelled'].includes(s.status)),attention:values.some(s=>s.result&&(['medium','high','unknown'].includes(s.result.risk)||s.result.segments?.length||s.result.regions?.length||s.result.checks?.some(c=>c.outcome!=='match')))};
}
export function renderAftersalesResults(host,states,{onPosition,onRegion,onRetry,blocked=false,mediaType='video',kinds=Object.keys(aftersalesDetectionKinds)}={}){
  host.replaceChildren();
  const outcomes={match:'一致',mismatch:'不一致',unknown:'无法判断'},risks={low:'低风险',medium:'中风险',high:'高风险',unknown:'无法判断'};
  const locations=(parent,segments)=>{for(const segment of segments||[]){const button=aftersalesButton(`${segment.point?'画面':'片段'} ${aftersalesTime(segment.start)}${segment.point?'':'—'+aftersalesTime(segment.end)} · ${segment.description}`,()=>onPosition?.(segment.start,segment.point?undefined:segment.end));button.disabled=!onPosition;button.className='av-position';parent.append(button);if(segment.type)parent.append(aftersalesNode('small','av-muted',aftersalesModificationTypes[segment.type]));}};
  for(const kind of kinds){const label=aftersalesKindLabel(kind,mediaType);
    const state=states[kind]||{status:'idle'},card=aftersalesNode('section','av-result-card');card.dataset.resultKind=kind;
    const heading=aftersalesNode('div','av-result-heading');heading.append(aftersalesNode('h4','',label),aftersalesNode('span','av-state',aftersalesStateLabels[state.status]));card.append(heading);
    const result=state.status==='succeeded'?state.result:null;
    if(result){
      if(result.risk){const pill=aftersalesNode('strong','av-risk',result.applicability==='not_applicable'?'不适用':risks[result.risk]);pill.dataset.risk=result.risk;card.append(pill);}
      card.append(aftersalesNode('p','av-result-summary',result.summary),aftersalesNode('p','av-muted',`${result.coverage==='full'?'完整覆盖':'部分覆盖'} · ${result.scope}`));
      if(result.checks){for(const check of result.checks){const group=aftersalesNode('div','av-check');group.append(aftersalesNode('h5','',`${aftersalesComparisonDimensions[check.dimension]} · ${outcomes[check.outcome]}`),aftersalesNode('p','',`参照：${result.references?.[check.dimension]||'未提供'}`),aftersalesNode('p','',`画面观察：${check.observed}`),aftersalesNode('p','',`依据：${check.evidence}`));locations(group,check.segments);card.append(group);}}
      locations(card,result.segments);
      for(const frame of result.frames||[]){const button=aftersalesButton(`画面 ${aftersalesTime(frame.time)} · ${frame.label}`,()=>onPosition?.(frame.time));button.disabled=!onPosition;button.className='av-position';card.append(button);}
      for(const [index,region] of (result.regions||[]).entries()){const button=aftersalesButton(`区域 ${index+1} · ${region.description}`,()=>onRegion?.(region));button.disabled=!onRegion;button.className='av-position';card.append(button);}
      if(kind!=='comparison'&&result.applicability!=='not_applicable'&&!result.segments?.length&&!result.regions?.length)card.append(aftersalesNode('p','av-muted','未返回可定位位置，请结合风险与覆盖范围复核。'));
    }else card.append(aftersalesNode('p','av-muted',state.error||'暂无检测结果。'));
    if(onRetry&&['failed','cancelled'].includes(state.status)){const retry=aftersalesButton(`重试 ${label}`,()=>onRetry(kind));retry.disabled=blocked;card.append(retry);}
    Array.from(card.querySelectorAll('button')).forEach((button,index)=>{button.dataset.avFocus=`${kind}-${index}-${button.textContent}`;});host.append(card);
  }
}
