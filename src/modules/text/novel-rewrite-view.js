import { chapterTextDownload, createChapterVersion, createNovelRewriteStore, createRewriteDraftSession, hashNovelContent, inspectRewriteProposals, selectNovelChapterResult } from './novel-rewrite.js';

const escapeHtml=value=>String(value??'').replace(/[&<>"']/gu,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const scoreText=(run,chapterId)=>{const risk=selectNovelChapterResult(run.result?.aiRisk,chapterId,{allowSingleChapter:Object.keys(run.versionIds||{}).length===1}),score=risk?.documentScore?.score;return score!=null&&Number.isFinite(Number(score))?`${Math.round(Number(score)*100)}%`:'本章未返回得分';};
const clone=value=>structuredClone(value);

function saveBlob(file){const blob=new Blob([file.content],{type:file.type}),url=URL.createObjectURL(blob),link=Object.assign(document.createElement('a'),{href:url,download:file.fileName});link.click();URL.revokeObjectURL(url);return file.fileName;}
function currentVersion(chapter){return chapter.versions.find(item=>item.versionId===chapter.activeVersionId)||chapter.versions.at(-1);}
function chapterRun(work,versionId){return [...(work.runs||[])].reverse().find(run=>Object.values(run.versionIds||{}).includes(versionId));}
function workByTitle(history,title){return history.works.find(item=>item.workTitle===title)||null;}

export function createNovelRewriteController({container,chapters,getWorkTitle,apiInvoke,onRestore,onShowSnapshot,drafts,onDraftApplied=()=>{},canUseSuggestions=()=>true,canOpenSnapshot=()=>true}){
  const panel=container.querySelector('[data-rewrite-panel]'),status=container.querySelector('[data-rewrite-status]'),proposalList=container.querySelector('[data-rewrite-proposals]'),historyList=container.querySelector('[data-rewrite-history]');
  const store=createNovelRewriteStore(),sessions=new Map();let history={schemaVersion:1,works:[],updatedAt:null},activeWork=null,activeBatch=null,generating=false,requestGeneration=0;
  // 清理旧版改写功能的持久记录，不影响其他业务的浏览器数据。
  try{globalThis.localStorage?.removeItem('veritas_novel_rewrite_history_v1');}catch{ /* 站点存储可能被禁用 */ }
  const message=(value,tone='')=>{status.textContent=value;status.className=`text-operation-message ${tone}`.trim();};
  async function persist(){try{await store.save(history);return true;}catch(error){message(error.message,'is-warning');return false;}}
  function ensureWork(title){let work=workByTitle(history,title);if(!work){work={workId:globalThis.crypto?.randomUUID?.()||`work-${Date.now()}`,workTitle:title,chapters:[],runs:[],batches:[],updatedAt:new Date().toISOString()};history.works.push(work);}activeWork=work;return work;}
  async function ensureVersion(work,chapter){let saved=work.chapters.find(item=>item.chapterId===chapter.id);if(!saved){saved={chapterId:chapter.id,title:chapter.title,platform:chapter.platform,source:chapter.source||null,activeVersionId:null,versions:[]};work.chapters.push(saved);}saved.title=chapter.title;saved.platform=chapter.platform;saved.source=chapter.source||null;const hash=await hashNovelContent(chapter.content||'');let version=saved.versions.find(item=>(chapter.versionId?item.versionId===chapter.versionId:item.versionNumber===Number(chapter.version||1))&&item.contentHash===hash);if(!version){version=await createChapterVersion({chapterId:chapter.id,title:chapter.title,content:chapter.content||'',parentVersionId:saved.activeVersionId,versionNumber:Math.max(Number(chapter.version)||1,Math.max(0,...saved.versions.map(item=>Number(item.versionNumber)||0))+1)});saved.versions.push(version);}saved.activeVersionId=version.versionId;return {saved,version};}
  function updateAvailability(){
    container.querySelector('[data-rewrite-generate]').disabled=generating||!canUseSuggestions();
    const disabled=generating||Boolean(drafts?.busy())||!activeBatch;
    for(const button of container.querySelectorAll('[data-rewrite-accept-all],[data-rewrite-restore-all],[data-accept-chapter],[data-restore-chapter],[data-rewrite-decision]'))button.disabled=disabled||button.dataset.invalid==='true';
  }
  function renderProposals(){
    updateAvailability();
    const proposals=activeBatch?.proposals||[];proposalList.replaceChildren();
    if(!proposals.length){proposalList.innerHTML='<p class="text-empty is-small">尚未生成改写建议。</p>';return;}
    const grouped=new Map();for(const item of proposals){if(!grouped.has(item.chapterId))grouped.set(item.chapterId,[]);grouped.get(item.chapterId).push(item);}
    for(const [chapterId,items] of grouped){const section=document.createElement('section');section.className='novel-rewrite-chapter';section.innerHTML=`<header><div><strong>${escapeHtml(items[0].chapter)}</strong><small>${items.filter(item=>item.accepted).length} / ${items.length} 条已接受</small></div><div><button type="button" class="text-secondary" data-accept-chapter="${escapeHtml(chapterId)}">接受本章全部</button><button type="button" class="text-secondary" data-restore-chapter="${escapeHtml(chapterId)}">恢复本章全部</button></div></header>`;for(const item of items){const article=document.createElement('article');article.className=`novel-rewrite-proposal is-${item.decision||'pending'}${item.valid?'':' is-invalid'}`;article.dataset.proposalId=item.proposalId;article.innerHTML=`<div class="novel-rewrite-compare"><div><em>修改前</em><p>${escapeHtml(item.before)}</p></div><div><em>修改后</em><p>${escapeHtml(item.after)}</p></div></div><p class="novel-rewrite-reason">${escapeHtml(item.conflict?'对应文字已手动修改，已保留编辑稿，请在左侧处理。':item.valid?item.reason:item.invalidReason)}</p><div class="novel-rewrite-decision"><span>${item.decision==='accepted'?'已接受':item.decision==='rejected'?'已拒绝':item.valid?'待处理':'不可应用'}</span><button type="button" data-rewrite-decision="accepted" data-invalid="${!item.valid}" ${item.valid?'':'disabled'}>接受</button><button type="button" data-rewrite-decision="rejected" data-invalid="${!item.valid}" ${item.valid?'':'disabled'}>拒绝</button><button type="button" data-rewrite-decision="pending" data-invalid="${!item.valid}" ${item.valid?'':'disabled'}>恢复</button></div>`;section.append(article);}proposalList.append(section);}
    updateAvailability();
  }
  function renderHistory(){historyList.replaceChildren();if(!activeWork){historyList.innerHTML='<p class="text-empty is-small">当前页面还没有小说版本记录。</p>';return;}for(const chapter of activeWork.chapters){const block=document.createElement('section');block.className='novel-version-chapter';block.innerHTML=`<header><strong>${escapeHtml(chapter.title)}</strong><small>${chapter.versions.length} 个版本</small></header>`;for(const version of [...chapter.versions].reverse()){const run=chapterRun(activeWork,version.versionId),row=document.createElement('article');row.className=version.versionId===chapter.activeVersionId?'is-current':'';row.innerHTML=`<div><strong>v${version.versionNumber}${version.parentVersionId?' · 修改版':' · 原版'}</strong><small>${run?`本章AI分 ${scoreText(run,chapter.chapterId)} · ${new Date(run.createdAt).toLocaleString()}`:'待检测'}${version.versionId===chapter.activeVersionId?' · 当前版本':''}</small></div><div><button type="button" class="text-secondary" data-download-version="${escapeHtml(version.versionId)}" data-download-chapter="${escapeHtml(chapter.chapterId)}">下载章节</button>${run?`<button type="button" class="text-secondary" data-view-run="${escapeHtml(run.runId)}" data-view-chapter="${escapeHtml(chapter.chapterId)}">查看结果/报告</button>`:''}</div>`;block.append(row);}historyList.append(block);}}
  async function captureDetection({workTitle,detectedChapters,result,reportMeta}){if(!result?.aiRisk)return;const work=ensureWork(workTitle),versionIds={};for(const chapter of detectedChapters){const {version}=await ensureVersion(work,chapter);versionIds[chapter.id]=version.versionId;}const run={runId:globalThis.crypto?.randomUUID?.()||`run-${Date.now()}`,versionIds,result:clone(result),reportMeta:clone(reportMeta),createdAt:new Date().toISOString()};work.runs.push(run);work.updatedAt=run.createdAt;if(!panel.hasAttribute('data-merged'))panel.hidden=false;await persist();renderHistory();}
  async function generate(){if(!canUseSuggestions()){message('正文已修改或正在检测，请先完成本次检测后生成建议。','is-warning');return;}const workTitle=getWorkTitle().trim();if(!workTitle){message('请先填写作品名称。','is-warning');return;}const selected=chapters.filter(item=>item.selected),work=workByTitle(history,workTitle);if(!selected.length||!work){message('请先完成所选章节的AI检测。','is-warning');return;}const requestChapters=[];for(const chapter of selected){const saved=work.chapters.find(item=>item.chapterId===chapter.id),version=saved&&currentVersion(saved),run=version&&chapterRun(work,version.versionId);if(!version||version.versionNumber!==Number(chapter.version||1)||!run?.result?.aiRisk||await hashNovelContent(chapter.content||'')!==version.contentHash){message(`章节“${chapter.title}”正文或检测结果已变化，请先重新检测。`,'is-warning');return;}const scoped=selectNovelChapterResult(run.result.aiRisk,chapter.id,{allowSingleChapter:Object.keys(run.versionIds||{}).length===1});if(!scoped){message(`章节“${chapter.title}”没有独立检测结果，请重新检测。`,'is-warning');return;}const fragments=(scoped.fragments||[]).filter(item=>['ai','suspected-ai'].includes(item.label));if(!fragments.length)continue;requestChapters.push({localId:chapter.id,title:chapter.title,version:version.versionNumber,content:version.content,contentHash:version.contentHash,fragments:fragments.map(item=>({fragmentId:item.fragmentId,start:item.start,end:item.end,text:item.text,label:item.label}))});}if(!requestChapters.length){message('所选章节没有AI或疑似AI片段可改写。','is-warning');return;}const generation=++requestGeneration,button=container.querySelector('[data-rewrite-generate]');generating=true;button.disabled=true;activeBatch=null;sessions.clear();renderProposals();message('正在生成小说化改写建议…');try{const response=await apiInvoke({action:'rewrite',work:{title:workTitle},chapters:requestChapters});if(generation!==requestGeneration)return;if(!canUseSuggestions())throw new Error('正文已修改，请重新检测后生成建议。');const parentByChapter=new Map(requestChapters.map(item=>{const saved=work.chapters.find(chapter=>chapter.chapterId===item.localId);return[item.localId,saved.versions.find(version=>version.versionNumber===item.version&&version.contentHash===item.contentHash)];}));if(requestChapters.some(item=>{const saved=work.chapters.find(chapter=>chapter.chapterId===item.localId);return saved.activeVersionId!==parentByChapter.get(item.localId)?.versionId;}))throw new Error('章节版本已经变化，请重新生成建议。');const proposals=response.proposals.map(item=>({...item,parentVersionId:parentByChapter.get(item.chapterId).versionId,decision:'pending',accepted:false}));const checked=[];for(const [chapterId] of new Map(requestChapters.map(item=>[item.localId,[]]))){const source=parentByChapter.get(chapterId).content;checked.push(...inspectRewriteProposals(source,proposals.filter(item=>item.chapterId===chapterId)));}activeBatch={batchId:globalThis.crypto?.randomUUID?.()||`batch-${Date.now()}`,workId:work.workId,proposals:checked,createdAt:new Date().toISOString(),notice:response.notice};work.batches.push(activeBatch);for(const [chapterId,parent] of parentByChapter)sessions.set(chapterId,createRewriteDraftSession(parent.content,checked.filter(item=>item.chapterId===chapterId),{maxLength:drafts?.maxLength}));await persist();renderProposals();message('建议已生成，请逐条核对。','is-success');}catch(error){if(generation===requestGeneration)message(error.message||'改写建议生成失败。','is-warning');}finally{if(generation===requestGeneration){generating=false;renderProposals();}}}
  function syncSessions(){
    let changed=false;
    for(const [chapterId,session] of sessions){
      const content=drafts?.content(chapterId);
      if(content!=null)session.sync(content);
      const values=new Map(session.values().map(item=>[item.proposalId,item]));
      for(const item of activeBatch?.proposals||[]){const value=values.get(item.proposalId);if(value){changed ||= item.decision!==value.decision||item.accepted!==value.accepted||Boolean(item.conflict)!==value.conflict;Object.assign(item,{decision:value.decision,accepted:value.accepted,conflict:value.conflict});}}
    }
    return changed;
  }
  function setDecision(predicate,decision){
    if(!activeBatch||drafts?.busy()||generating)return;
    syncSessions();let conflicts=0,changed=false;
    try{
      for(const [chapterId,session] of sessions){
        const result=session.decide(predicate,decision);conflicts+=result.conflicts.length;
        if(result.content!==drafts.content(chapterId)){drafts.set(chapterId,result.content);changed=true;}
      }
      syncSessions();renderProposals();persist();
      if(changed)onDraftApplied();
      message(conflicts?`已同步可应用的建议；${conflicts} 条涉及手动编辑，已保留，请在左侧处理。`:decision==='accepted'?'已接受，修改已同步到左侧正文；点击开始检测可保存并复检。':decision==='pending'?'已恢复建议对应的原文，手动编辑已保留。':'已拒绝，正文已同步。',conflicts?'is-warning':'is-success');
    }catch(error){syncSessions();renderProposals();message(error.message,'is-warning');}
  }
  // 开始检测时才提交草稿为不可变版本；失败重试复用同一稿次。
  async function prepareDetection({workTitle,documents,isCurrent=()=>true}){
    const assertCurrent=()=>{if(!isCurrent())throw new Error('材料已变化，本次检测准备已取消。');};
    assertCurrent();
    syncSessions();
    const changed=documents.filter(doc=>chapters.find(chapter=>chapter.id===doc.id)?.content!==doc.content);
    if(!changed.length)return [];
    const work=ensureWork(workTitle),created=[];
    for(const doc of changed){
      const live=clone(chapters.find(chapter=>chapter.id===doc.id));
      if(!live)throw new Error('章节列表已变化，请重新选择章节检测。');
      const {saved,version:parent}=await ensureVersion(work,live);
      assertCurrent();
      const version=await createChapterVersion({chapterId:doc.id,title:live.title,content:doc.content,parentVersionId:parent.versionId,versionNumber:Math.max(...saved.versions.map(item=>item.versionNumber))+1,acceptedProposalIds:sessions.get(doc.id)?.acceptedIds()||[]});
      assertCurrent();
      created.push({chapterId:doc.id,saved,version});
    }
    for(const {saved,version} of created){saved.versions.push(version);saved.activeVersionId=version.versionId;}
    if(activeBatch)activeBatch.applied=true;
    persist();renderHistory();
    return created.map(({chapterId,version})=>({chapterId,content:version.content,versionNumber:version.versionNumber,versionId:version.versionId}));
  }
  function showSnapshot(run,chapterId){
    if(!canOpenSnapshot()){message('当前有未检测的编辑稿，请先开始检测或撤销编辑，再查看历史结果。','is-warning');return;}
    requestGeneration++;generating=false;activeBatch=null;sessions.clear();renderProposals();
    const snapshot=clone(run);
    snapshot.selectedChapterId=chapterId;
    snapshot.sourceChapters=Object.entries(run.versionIds||{}).flatMap(([chapterId,versionId])=>{
      const saved=activeWork.chapters.find(item=>item.chapterId===chapterId),version=saved?.versions.find(item=>item.versionId===versionId);
      return version?[{id:chapterId,title:version.title,content:version.content,platform:saved.platform}]:[];
    });
    onShowSnapshot(snapshot);
  }
  proposalList.addEventListener('click',event=>{const restore=event.target.closest('[data-restore-chapter]');if(restore){setDecision(item=>item.chapterId===restore.dataset.restoreChapter,'pending');return;}const chapterButton=event.target.closest('[data-accept-chapter]');if(chapterButton){setDecision(item=>item.chapterId===chapterButton.dataset.acceptChapter,'accepted');return;}const decision=event.target.closest('[data-rewrite-decision]'),article=event.target.closest('[data-proposal-id]');if(decision&&article)setDecision(item=>item.proposalId===article.dataset.proposalId,decision.dataset.rewriteDecision);});
  historyList.addEventListener('click',event=>{const download=event.target.closest('[data-download-version]');if(download&&activeWork){const chapter=activeWork.chapters.find(item=>item.chapterId===download.dataset.downloadChapter),version=chapter?.versions.find(item=>item.versionId===download.dataset.downloadVersion);if(version){const file=chapterTextDownload({workTitle:activeWork.workTitle,chapterTitle:chapter.title,versionNumber:version.versionNumber,content:version.content});message(`已下载：${saveBlob(file)}`,'is-success');}return;}const view=event.target.closest('[data-view-run]');if(view&&activeWork){const run=activeWork.runs.find(item=>item.runId===view.dataset.viewRun);if(run)showSnapshot(run,view.dataset.viewChapter);}});
  container.querySelector('[data-rewrite-generate]').addEventListener('click',generate);
  container.querySelector('[data-rewrite-accept-all]').addEventListener('click',()=>setDecision(()=>true,'accepted'));
  container.querySelector('[data-rewrite-restore-all]').addEventListener('click',()=>setDecision(()=>true,'pending'));
  return {captureDetection,prepareDetection,refresh(){if(syncSessions())renderProposals();else updateAvailability();},invalidateSuggestions(){requestGeneration++;generating=false;activeBatch=null;sessions.clear();renderProposals();},async restore(){try{history=await store.load();activeWork=history.works.at(-1)||null;if(activeWork){if(!panel.hasAttribute('data-merged'))panel.hidden=false;activeBatch=activeWork.batches?.at(-1)||null;const restored=activeWork.chapters.map(saved=>{const version=currentVersion(saved);return{id:saved.chapterId,title:saved.title,content:version?.content||'',platform:saved.platform||'unknown',source:saved.source||null,file:null,version:version?.versionNumber||1,status:chapterRun(activeWork,version?.versionId)?'已检测':'待检测',selected:true};});onRestore({workTitle:activeWork.workTitle,chapters:restored});}renderProposals();renderHistory();}catch(error){message(`${error.message} 已忽略损坏的本地历史。`,'is-warning');history={schemaVersion:1,works:[],updatedAt:null};renderHistory();}},show(){if(activeWork&&!panel.hasAttribute('data-merged'))panel.hidden=false;}};
}
