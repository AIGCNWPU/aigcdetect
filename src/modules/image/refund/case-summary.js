export function buildRefundSummary(entries) {
  const rows=entries.map(entry=>{
    const states=Object.fromEntries(['ai','tamper','comparison'].map(kind=>{
      const state=entry[kind] || {status:'idle',result:null,error:''};
      return [kind,{...state,result:state.status==='succeeded' ? state.result : null}];
    }));
    const values=Object.values(states);
    const regions=states.tamper.result?.regions || [];
    const issues=(states.comparison.result?.checks || []).filter(check=>check.outcome!=='match');
    const complete=values.every(state=>state.status==='succeeded' && state.result?.coverage==='full');
    return {id:entry.id,name:entry.file.name,...states,regions,issues,complete,
      attention:regions.length>0 || issues.length>0 || ['ai','tamper'].some(kind=>['medium','high','unknown'].includes(states[kind].result?.risk)),
      failed:values.some(state=>['failed','cancelled'].includes(state.status))};
  });
  return {rows,total:rows.length,complete:rows.filter(row=>row.complete).length};
}

export function filterRefundSummary(rows,filter) {
  return rows.filter(row=>filter==='attention' ? row.attention : filter==='incomplete' ? !row.complete : filter==='failed' ? row.failed : true);
}
