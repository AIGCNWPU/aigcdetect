/** Read-only charts from the same validated projection used by PDF export. */
export function renderRefundSummaryCharts(stats) {
  const node=(tag,className,value)=>{const el=document.createElement(tag);if(className)el.className=className;if(value!==undefined)el.textContent=value;return el;};
  const fragment=document.createDocumentFragment();
  const totals={returned:stats.returned,pending:0,failed:0};
  for(const row of stats.processing){totals.pending+=row.pending;totals.failed+=row.failed;}
  const labels={returned:'已返回',pending:'待完成',failed:'失败 / 取消'};

  const progress=node('section','refund-chart-panel');progress.setAttribute('aria-label','分析状态图');
  const progressHead=node('div','refund-chart-heading');
  progressHead.append(node('h3','','分析状态'),node('span','refund-chart-unit',`${stats.total} 张凭证`));progress.append(progressHead);
  const progressBody=node('div','refund-chart-progress');
  const ring=node('div','refund-result-ring');ring.dataset.resultRing='';ring.setAttribute('role','img');
  ring.setAttribute('aria-label',`共 ${stats.resultSlots} 项结果，已返回 ${totals.returned} 项，待完成 ${totals.pending} 项，失败或取消 ${totals.failed} 项。`);
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 120 120');svg.setAttribute('aria-hidden','true');
  const circumference=2*Math.PI*46;let offset=0;
  for(const [kind,count] of Object.entries(totals)){
    if(!count)continue;
    const length=circumference*count/stats.resultSlots;
    const circle=document.createElementNS('http://www.w3.org/2000/svg','circle');
    for(const [key,value] of Object.entries({cx:60,cy:60,r:46,fill:'none','stroke-width':10,'stroke-dasharray':`${length} ${circumference-length}`,'stroke-dashoffset':-offset,transform:'rotate(-90 60 60)'}))circle.setAttribute(key,String(value));
    circle.dataset.state=kind;svg.append(circle);offset+=length;
  }
  const center=node('div','refund-result-ring-center');center.setAttribute('aria-hidden','true');
  center.append(node('strong','',String(totals.returned)),node('span','',`/ ${stats.resultSlots} 项`),node('small','','结果已返回'));
  ring.append(svg,center);progressBody.append(ring);
  const capabilities=node('dl','refund-chart-capabilities');
  const capabilityLabels={ai:'图片来源',tamper:'局部定位',comparison:'商品核对'};
  for(const row of stats.processing){
    const line=node('div');line.append(node('dt','',capabilityLabels[row.kind]),node('dd','',`${row.returned} / ${stats.total}`));capabilities.append(line);
  }
  progressBody.append(capabilities);progress.append(progressBody);
  const legend=node('ul','refund-chart-legend');legend.setAttribute('aria-label','结果状态统计');
  for(const [kind,count] of Object.entries(totals)){
    const item=node('li'),dot=node('span','refund-chart-dot');dot.dataset.state=kind;dot.setAttribute('aria-hidden','true');
    item.append(dot,node('span','',labels[kind]),node('strong','',String(count)));legend.append(item);
  }
  progress.append(legend);

  const comparison=node('section','refund-chart-panel');comparison.setAttribute('aria-label','商品核对图表');
  const comparisonHead=node('div','refund-chart-heading');comparisonHead.append(node('h3','','商品核对矩阵'),node('span','refund-chart-unit','单位：张'));comparison.append(comparisonHead);
  const table=node('table','refund-comparison-matrix'),caption=node('caption','refund-visually-hidden',`商品核对矩阵：当前 ${stats.total} 张凭证`);
  const head=node('thead'),header=node('tr'),corner=node('th','','结论');corner.scope='col';header.append(corner);
  for(const row of stats.comparisons){const th=node('th','',row.dimension);th.scope='col';header.append(th);}head.append(header);
  const body=node('tbody');
  for(const [outcome,label] of [['match','一致'],['mismatch','不一致'],['unknown','无法判断'],['unavailable','无结果']]){
    const tr=node('tr'),th=node('th','',label);th.scope='row';tr.append(th);
    for(const row of stats.comparisons){
      const count=row[outcome],td=node('td'),value=node('span','refund-matrix-value',count?String(count):'—');
      td.setAttribute('aria-label',`${row.dimension}，${label}：${count} 张`);td.title=`${row.dimension} · ${label}：${count} 张`;
      value.dataset.outcome=outcome;value.dataset.count=String(count);td.append(value);tr.append(td);
    }
    body.append(tr);
  }
  table.append(caption,head,body);comparison.append(table,node('p','refund-chart-footnote','每格为图片张数；— 表示 0 张。'));
  fragment.append(progress,comparison,node('p','refund-analysis-note','图表统计当前全部凭证，筛选仅影响下方明细。局部未触发也计入已返回，具体执行情况见各项结果。'));
  return fragment;
}
