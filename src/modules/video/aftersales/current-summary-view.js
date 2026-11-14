import { aftersalesComparisonDimensions, aftersalesDetectionKinds, aftersalesProductKinds } from './detection.js';
import { aftersalesButton, aftersalesComparisonOutcomes, aftersalesNode, aftersalesRiskText, aftersalesStateText, aftersalesTime, renderAftersalesResults } from './results-view.js';
import { aftersalesIncomplete } from './source-analysis.js';
import { frameLocalizationIncomplete } from './frame-localization.js';

function matchesFilter(states, filter) {
  if (filter==='incomplete') return states.some(aftersalesIncomplete);
  if (filter==='failed') {
    return states.some(state=>['failed','cancelled'].includes(state.status) ||
      state.result?.sourceAnalysis?.complete===false || frameLocalizationIncomplete(state.result?.frameLocalization));
  }
  if (filter==='attention') {
    return states.some(({result})=>result && result.applicability!=='not_applicable' &&
      (['high','medium','unknown'].includes(result.risk) || result.checks?.some(check=>check.outcome!=='match')));
  }
  return true;
}

function renderSummaryCheck(kind, state, sharedError) {
  const {result}=state;
  const item=aftersalesNode('div','av-summary-check');
  const label=result?.applicability==='not_applicable'?'不适用':aftersalesStateText(state);
  const badge=aftersalesNode('dd','av-summary-state',label);
  badge.dataset.state=label==='部分完成'?'partial':label==='不适用'?'idle':state.status;
  item.append(aftersalesNode('dt','',aftersalesDetectionKinds[kind]),badge);

  if (kind==='ai' && result) {
    const decision=aftersalesNode('dd','av-summary-decision',aftersalesRiskText(result));
    decision.dataset.risk=result.risk;
    item.append(decision);
  } else if (result?.checks?.length) {
    const outcomes=aftersalesNode('dd','av-summary-outcomes');
    for (const [dimension,title] of Object.entries(aftersalesComparisonDimensions)) {
      const check=result.checks.find(row=>row.dimension===dimension);
      if (!check) continue;
      const outcome=aftersalesNode('span','av-summary-outcome');
      outcome.dataset.outcome=check.outcome;
      outcome.append(aftersalesNode('span','',title),aftersalesNode('strong','',aftersalesComparisonOutcomes[check.outcome]));
      outcomes.append(outcome);
    }
    item.append(outcomes);
    return item;
  }

  const note=result?.sourceAnalysis?'':result?.summary||(!sharedError?state.error:'');
  if (note) item.append(aftersalesNode('dd','av-summary-note',note));
  return item;
}

