import { buildRefundSummary, filterRefundSummary } from './case-summary.js';
import { refundComparisonDimensions, refundComparisonOutcomes } from './comparison.js';
import { refundRegionTypes } from './detection.js';
import { presentRefundResult } from './presentation.js';
import { buildCurrentRefundReport, summarizeRefundAnalysis } from './pdf-report.js';
import { renderRefundSummaryCharts } from './summary-charts.js';
import { renderContentCredentials } from '../../../lib/content-credentials-view.js';
import { renderAftersalesComparisonTable } from '../../../lib/aftersales-comparison-table.js';

const sections={ai:'AI 来源检测',tamper:'局部篡改检测',comparison:'商品核对'};
const statusLabels={idle:'未检测',queued:'排队中',running:'处理中',succeeded:'已完成',failed:'失败',cancelled:'已取消'};
const riskLabels={low:'低风险',medium:'中风险',high:'高风险',unknown:'无法判断'};
const sourceLabels={low:'来源信号较低',medium:'来源信号中等',high:'来源信号较高',unknown:'无法判断'};

function refundSummaryNode(tag,className,text) {
  const element=document.createElement(tag);
  if (className) element.className=className;
  if (text!==undefined) element.textContent=text;
  return element;
}

export function mountRefundCaseSummary(host,{onOpen,getContentCredentials=()=>null,reportExportAvailable=true}) {
  host.innerHTML=`
    <section class="refund-case-summary" aria-labelledby="refund-summary-title">
      <div class="refund-summary-heading">
        <div><h2 id="refund-summary-title">案件汇总</h2><p data-summary-case></p></div>
        <div class="refund-summary-controls">
          <select aria-label="筛选凭证">
            <option value="all">全部凭证</option>
            <option value="attention">需关注</option>
            <option value="incomplete">未完成或部分覆盖</option>
            <option value="failed">失败或已取消</option>
          </select>
          <button type="button" class="refund-button refund-button-primary" data-report-pdf disabled
            title="${reportExportAvailable?'导出全部当前凭证的分析报告':'报告导出暂未开放'}">导出 PDF</button>
        </div>
      </div>
      <div class="refund-analysis-overview" aria-label="当前检测结果概览" hidden></div>
      <p class="refund-summary-count" data-summary-count role="status" aria-live="polite"></p>
      <div class="refund-summary-list"></div>
      <p class="refund-summary-empty" role="status" hidden></p>
    </section>`;

  const root=host.querySelector('section');
  const select=root.querySelector('select');
  const list=root.querySelector('.refund-summary-list');
  const empty=root.querySelector('.refund-summary-empty');
  const overview=root.querySelector('.refund-analysis-overview');
  const expandedDetails=new Set(),expandedRegions=new Set();
  let entries=[],caseNumber='',capabilities=null;
  const node=refundSummaryNode;

  function link(text,row,section,regionId) {
    const button=node('button','refund-summary-link',text);
    button.type='button';
    button.dataset.summaryImage=row.id;
    button.dataset.summarySection=section;
    if (regionId!==undefined) button.dataset.summaryRegion=regionId;
    button.dataset.summaryFocus=JSON.stringify([row.id,section,regionId || '']);
    return button;
  }

  function stateLabel(kind,state) {
    return capabilities?.[kind]===false?(kind==='tamper'?'不可用':'未接入'):statusLabels[state.status];
  }

  function renderCompact(row) {
    const compact=node('div','refund-summary-compact');
    for (const [kind,title] of Object.entries(sections)) {
      const state=row[kind],result=state.result;
      const cell=node('div','refund-summary-cell');
      cell.dataset.state=state.status;
      cell.append(node('span','refund-summary-cell-title',title));
      if (result?.checks?.length && kind==='comparison') {
        const outcomes=node('div','refund-summary-outcomes');
        for (const check of result.checks) {
          const outcome=node('span','refund-summary-outcome');
          outcome.dataset.outcome=check.outcome;
          outcome.append(node('span','',refundComparisonDimensions[check.dimension]),
            node('strong','',refundComparisonOutcomes[check.outcome]));
          outcomes.append(outcome);
        }
        cell.append(outcomes);
        const affected=result.checks.filter(check=>check.outcome!=='match').length;
        cell.append(node('span','refund-summary-meta',affected?`${affected} 项待核对`:'三项核对一致'));
      } else if (result) {
        const label=presentRefundResult(result).label ||
          (kind==='ai' && capabilities?sourceLabels[result.risk]:riskLabels[result.risk]);
        const value=node('strong','refund-summary-label',label);
        value.dataset.risk=result.risk;
        cell.append(value);
      } else {
        cell.append(node('strong','refund-summary-label',stateLabel(kind,state)));
        if (state.error) cell.append(node('p','refund-result-error',state.error));
      }
      if (result) {
        const scope=result.coverage==='partial'?'部分覆盖':'完整覆盖';
        cell.append(node('span','refund-summary-meta',
          `${result.localization?.status==='not_triggered'?'未执行定位':'已完成'} · ${scope}`));
      }
      compact.append(cell);
    }
    return compact;
  }

  function renderRegions(row,parent) {
    if (row.tamper.result.localization) {
      if (row.tamper.result.localization.markedPixels) parent.append(link('查看原图标记',row,'mask'));
      return;
    }
    if (!row.regions.length) return;
    const details=node('details','refund-summary-regions');
    details.dataset.summaryImage=row.id;
    details.open=expandedRegions.has(row.id);
    const disclosure=node('summary','','可疑区域');
    disclosure.dataset.summaryFocus=JSON.stringify([row.id,'disclosure']);
    const links=node('div');
    for (const [index,region] of row.regions.entries()) {
      const description=refundRegionTypes[region.type];
      const button=link(description,row,'region',region.id);
      button.setAttribute('aria-label',`查看${row.name}的区域${index+1}：${description}`);
      links.append(button);
    }
    details.append(disclosure,links);
    parent.append(details);
  }

  function appendEvidence(row,entry,details) {
    const columns=node('div','refund-summary-columns');
    const credentials=renderContentCredentials(getContentCredentials(entry.file));
    for (const [kind,title] of Object.entries(sections)) {
      const result=row[kind].result;
      if (!result && !(kind==='ai' && credentials)) continue;
      const column=node('section','refund-summary-column');
      column.dataset.summaryKind=kind;
      column.append(node('h4','',title));
      if (result) {
        const copy=presentRefundResult(result);
        column.append(node('p','refund-summary-description',copy.summary),
          node('p','refund-result-scope',`${result.coverage==='partial'?'部分覆盖':'完整覆盖'} · ${copy.scope}`));
        if (kind==='tamper') renderRegions(row,column);
        if (kind==='comparison' && result.checks?.length) {
          column.append(renderAftersalesComparisonTable(result,{
            dimensions:refundComparisonDimensions,outcomes:refundComparisonOutcomes,
            observationLabel:'图片观察与依据',
          }));
        }
      }
      if (kind==='ai' && credentials) column.append(credentials);
      columns.append(column);
    }
    details.append(columns);
  }

  function render() {
    const focused=list.contains(document.activeElement)?document.activeElement.dataset.summaryFocus:null;
    const summary=buildRefundSummary(entries),rows=filterRefundSummary(summary.rows,select.value);
    const evidenceById=new Map(entries.map(entry=>[entry.id,entry]));
    overview.replaceChildren();
    overview.hidden=!entries.length;
    if (entries.length) {
      overview.append(renderRefundSummaryCharts(summarizeRefundAnalysis(buildCurrentRefundReport({},entries))));
    }

    for (const details of list.querySelectorAll('details[data-summary-image]')) {
      if (details.open) expandedRegions.add(details.dataset.summaryImage);
      else expandedRegions.delete(details.dataset.summaryImage);
    }
    for (const details of list.querySelectorAll('details[data-summary-details]')) {
      if (details.open) expandedDetails.add(details.dataset.summaryDetails);
      else expandedDetails.delete(details.dataset.summaryDetails);
    }
    for (const id of expandedDetails) {
      const row=summary.rows.find(item=>item.id===id);
      if (!row || !Object.keys(sections).some(kind=>row[kind].status!=='idle')) expandedDetails.delete(id);
    }
    for (const id of expandedRegions) {
      if (!summary.rows.some(row=>row.id===id && row.regions.length)) expandedRegions.delete(id);
    }

    root.querySelector('[data-summary-case]').textContent=caseNumber?`案件 ${caseNumber}`:'当前案件';
    const enabled=Object.keys(sections).filter(kind=>capabilities?.[kind]!==false);
    const processed=enabled.length?entries.filter(entry=>enabled.every(kind=>entry[kind]?.status==='succeeded')).length:0;
    const completed=capabilities?`全部可用项目已返回 ${processed} 张`:`三项完整处理 ${summary.complete} 张`;
    root.querySelector('[data-summary-count]').textContent=entries.length?
      `凭证 ${summary.total} 张 · ${completed} · 当前显示 ${rows.length} 张`:'';
    empty.hidden=rows.length>0;
    empty.textContent=summary.total?'没有符合当前筛选的凭证。':'添加图片后，可在这里查看分析结果。';

    const cards=document.createDocumentFragment();
    for (const row of rows) {
      const entry=evidenceById.get(row.id);
      const article=node('article','refund-summary-row');
      article.dataset.summaryRow=row.id;
      const header=node('div','refund-summary-row-heading');
      const identity=node('div','refund-summary-identity');
      if (entry.url) {
        const thumbnail=node('img','refund-summary-thumbnail');
        thumbnail.src=entry.url;
        thumbnail.alt='';
        thumbnail.loading='lazy';
        identity.append(thumbnail);
      }
      identity.append(node('h3','',row.name));
      const actions=node('div','refund-summary-row-actions');
      const open=link('查看原图',row,'image');
      open.setAttribute('aria-label',`查看${row.name}的原图`);
      actions.append(open);
      const comparison=link('核对详情',row,'comparison');
      comparison.setAttribute('aria-label',`查看${row.name}的核对详情`);
      actions.append(comparison);
      header.append(identity,actions);
      article.append(header,renderCompact(row));
      if ([row.ai,row.tamper,row.comparison].some(state=>state.result) || getContentCredentials(entry.file)) {
        const details=node('details','refund-summary-details');
        details.dataset.summaryDetails=row.id;
        details.open=expandedDetails.has(row.id);
        const disclosure=node('summary','','查看说明与依据');
        disclosure.dataset.summaryFocus=JSON.stringify([row.id,'details']);
        details.append(disclosure);
        appendEvidence(row,entry,details);
        article.append(details);
      }
      cards.append(article);
    }
    list.replaceChildren(cards);
    if (focused) {
      const target=Array.from(list.querySelectorAll('[data-summary-focus]')).find(el=>el.dataset.summaryFocus===focused);
      (target||select).focus({preventScroll:true});
    }
  }

  select.addEventListener('change',render);
  root.addEventListener('click',event=>{
    const button=event.target.closest('button[data-summary-image]');
    if (button) onOpen(button.dataset.summaryImage,button.dataset.summarySection,button.dataset.summaryRegion);
  });
  return {update(nextEntries,nextCaseNumber,nextCapabilities=null){
    entries=nextEntries;
    capabilities=nextCapabilities;
    caseNumber=String(nextCaseNumber||'').trim();
    render();
  }};
}
