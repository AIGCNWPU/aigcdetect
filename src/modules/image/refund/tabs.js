// A tab switch changes visibility only; the owning case keeps its session alive.
export function mountRefundTabs(list,panels,{initial,onSelect=()=>{}}={}) {
  const tabs=Array.from(list.querySelectorAll('[data-tab]'));
  list.setAttribute('role','tablist');
  for(const tab of tabs){
    const panel=panels.find(item=>item.dataset.tabPanel===tab.dataset.tab);
    tab.type='button';tab.id=`${list.id}-${tab.dataset.tab}`;tab.setAttribute('role','tab');
    panel.id=`${tab.id}-panel`;tab.setAttribute('aria-controls',panel.id);
    panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',tab.id);
  }
  function select(value,{focus=false,notify=true}={}){
    const active=tabs.find(tab=>tab.dataset.tab===value);if(!active)return;
    for(const tab of tabs){const selected=tab===active;tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;}
    for(const panel of panels)panel.hidden=panel.dataset.tabPanel!==value;
    if(focus)active.focus({preventScroll:true});
    if(notify)onSelect(value);
  }
  list.addEventListener('click',event=>{const tab=event.target.closest('[data-tab]');if(tab&&tabs.includes(tab))select(tab.dataset.tab);});
  list.addEventListener('keydown',event=>{
    const index=tabs.indexOf(event.target);if(index<0)return;
    const next={ArrowRight:(index+1)%tabs.length,ArrowLeft:(index+tabs.length-1)%tabs.length,Home:0,End:tabs.length-1}[event.key];
    if(next===undefined)return;event.preventDefault();select(tabs[next].dataset.tab,{focus:true});
  });
  select(initial||tabs[0].dataset.tab,{notify:false});
  return {select};
}
