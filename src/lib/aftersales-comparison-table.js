export function renderAftersalesComparisonTable(result,{dimensions,outcomes,observationLabel,appendPositions}){
  const node=(tag,className,text)=>{
    const element=document.createElement(tag);
    if(className)element.className=className;
    if(text!==undefined)element.textContent=text;
    return element;
  };
  const container=node('div','aftersales-comparison-table-wrap');
  const table=node('table','aftersales-comparison-table');
  table.setAttribute('role','table');
  const headings=table.createTHead().insertRow();
  for(const label of ['核对项','参照资料',observationLabel]){
    const title=node('th','',label);
    title.scope='col';
    headings.append(title);
  }
  const body=table.createTBody();
  for(const check of result.checks){
    const row=body.insertRow();
    row.dataset.comparisonCheck=check.dimension;
    const item=node('th','aftersales-comparison-item');
    item.scope='row';
    const outcome=node('span','aftersales-comparison-outcome',outcomes[check.outcome]);
    outcome.dataset.outcome=check.outcome;
    item.append(node('span','',dimensions[check.dimension]),outcome);
    row.append(item);

    const reference=row.insertCell();
    reference.dataset.label='参照资料';
    reference.textContent=result.references?.[check.dimension]||'未提供参照资料';
    const observation=row.insertCell();
    observation.dataset.label=observationLabel;
    observation.append(node('p','',check.observed),node('p','aftersales-comparison-evidence',check.evidence));
    if(appendPositions&&check.segments?.length){
      const positions=node('div','aftersales-comparison-positions');
      appendPositions(positions,check.segments);
      observation.append(positions);
    }
  }
  container.append(table);
  return container;
}