export function mountCurrentAftersalesSummary(host,{
  getEntries,onLocalOpen,isBlocked=()=>false,isExporting=()=>false,onExport=()=>{},onCancelExport=()=>{},
}) {
  host.classList.add('av-current-summary');
  host.innerHTML=`
    <div class="av-section-heading">
      <div>
        <h3>本次视频分析汇总</h3>
        <p>仅展示当前上传的视频。离开页面后不保留历史分析记录。</p>
      </div>
      <div class="av-summary-controls">
        <select aria-label="汇总筛选">
          <option value="all">全部视频</option>
          <option value="attention">需要复核</option>
          <option value="incomplete">未完成</option>
          <option value="failed">失败或取消</option>
        </select>
        <div class="av-report-buttons"></div>
      </div>
    </div>
    <div data-current-summary></div>`;
  const list=host.querySelector('[data-current-summary]');
  const filter=host.querySelector('select');
  const buttons=host.querySelector('.av-report-buttons');
  const exportButton=aftersalesButton('导出 PDF',()=>{
    if (!isBlocked() && getEntries().length) void onExport();
  });
  const cancelButton=aftersalesButton('取消导出',onCancelExport);
  exportButton.dataset.avPdf='';
  exportButton.title='导出全部当前视频的分析报告';
  cancelButton.dataset.avPdfCancel='';
  buttons.append(exportButton,cancelButton);

  const rows=new Map();
  let disposed=false;
  function refreshControls() {
    const exporting=isExporting();
    exportButton.disabled=isBlocked() || !getEntries().length;
    exportButton.textContent=exporting?'正在生成 PDF…':'导出 PDF';
    cancelButton.hidden=!exporting;
  }

  function createRow(entry) {
    const article=aftersalesNode('article','av-summary-row');
    article.dataset.summaryVideo=entry.id;
    const heading=aftersalesNode('div','av-summary-heading');
    const identity=aftersalesNode('div','av-summary-identity');
    identity.append(
      aftersalesNode('h4','',entry.file.name),
      aftersalesNode('p','av-summary-file-meta',`${aftersalesTime(entry.duration)} · ${entry.width} × ${entry.height}`),
    );
    const open=aftersalesButton('查看视频',()=>onLocalOpen(entry.id));
    open.setAttribute('aria-label',`查看视频 ${entry.file.name}`);
    open.dataset.avFocus='watch';
    heading.append(identity,open);
    article.append(heading);

    const body=aftersalesNode('div','av-summary-body');
    const checks=aftersalesNode('dl','av-summary-checks');
    const error=aftersalesNode('p','av-summary-error');
    body.append(checks,error);
    article.append(body);

    const details=aftersalesNode('details','av-summary-evidence');
    details.dataset.video=entry.id;
    details.hidden=true;
    const disclosure=aftersalesNode('summary','','查看依据与采样位置');
    disclosure.dataset.avFocus='evidence';
    const evidence=aftersalesNode('div','av-results');
    details.append(disclosure,evidence);
    article.append(details);
    const row={article,checks,error,details,evidence,version:entry.version};
    details.addEventListener('toggle',()=>{
      if (details.open && !disposed) refreshEvidence(row);
    });
    return row;
  }

  function refreshEvidence(row) {
    const states=aftersalesProductKinds.map(kind=>row.entry[kind]);
    if (row.rendered && states.every(({result},index)=>result===row.rendered[index])) return;
    renderAftersalesResults(row.evidence,row.entry,{
      kinds:aftersalesProductKinds.filter(kind=>row.entry[kind].result),
      onPosition:(time,end)=>onLocalOpen(row.entry.id,time,end),
      inSummary:true,
    });
    row.rendered=states.map(state=>state.result);
  }

  function update() {
    if (disposed) return;
    refreshControls();
    const active=document.activeElement;
    const focused=active?.closest('[data-summary-video]')?.dataset.summaryVideo;
    const focusKey=active?.dataset.avFocus;
    const entries=getEntries();
    const currentIds=new Set(entries.map(entry=>entry.id));
    for (const id of rows.keys()) if (!currentIds.has(id)) rows.delete(id);

    const visible=[];
    for (const entry of entries) {
      const states=aftersalesProductKinds.map(kind=>entry[kind]);
      let row=rows.get(entry.id);
      if (row?.version!==entry.version) {
        rows.delete(entry.id);
        row=undefined;
      }
      if (!matchesFilter(states,filter.value)) continue;
      if (!row) {
        row=createRow(entry);
        rows.set(entry.id,row);
      }
      row.entry=entry;
      const firstError=states[0].error;
      const sharedError=Boolean(firstError && states.every(state=>!state.result && state.error===firstError));
      row.checks.replaceChildren(...aftersalesProductKinds.map(kind=>renderSummaryCheck(kind,entry[kind],sharedError)));
      row.error.hidden=!sharedError;
      row.error.textContent=sharedError?firstError:'';
      row.details.hidden=!states.some(state=>state.result);
      if (row.details.hidden) {
        row.details.open=false;
        row.evidence.replaceChildren();
        row.rendered=undefined;
      } else if (row.details.open) refreshEvidence(row);
      visible.push(row.article);
    }
    const empty=entries.length?'当前筛选下没有视频。':'添加视频后可在这里查看分析结果。';
    list.replaceChildren(...(visible.length?visible:[aftersalesNode('p','av-empty',empty)]));

    if (focused && focusKey) {
      const target=Array.from(rows.get(focused)?.article.querySelectorAll('[data-av-focus]')||[])
        .find(element=>element.dataset.avFocus===focusKey);
      (target?.isConnected && target.getClientRects().length?target:filter).focus({preventScroll:true});
    }
  }

  filter.addEventListener('change',update);
  update();
  return {update,refreshControls,dispose(){disposed=true;rows.clear();}};
}
