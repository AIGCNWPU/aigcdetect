import { createResultRetry } from '../result-retry.js';
import { readChapterDocument } from '../chapter-document.js';
import { createAiScoringSegments } from '../ai-segmentation.js';
import { createReviewWorkspace } from '../review-workspace.js';
import { createReviewDrafts } from '../review-model.js';
import { selectNovelChapterResult } from '../novel-rewrite.js';
import { NOVEL_PLATFORMS, matchNovelPlatformUrl, normalizeNovelPlatform } from '../novel-platforms.js';
import { createNovelRewriteController } from '../novel-rewrite-view.js';
import { mergeIndependentResultServices, renderAiOverview, renderAiNotice, renderIssueFindings, renderNovelPlatformPolicies, renderResultCompletion, runIndependentResultServices, setResultServiceState, setupAiSentenceFilter, setupResultServiceTabs } from '../result-render.js';

export function validateNovelChapter({workTitle,chapterTitle,content}){
  if(!workTitle?.trim())return '请填写作品名称。';
  if(!chapterTitle?.trim())return '请填写章节名称。';
  if(!content?.trim())return '请粘贴章节正文或先读取章节文档。';
  return '';
}
export function validateNovelUrl(value){
  try{const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error();}
  catch{return '请输入有效且不含账号信息的 http 或 https 章节链接。';}
  return '';
}

export function resolveImportedWorkTitle(currentWorkTitle,importedWorkTitle){
  return importedWorkTitle?.trim()||currentWorkTitle?.trim()||'';
}

export function createConfirmedNovelImport(result,{workTitle=result?.workTitle,title=result?.title,content=result?.content}={}){
  const confirmedWorkTitle=workTitle?.trim()||'',confirmedTitle=title?.trim(),confirmedContent=content?.trim();
  if(!result||!confirmedTitle||!confirmedContent)throw new Error('提取预览需要包含章节标题和可读正文。');
  return {workTitle:confirmedWorkTitle,title:confirmedTitle,content:confirmedContent,source:{url:result.sourceUrl,finalUrl:result.finalUrl,site:result.site,extractionStatus:result.extractionStatus,completeness:result.completeness,...(result.extractionMethod?{extractionMethod:result.extractionMethod}:{}),notice:result.notice,confirmedAt:new Date().toISOString(),userEdited:confirmedWorkTitle!==(result.workTitle?.trim()||'')||confirmedTitle!==result.title.trim()||confirmedContent!==result.content.trim()}};
}

export function createNovelDetectionPayload({workTitle,chapters,checks}){
  return {action:'analyze',work:{title:workTitle,language:'zh'},chapters:chapters.map(item=>({localId:item.id,title:item.title,version:item.version,content:item.content||undefined,platform:normalizeNovelPlatform(item.platform||item.source?.site).id,language:'zh',aiSegments:checks.includes('ai-risk')?createAiScoringSegments(item.content||'',{prefix:`c${item.id}-s`,mergeSingleSentenceParagraphs:true}):undefined,file:item.file||undefined,source:item.source||undefined})),checks:[...checks]};
}

function apiError(error){
  if(error?.status===501||error?.code==='NOT_IMPLEMENTED')return '检测服务尚未接入，章节内容仍保留在当前页面。';
  if(error?.name==='AbortError')return '本次检测已取消。';
  return error?.message||'提交失败，请稍后重试。';
}

function importError(error){
  if(error?.code==='CONTENT_OBFUSCATED')return '页面正文使用动态字体混淆，无法可靠还原；未导入乱码，请改用粘贴正文。';
  if(error?.code==='ACCESS_RESTRICTED')return error.message||'页面要求登录、付费或验证，无法读取公开正文。';
  if(error?.code==='PRIVATE_ADDRESS')return '出于安全限制，不能访问本机、内网或其他非公开地址。';
  if(error?.code==='FETCH_TIMEOUT')return '获取网页超时，可重试或改用粘贴正文。';
  return error?.message||'正文提取失败，可重试或改用粘贴正文。';
}

export function renderTextNovel(container){
  let aiReview=null,reviewSourceDocuments=[];
  container.classList.add('text-workspace','novel-workspace');
  container.innerHTML=`
    <header class="text-workspace-head"><div><p>网文 · 小说内容</p><h2>作品与章节工作台</h2><span>按章节管理材料，分别展示AI来源风险、重复叙述和疑似水稿线索。</span></div><output class="text-version" data-work-state>0 个章节 · 本地草稿</output></header>
    <div class="text-tabs" role="tablist" aria-label="小说工作区"><button type="button" role="tab" aria-selected="true" data-tab="chapters">作品与章节</button><button type="button" role="tab" aria-selected="false" data-tab="detection">章节检测</button><button type="button" role="tab" aria-selected="false" data-tab="report">作品报告</button></div>
    <section class="text-panel" role="tabpanel" data-panel="chapters">
      <div class="novel-layout"><form class="text-card text-chapter-form" novalidate><div class="text-card-title"><span>01</span><div><h3>章节材料</h3><p>粘贴正文或选择文档</p></div></div>
        <label class="text-field">作品名称 <span aria-hidden="true">*</span><input name="workTitle" maxlength="120" placeholder="填写作品名称"></label>
        <label class="text-field novel-platform-select">发布平台<select name="platform" aria-label="发布平台">${NOVEL_PLATFORMS.map(platform=>`<option value="${platform.id}"${platform.id==='unknown'?' selected':''}>${platform.name}</option>`).join('')}</select></label><p class="text-help">章节链接会自动匹配平台，无法识别时选择未知平台。</p>
        <section class="novel-import-panel" aria-labelledby="novel-import-title"><div class="novel-import-heading"><div><strong id="novel-import-title">从章节网页导入</strong><p>仅获取公开可读的单章节正文页，不绕过登录、付费或验证限制。</p></div><span class="text-status is-idle" data-import-status>未提取</span></div>
          <div class="novel-import-row"><label class="text-field">章节链接<input name="importUrl" type="url" maxlength="2000" placeholder="https://example.com/chapter/1"></label><button type="button" class="text-secondary" data-import-fetch>提取正文</button></div>
          <p class="text-operation-message" data-import-message role="status"></p>
          <div class="novel-import-preview" data-import-preview hidden><p class="novel-import-meta" data-import-meta></p><label class="text-field">提取作品名称<input name="importWorkTitle" maxlength="120" placeholder="未可靠识别时可手动填写"></label><label class="text-field">提取章节标题<input name="importTitle" maxlength="120"></label><label class="text-field">提取正文<textarea name="importContent" rows="9" maxlength="100000"></textarea></label><p class="text-help" data-import-notice></p><label class="novel-overwrite" data-import-overwrite hidden><input type="checkbox" name="confirmOverwrite"><span>当前章节表单已有内容，确认用此预览覆盖标题和正文</span></label><div class="text-inline-actions"><button type="button" class="text-primary" data-import-confirm>确认填入章节表单</button></div></div>
        </section>
        <label class="text-field">章节名称 <span aria-hidden="true">*</span><input name="chapterTitle" maxlength="120" placeholder="例如：第一章 初遇"></label>
        <label class="text-field">章节正文<textarea name="content" rows="12" maxlength="100000" placeholder="在此粘贴章节正文"></textarea></label><p class="text-field-meta"><span>正文只保留在当前页面，提交检测时发送</span><output data-count>0 / 100,000 字</output></p>
        <input type="file" name="document" hidden accept=".txt,.md,.docx,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document"><button type="button" class="text-upload is-compact novel-document-picker" data-document-pick><strong>选择章节文档</strong><span data-file-name>TXT、MD、DOCX</span></button><p class="text-help" data-document-status role="status">选择文档后读取正文，请核对后添加章节。旧版 DOC 请先另存为 DOCX 或 TXT。</p>
        <p data-form-error role="alert"></p><div class="text-inline-actions"><button type="button" class="text-secondary" data-cancel-edit hidden>取消编辑</button><button type="submit" class="text-primary" data-save>添加章节</button></div>
      </form>
      <section class="text-card novel-chapter-card"><div class="text-card-title"><span>02</span><div><h3>章节列表</h3><p>勾选需要检测的单章或多章</p></div></div><div class="text-empty is-small" data-chapter-empty><strong>还没有章节</strong><p>添加章节后，可在右侧列表选择、编辑或删除。</p></div><ol class="novel-chapter-list" data-chapter-list></ol></section></div>
    </section>
    <section class="text-panel" role="tabpanel" data-panel="detection" hidden>
      <div class="text-result-head"><div><p>检测范围</p><h3 data-selection-title>尚未选择章节</h3></div><span class="text-status is-idle" data-result-status>未检测</span></div><p class="text-result-completion" data-result-completion hidden></p>
      <div class="text-detect-actions"><div><p>检测项目（至少选择一项）</p><div class="text-check-list novel-check-list"><label><input type="checkbox" name="checks" value="ai-risk" checked><span><strong>章节疑似AI风险</strong><small>定位疑似AI片段，展示得分与分类</small></span></label><label><input type="checkbox" name="checks" value="quality" checked><span><strong>重复与水稿线索</strong></span></label></div></div><button type="button" class="text-primary" data-detect>检测已选章节</button></div>
      <p class="text-operation-message" data-operation-message role="alert"></p>
      <div class="result-service-tabs" role="tablist" aria-label="检测结果类型" data-result-service-tabs hidden><button type="button" role="tab" aria-selected="true" data-result-service-tab="ai-risk">AI内容分析</button><button type="button" role="tab" aria-selected="false" data-result-service-tab="quality">重复与水稿</button></div>
      <div class="novel-result-chapter-tabs" role="tablist" aria-label="章节结果范围" data-result-chapter-tabs hidden></div>
      <div class="text-result-grid"><article class="text-result-card" data-result-ai data-result-service-panel="ai-risk"><span>章节句级疑似AI检测</span><div class="result-service-progress" data-service-progress hidden aria-live="polite"><i aria-hidden="true"></i><span></span></div><strong data-ai-summary>等待检测结果</strong><p data-ai-notice hidden></p><aside class="novel-platform-policies" data-platform-policies-ai hidden></aside><div class="ai-overview" data-ai-overview hidden></div><div class="ai-result-filter" data-ai-filter><div role="group" aria-label="句级结果筛选"><button type="button" data-ai-filter-value="all" aria-pressed="true">全部显示</button><button type="button" data-ai-filter-value="suspected" aria-pressed="false">仅疑似AI</button></div><output data-ai-filter-count aria-live="polite">显示 0 / 0 个片段</output></div><ul data-ai-findings></ul></article><article class="text-result-card" data-result-quality data-result-service-panel="quality"><span>重复与水稿线索</span><div class="result-service-progress" data-service-progress hidden aria-live="polite"><i aria-hidden="true"></i><span></span></div><strong data-quality-summary>等待检测结果</strong><p>每条问题均附可回查的章节原文。</p><aside class="novel-platform-policies" data-platform-policies-quality hidden></aside><ul data-quality-findings></ul></article></div>
      <section class="novel-rewrite" data-rewrite-panel hidden><header class="novel-rewrite-heading"><div><span>检测后改写</span><h3>降低AI风险建议</h3><p>针对本次AI或疑似AI片段生成建议，支持逐条接受或手动编辑。</p></div><button type="button" class="text-primary" data-rewrite-generate>生成改写建议</button></header><p class="text-operation-message" data-rewrite-status role="status"></p><div class="novel-rewrite-toolbar"><button type="button" class="text-secondary" data-rewrite-accept-all>接受全部选中章节</button><button type="button" class="text-secondary" data-rewrite-restore-all>撤回全部已接受建议</button></div><div class="novel-rewrite-proposals" data-rewrite-proposals></div><section class="novel-version-history"><header><div><h3>浏览器内版本与报告</h3><p>原版和修改版仅保留在当前页面，刷新后清空；可查看本次旧结果、重新导出报告或下载章节。</p></div></header><div data-rewrite-history></div></section></section>
      <div class="text-empty" data-result-empty><strong>还没有检测记录</strong><p>先添加并勾选章节，再开始检测。</p></div>
    </section>
    <section class="text-panel" role="tabpanel" data-panel="report" hidden><div class="text-history-head"><div><h3>作品检测汇总</h3><p>AI内容分析与重复/水稿检测分别导出为适合A4打印的PDF报告。</p></div><div class="text-inline-actions"><button type="button" class="text-secondary" data-export-ai disabled>导出AI分析PDF</button><button type="button" class="text-secondary" data-export-secondary disabled>导出水稿检测PDF</button></div></div><p class="text-operation-message" data-export-message role="alert"></p><div class="text-empty" data-report-empty><strong>暂无可汇总结果</strong><p>完成至少一次真实检测后才可导出报告。</p></div><div class="novel-report" data-report hidden></div></section>`;
  const form=container.querySelector('form'),list=container.querySelector('[data-chapter-list]'),formError=container.querySelector('[data-form-error]'),resultStatus=container.querySelector('[data-result-status]'),completion=container.querySelector('[data-result-completion]'),exportAi=container.querySelector('[data-export-ai]'),exportSecondary=container.querySelector('[data-export-secondary]'),exportMessage=container.querySelector('[data-export-message]'),aiSentenceView=setupAiSentenceFilter(container,{onRender:values=>aiReview?.render({values,documents:reviewSourceDocuments,chapterId:activeResultChapter})}),resultServiceTabs=setupResultServiceTabs(container),chapterResultTabs=container.querySelector('[data-result-chapter-tabs]');
  const importPreview=container.querySelector('[data-import-preview]'),importStatus=container.querySelector('[data-import-status]'),importMessage=container.querySelector('[data-import-message]'),importFetch=container.querySelector('[data-import-fetch]');
  const drafts=createReviewDrafts();
  aiReview=createReviewWorkspace({list:container.querySelector('[data-ai-findings]'),kind:'ai',paragraphChars:900,onSelectChapter:selectResultChapter,drafts,onDetect:detectEdited});
  const qualityReview=createReviewWorkspace({list:container.querySelector('[data-quality-findings]'),kind:'quality',paragraphChars:900,onSelectChapter:selectResultChapter,drafts,onDetect:detectEdited});
  const rewritePanel=container.querySelector('[data-rewrite-panel]'),versionHistory=container.querySelector('.novel-version-history');
  rewritePanel.before(versionHistory);
  const resultModes=aiReview.mergePanel(rewritePanel);
  container.querySelector('.text-result-grid').hidden=true;
  const chapters=[];let editId=null,currentResult=null,currentReportMeta=null,nextId=1,importDraft=null,pendingSource=null,resultChapters=[],activeResultChapter='all',detectionGeneration=0,isDetecting=false;
  const selectTab=name=>{for(const button of container.querySelectorAll('[data-tab]'))button.setAttribute('aria-selected',String(button.dataset.tab===name));for(const panel of container.querySelectorAll('[data-panel]'))panel.hidden=panel.dataset.panel!==name;};
  const setPlatform=value=>{form.elements.platform.value=normalizeNovelPlatform(value).id;};
  container.querySelector('.text-tabs').addEventListener('click',event=>{const button=event.target.closest('[data-tab]');if(button)selectTab(button.dataset.tab);});
  function resetImport({clearUrl=true}={}){importDraft=null;importPreview.hidden=true;form.elements.importWorkTitle.value='';form.elements.importTitle.value='';form.elements.importContent.value='';form.elements.confirmOverwrite.checked=false;container.querySelector('[data-import-overwrite]').hidden=true;importStatus.textContent='未提取';importStatus.className='text-status is-idle';importMessage.textContent='';if(clearUrl)form.elements.importUrl.value='';}
  form.elements.importUrl.addEventListener('input',()=>setPlatform(matchNovelPlatformUrl(form.elements.importUrl.value).id));
  importFetch.addEventListener('click',async()=>{
    const url=form.elements.importUrl.value.trim(),problem=validateNovelUrl(url);if(problem){importMessage.textContent=problem;return;}
    importDraft=null;importPreview.hidden=true;form.elements.confirmOverwrite.checked=false;container.querySelector('[data-import-overwrite]').hidden=true;importFetch.disabled=true;importFetch.textContent='正在提取…';importStatus.textContent='处理中';importStatus.className='text-status is-running';importMessage.textContent='';
    try{
      const result=await globalThis.Veritas.api.importNovelChapter(url);importDraft=result;const importedPlatform=normalizeNovelPlatform(result.site).id==='unknown'?matchNovelPlatformUrl(result.finalUrl):normalizeNovelPlatform(result.site);setPlatform(importedPlatform.id);form.elements.importWorkTitle.value=result.workTitle||'';form.elements.importTitle.value=result.title;form.elements.importContent.value=result.content;container.querySelector('[data-import-meta]').textContent=`${importedPlatform.name} · ${result.content.length.toLocaleString()} 字 · 来源：${result.finalUrl}`;container.querySelector('[data-import-notice]').textContent=result.notice;importStatus.textContent=result.extractionStatus==='partial'?'仅可读部分':result.completeness==='complete'?'已提取':'完整性待确认';importStatus.className=`text-status ${result.extractionStatus==='partial'||result.completeness!=='complete'?'is-warning':'is-success'}`;importPreview.hidden=false;form.elements.confirmOverwrite.checked=false;container.querySelector('[data-import-overwrite]').hidden=true;
    }catch(error){importStatus.textContent=error?.details?.extractionStatus==='restricted'?'读取受限':'提取失败';importStatus.className='text-status is-error';importMessage.textContent=importError(error);}
    finally{importFetch.disabled=false;importFetch.textContent='提取正文';}
  });
  container.querySelector('[data-import-confirm]').addEventListener('click',()=>{
    if(!importDraft){importMessage.textContent='请先提取章节正文。';return;}
    const hasExisting=Boolean(form.elements.chapterTitle.value.trim()||form.elements.content.value.trim());
    if(hasExisting&&!form.elements.confirmOverwrite.checked){container.querySelector('[data-import-overwrite]').hidden=false;importMessage.textContent='章节表单已有内容，请勾选覆盖确认后再填入。';return;}
    try{const confirmed=createConfirmedNovelImport(importDraft,{workTitle:form.elements.importWorkTitle.value,title:form.elements.importTitle.value,content:form.elements.importContent.value});const previousWorkTitle=form.elements.workTitle.value.trim(),nextWorkTitle=resolveImportedWorkTitle(previousWorkTitle,confirmed.workTitle);if(nextWorkTitle!==previousWorkTitle){form.elements.workTitle.value=nextWorkTitle;invalidate();}form.elements.chapterTitle.value=confirmed.title;form.elements.content.value=confirmed.content;pendingSource=confirmed.source;container.querySelector('[data-count]').textContent=`${confirmed.content.length.toLocaleString()} / 100,000 字`;importMessage.textContent=confirmed.source.completeness==='complete'?'导入内容已填入表单，请继续核对后添加章节。':'已填入导入内容；完整性待确认，后续仅检测已导入内容。';}
    catch(error){importMessage.textContent=error.message;}
  });
  form.elements.content.addEventListener('input',()=>{container.querySelector('[data-count]').textContent=`${form.elements.content.value.length.toLocaleString()} / 100,000 字`;if(pendingSource)pendingSource={...pendingSource,userEdited:true};});
  form.elements.chapterTitle.addEventListener('input',()=>{if(pendingSource)pendingSource={...pendingSource,userEdited:true};});
  let documentGeneration=0,documentBusy=false;
  const documentPick=container.querySelector('[data-document-pick]'),documentStatus=container.querySelector('[data-document-status]');
  documentPick.addEventListener('click',()=>{form.elements.document.value='';form.elements.document.click();});
  form.elements.document.addEventListener('change',async()=>{
    const file=form.elements.document.files[0];if(!file)return;
    const generation=++documentGeneration,previousContent=form.elements.content.value,previousTitle=form.elements.chapterTitle.value;
    documentBusy=true;documentPick.disabled=true;container.querySelector('[data-save]').disabled=true;documentStatus.textContent='正在读取文档…';formError.textContent='';
    try{
      const content=await readChapterDocument(file);
      if(generation!==documentGeneration)return;
      if(form.elements.content.value!==previousContent||form.elements.chapterTitle.value!==previousTitle)throw new Error('读取期间正文已编辑，未覆盖当前内容，请重新选择文档。');
      if(previousContent.trim()&&!globalThis.confirm('读取文档会替换当前章节正文，是否继续？')){documentStatus.textContent='已取消替换，原正文已保留。';return;}
      form.elements.content.value=content;
      if(!previousTitle.trim())form.elements.chapterTitle.value=file.name.replace(/\.[^.]+$/,'').slice(0,120);
      pendingSource=null;container.querySelector('[data-count]').textContent=`${content.length.toLocaleString()} / 100,000 字`;container.querySelector('[data-file-name]').textContent=file.name;documentStatus.textContent='正文已读取，请核对后添加章节。';
    }catch(error){if(generation===documentGeneration){formError.textContent=error.message||'文档读取失败，请重试或粘贴正文。';documentStatus.textContent='未替换当前正文。';}}
    finally{if(generation===documentGeneration){documentBusy=false;documentPick.disabled=false;container.querySelector('[data-save]').disabled=false;form.elements.document.value='';}}
  });
  const selected=()=>chapters.filter(chapter=>chapter.selected);
  const retry=createResultRetry({container,drafts,errorMessage:apiError,valid:()=>!drafts.changed(),onBusy:value=>{isDetecting=value;container.querySelector('[data-detect]').disabled=value;}});
  function invalidate(){retry.clear();if(!currentResult&&!isDetecting&&!drafts.documents().length)return;drafts.setBusy(false);drafts.reset();detectionGeneration+=1;isDetecting=false;rewriteController.invalidateSuggestions();aiReview.reset();qualityReview.reset();reviewSourceDocuments=[];currentResult=null;currentReportMeta=null;resultChapters=[];activeResultChapter='all';chapterResultTabs.hidden=true;chapterResultTabs.replaceChildren();completion.hidden=true;resultStatus.textContent='材料或检测项目已更新';resultStatus.className='text-status is-warning';container.querySelector('.text-result-grid').hidden=true;resultServiceTabs.show([]);container.querySelector('[data-result-empty] strong').textContent='请重新检测';container.querySelector('[data-result-empty] p').textContent='当前章节或检测项目已更新，旧结果不适用于本次选择。';container.querySelector('[data-result-empty]').hidden=false;exportAi.disabled=true;exportSecondary.disabled=true;exportMessage.textContent='';container.querySelector('[data-report]').hidden=true;container.querySelector('[data-report-empty]').hidden=false;const detectButton=container.querySelector('[data-detect]');detectButton.disabled=false;detectButton.textContent='检测已选章节';container.querySelectorAll('[name=checks]').forEach(input=>input.disabled=input.dataset.unavailable==='true');}
  const scopedResult=value=>activeResultChapter==='all'?value:selectNovelChapterResult(value,activeResultChapter,{allowSingleChapter:resultChapters.length===1})||{summary:'本章没有返回独立检测结果，请重新检测。',notice:'未使用其他章节或全文结果代替本章结果。',findings:[],fragments:[]};
  function renderCurrentResult(){
    if(currentResult?.aiRisk){const value=scopedResult(currentResult.aiRisk);container.querySelector('[data-ai-summary]').textContent=activeResultChapter==='all'?value.summary:String(value.summary||'').replace('全文','本章');renderAiNotice(container.querySelector('[data-ai-notice]'));renderNovelPlatformPolicies(container.querySelector('[data-platform-policies-ai]'),value.platformPolicies||[]);renderAiOverview(container.querySelector('[data-ai-overview]'),value?.documentScore?value:null,{chapter:activeResultChapter!=='all'});aiSentenceView.render(value.findings||[]);}
    if(currentResult?.quality){const value=scopedResult(currentResult.quality);container.querySelector('[data-quality-summary]').textContent=value.summary;renderNovelPlatformPolicies(container.querySelector('[data-platform-policies-quality]'),value.platformPolicies||[]);renderIssueFindings(container.querySelector('[data-quality-findings]'),value.findings||[],'本次未发现达到报告阈值的重复或水稿线索。');qualityReview.render({values:value.findings||[],documents:reviewSourceDocuments,chapterId:activeResultChapter});}
  }
  function renderChapterResultTabs(items){
    reviewSourceDocuments=structuredClone(items);drafts.reset(reviewSourceDocuments);aiReview.reset(reviewSourceDocuments);qualityReview.reset(reviewSourceDocuments);
    resultChapters=items.map(item=>({chapterId:item.id,chapter:item.title,platform:item.platform}));activeResultChapter='all';chapterResultTabs.replaceChildren();
    for(const item of [{chapterId:'all',chapter:'全文'},...resultChapters]){const tab=document.createElement('button');tab.type='button';tab.role='tab';tab.dataset.resultChapter=item.chapterId;tab.textContent=item.chapter;tab.setAttribute('aria-label',item.chapter);tab.setAttribute('aria-selected',String(item.chapterId===activeResultChapter));chapterResultTabs.append(tab);}
    chapterResultTabs.hidden=items.length<2;
  }
  function selectResultChapter(id){activeResultChapter=id;for(const item of chapterResultTabs.querySelectorAll('[data-result-chapter]'))item.setAttribute('aria-selected',String(item.dataset.resultChapter===id));renderCurrentResult();}
  chapterResultTabs.addEventListener('click',event=>{const tab=event.target.closest('[data-result-chapter]');if(tab)selectResultChapter(tab.dataset.resultChapter);});
  function updateSelection(){const items=selected();container.querySelector('[data-selection-title]').textContent=items.length?`已选择 ${items.length} 章：${items.map(item=>item.title).join('、')}`:'尚未选择章节';}
  function renderList(){
    list.replaceChildren();for(const chapter of chapters){const li=document.createElement('li');li.dataset.id=chapter.id;const label=document.createElement('label'),check=document.createElement('input'),body=document.createElement('span'),title=document.createElement('strong'),meta=document.createElement('small'),actions=document.createElement('span'),edit=document.createElement('button'),remove=document.createElement('button');check.type='checkbox';check.checked=chapter.selected;check.dataset.select=chapter.id;title.textContent=chapter.title;const sourceState=chapter.source?` · 网页导入：${chapter.source.completeness==='complete'?'已确认完整':chapter.source.completeness==='partial'?'仅可读部分':'完整性待确认'}`:'';meta.textContent=`${normalizeNovelPlatform(chapter.platform).name} · v${chapter.version} · ${chapter.content?`${chapter.content.length.toLocaleString()} 字`:chapter.file.name} · ${chapter.status}${sourceState}`;body.append(title,meta);label.append(check,body);edit.type=remove.type='button';edit.dataset.edit=chapter.id;remove.dataset.remove=chapter.id;edit.textContent='编辑';remove.textContent='删除';actions.className='novel-chapter-actions';actions.append(edit,remove);li.append(label,actions);list.append(li);}
    container.querySelector('[data-chapter-empty]').hidden=chapters.length>0;container.querySelector('[data-work-state]').textContent=`${chapters.length} 个章节 · 本地草稿`;updateSelection();
  }
  function resetForm(){documentGeneration++;documentBusy=false;documentPick.disabled=false;container.querySelector('[data-save]').disabled=false;documentStatus.textContent='选择文档后读取正文，请核对后添加章节。旧版 DOC 请先另存为 DOCX 或 TXT。';editId=null;pendingSource=null;form.elements.chapterTitle.value='';form.elements.content.value='';form.elements.document.value='';container.querySelector('[data-file-name]').textContent='TXT、MD、DOCX';container.querySelector('[data-count]').textContent='0 / 100,000 字';container.querySelector('[data-save]').textContent='添加章节';container.querySelector('[data-cancel-edit]').hidden=true;formError.textContent='';resetImport();}
  form.elements.workTitle.addEventListener('input',invalidate);
  form.addEventListener('submit',event=>{event.preventDefault();if(documentBusy)return;const file=form.elements.document.files[0],existing=chapters.find(item=>item.id===editId),values={workTitle:form.elements.workTitle.value,chapterTitle:form.elements.chapterTitle.value,content:form.elements.content.value,platform:normalizeNovelPlatform(form.elements.platform.value).id,file:file||existing?.file},problem=validateNovelChapter(values);if(problem){formError.textContent=problem;return;}if(existing){existing.title=values.chapterTitle.trim();existing.content=values.content;existing.platform=values.platform;existing.file=file?{name:file.name,size:file.size,type:file.type}:existing.file;existing.source=pendingSource;existing.version+=1;delete existing.versionId;existing.status='待重新检测';}else chapters.push({id:String(nextId++),title:values.chapterTitle.trim(),content:values.content,platform:values.platform,file:file?{name:file.name,size:file.size,type:file.type}:null,source:pendingSource,version:1,status:'未检测',selected:true});invalidate();renderList();resetForm();});
  container.querySelector('[data-cancel-edit]').addEventListener('click',resetForm);
  list.addEventListener('click',event=>{const button=event.target.closest('button');if(!button)return;if(button.dataset.edit){documentGeneration++;documentBusy=false;documentPick.disabled=false;container.querySelector('[data-save]').disabled=false;documentStatus.textContent='选择文档后读取正文，请核对后添加章节。';const chapter=chapters.find(item=>item.id===button.dataset.edit);editId=chapter.id;pendingSource=chapter.source?{...chapter.source}:null;resetImport();form.elements.importUrl.value=chapter.source?.url||'';setPlatform(chapter.platform||chapter.source?.site);form.elements.chapterTitle.value=chapter.title;form.elements.content.value=chapter.content;form.elements.document.value='';container.querySelector('[data-file-name]').textContent=chapter.file?.name||'TXT、MD、DOCX';container.querySelector('[data-count]').textContent=`${chapter.content.length.toLocaleString()} / 100,000 字`;container.querySelector('[data-save]').textContent='保存章节';container.querySelector('[data-cancel-edit]').hidden=false;form.elements.chapterTitle.focus();}else if(button.dataset.remove){const index=chapters.findIndex(item=>item.id===button.dataset.remove);chapters.splice(index,1);if(editId===button.dataset.remove)resetForm();invalidate();renderList();}});
  list.addEventListener('change',event=>{if(!event.target.dataset.select)return;chapters.find(item=>item.id===event.target.dataset.select).selected=event.target.checked;invalidate();updateSelection();});
  container.querySelectorAll('[name=checks]').forEach(input=>input.addEventListener('change',invalidate));
  const rewriteController=createNovelRewriteController({container,chapters,getWorkTitle:()=>form.elements.workTitle.value,apiInvoke:payload=>globalThis.Veritas.api.invoke('/text/novel',payload),canUseSuggestions:()=>Boolean(currentResult?.aiRisk)&&!drafts.changed()&&!drafts.busy(),canOpenSnapshot:()=>!drafts.changed()&&!drafts.busy(),drafts,onDraftApplied:location=>{if(location)aiReview.focusDraft(location);else aiReview.edit();},onRestore:restored=>{if(chapters.length)return;form.elements.workTitle.value=restored.workTitle;chapters.push(...restored.chapters);nextId=Math.max(0,...chapters.map(item=>Number(item.id)||0))+1;renderList();},onShowSnapshot:run=>{retry.clear();currentResult=run.result;currentReportMeta=run.reportMeta;const storedChapters=run.sourceChapters||(run.reportMeta?.chapters||[]).map(item=>({id:item.chapterId,title:item.chapter,platform:item.platform,content:item.content}));if(storedChapters.length)renderChapterResultTabs(storedChapters);container.querySelector('.text-result-grid').hidden=false;container.querySelector('[data-result-empty]').hidden=true;resultServiceTabs.show([...(currentResult.aiRisk?['ai-risk']:[]),...(currentResult.quality?['quality']:[])]);if(run.selectedChapterId)selectResultChapter(run.selectedChapterId);else renderCurrentResult();resultStatus.textContent='已加载历史结果';resultStatus.className='text-status is-success';exportAi.disabled=!currentResult?.aiRisk;exportSecondary.disabled=!currentResult?.quality;container.querySelector('[data-report-empty]').hidden=false;container.querySelector('[data-report]').hidden=true;selectTab('detection');}});
  drafts.subscribe(()=>{rewriteController.refresh();for(const tab of chapterResultTabs.querySelectorAll('[data-result-chapter]')){const id=tab.dataset.resultChapter,chapter=resultChapters.find(item=>item.chapterId===id);tab.textContent=(chapter?.chapter||'全文')+(drafts.changed(id==='all'?undefined:id)?' · 已修改':'');}});
  rewriteController.restore();
  async function detectEdited(documents){
    if(isDetecting)return;
    if(!container.querySelector('[name=checks]:checked'))throw new Error('请至少选择一个检测项目。');
    if(!documents.length||documents.some(doc=>!doc.content.trim()))throw new Error('各章节正文不能为空，请补全后开始检测。');
    const updates=documents.map(doc=>({doc,live:chapters.find(chapter=>chapter.id===doc.id)}));
    if(updates.some(item=>!item.live))throw new Error('章节列表已变化，请重新选择章节检测。');
    const workTitle=form.elements.workTitle.value.trim();
    if(!workTitle)throw new Error('请先填写作品名称。');
    const previousStatus=resultStatus.textContent;
    const preparingGeneration=++detectionGeneration;
    resultStatus.textContent='正在准备检测…';
    isDetecting=true;drafts.setBusy(true);
    try{
      const versions=await rewriteController.prepareDetection({workTitle,documents,isCurrent:()=>preparingGeneration===detectionGeneration});
      if(preparingGeneration!==detectionGeneration)return;
      for(const value of versions){
        const live=chapters.find(chapter=>chapter.id===value.chapterId);
        live.content=value.content;live.version=value.versionNumber;live.versionId=value.versionId;
        live.file=null;live.status='待检测';if(live.source)live.source={...live.source,userEdited:true};
      }
    }catch(error){if(preparingGeneration===detectionGeneration)resultStatus.textContent=previousStatus;throw error;}
    finally{if(preparingGeneration===detectionGeneration){isDetecting=false;drafts.setBusy(false);}}
    const ids=new Set(documents.map(doc=>doc.id));chapters.forEach(chapter=>chapter.selected=ids.has(chapter.id));renderList();
    await startDetection();
  }
  container.querySelector('[data-detect]').addEventListener('click',()=>{if(drafts.documents().length)detectEdited(drafts.documents()).catch(error=>container.querySelector('[data-operation-message]').textContent=error.message);else startDetection();});
  async function startDetection(){
    if(isDetecting)return;
    const button=container.querySelector('[data-detect]'),items=structuredClone(selected()),message=container.querySelector('[data-operation-message]');message.textContent='';if(!items.length){message.textContent='请先在“作品与章节”中勾选至少一个章节。';return;}const workTitle=form.elements.workTitle.value.trim();if(!workTitle){message.textContent='请先填写作品名称。';return;}const chosen=Array.from(container.querySelectorAll('[name=checks]:checked')).map(input=>input.value);if(!chosen.length){message.textContent='请至少选择一个检测项目。';return;}
    retry.clear();const generation=++detectionGeneration;isDetecting=true;drafts.setBusy(true);rewriteController.invalidateSuggestions();resultModes.show(false);
    const services=chosen.map(id=>id==='ai-risk'
      ? {id,label:'AI内容分析',resultKey:'aiRisk',run:()=>globalThis.Veritas.api.invoke('/text/novel',createNovelDetectionPayload({workTitle,chapters:items,checks:['ai-risk']}))}
      : {id,label:'重复与水稿检测',resultKey:'quality',run:()=>globalThis.Veritas.api.invoke('/text/novel',createNovelDetectionPayload({workTitle,chapters:items,checks:['repetition','padding']}))});
    const resultGrid=container.querySelector('.text-result-grid');button.disabled=true;container.querySelectorAll('[name=checks]').forEach(input=>input.disabled=true);button.textContent='正在检测…';resultStatus.textContent=`处理中 · 0/${services.length}`;resultStatus.className='text-status is-running';completion.hidden=true;resultGrid.hidden=false;resultServiceTabs.show(chosen);renderChapterResultTabs(items);container.querySelector('[data-result-empty]').hidden=true;container.querySelector('[data-report]').hidden=true;container.querySelector('[data-report-empty]').hidden=false;currentResult=null;currentReportMeta=null;exportAi.disabled=true;exportSecondary.disabled=true;exportMessage.textContent='';
    if(chosen.includes('ai-risk')){container.querySelector('[data-ai-summary]').textContent='正在调用AI文本检测服务…';renderAiNotice(container.querySelector('[data-ai-notice]'),'收到该项结果后会立即展示，无需等待重复与水稿检测。');renderNovelPlatformPolicies(container.querySelector('[data-platform-policies-ai]'),[]);renderAiOverview(container.querySelector('[data-ai-overview]'),null);aiSentenceView.render([]);}
    if(chosen.includes('quality')){container.querySelector('[data-quality-summary]').textContent='正在检测重复与水稿线索…';renderNovelPlatformPolicies(container.querySelector('[data-platform-policies-quality]'),[]);container.querySelector('[data-quality-findings]').replaceChildren();qualityReview.render({values:[],documents:reviewSourceDocuments,chapterId:activeResultChapter});}
    const liveOutcomes={};let settled=0;
    try{
      const outcomes=await runIndependentResultServices(services,event=>{
        if(generation!==detectionGeneration)return;
        if(event.status==='running'){setResultServiceState(container,event.id,'running',`${event.service.label}正在检测…`);return;}
        liveOutcomes[event.id]={status:event.status,result:event.result,error:event.error};settled+=1;
        if(event.status==='completed'){
          setResultServiceState(container,event.id,'completed',`${event.service.label}已完成，结果已更新。`);
          currentResult=mergeIndependentResultServices(services,liveOutcomes,apiError);
          renderCurrentResult();
        }else{
          const reason=apiError(event.error);setResultServiceState(container,event.id,'failed',`${event.service.label}失败：${reason}`);
          if(event.id==='ai-risk'){container.querySelector('[data-ai-summary]').textContent='AI内容分析失败';renderAiNotice(container.querySelector('[data-ai-notice]'),reason);}
          else{container.querySelector('[data-quality-summary]').textContent='重复与水稿检测失败';renderIssueFindings(container.querySelector('[data-quality-findings]'),[],reason);}
        }
        if(settled<services.length){resultStatus.textContent=`处理中 · ${settled}/${services.length}`;resultStatus.className='text-status is-running';}
      });
      if(generation!==detectionGeneration)return;
      isDetecting=false;
      const result=mergeIndependentResultServices(services,outcomes,apiError),completed=services.length-result.incompleteServices.length;
      if(completed){currentResult=result;renderCurrentResult();currentReportMeta={title:workTitle,scope:`${items.length}章：${items.map(item=>item.title).join('、')}`,chapters:resultChapters};container.querySelector('[data-report-empty]').hidden=true;const report=container.querySelector('[data-report]');report.hidden=false;const limited=items.some(item=>item.source&&item.source.completeness!=='complete');report.textContent=`${workTitle}：${result.status==='partial'?'部分':'全部'}检测功能已返回结果。${limited?' 仅检测已导入内容，不代表整章或整本结论。':''}`;await rewriteController.captureDetection({workTitle,detectedChapters:items,result:currentResult,reportMeta:currentReportMeta});}
      retry.configure({services,outcomes,onResult:async value=>{
        currentResult=value;renderCurrentResult();
        currentReportMeta={title:workTitle,scope:`${items.length}章：${items.map(item=>item.title).join('、')}`,chapters:resultChapters};
        resultStatus.textContent=value.status==='completed'?'已完成':value.status==='partial'?'部分完成':'检测失败';resultStatus.className=`text-status ${value.status==='completed'?'is-success':value.status==='partial'?'is-warning':'is-error'}`;renderResultCompletion(completion,value);
        exportAi.disabled=!value.aiRisk;exportSecondary.disabled=!value.quality;
        for(const item of items){const live=chapters.find(chapter=>chapter.id===item.id);if(live)live.status=value.status==='completed'?'已检测':value.status==='partial'?'部分完成':'检测失败';}renderList();
        if(value.status==='failed'){container.querySelector('[data-report]').hidden=true;container.querySelector('[data-report-empty]').hidden=false;return;}
        container.querySelector('[data-report]').hidden=false;container.querySelector('[data-report]').textContent=`${workTitle}：${value.status==='completed'?'全部':'部分'}检测功能已返回结果。`;container.querySelector('[data-report-empty]').hidden=true;
        await rewriteController.captureDetection({workTitle,detectedChapters:items,result:value,reportMeta:currentReportMeta});
      }});
      resultStatus.textContent=result.status==='completed'?'已完成':result.status==='partial'?'部分完成':'检测失败';resultStatus.className=`text-status ${result.status==='completed'?'is-success':result.status==='partial'?'is-warning':'is-error'}`;
      if(result.status==='failed'){completion.textContent=`未完成：${result.incompleteServices.map(item=>`${item.label}（${item.reason}）`).join('；')}`;completion.hidden=false;completion.className='text-result-completion is-warning';}
      else renderResultCompletion(completion,result);
      for(const item of items){const live=chapters.find(chapter=>chapter.id===item.id);if(live&&live.version===item.version&&live.content===item.content)live.status=result.status==='completed'?'已检测':result.status==='partial'?'部分完成':'检测失败';}renderList();exportAi.disabled=!currentResult?.aiRisk;exportSecondary.disabled=!currentResult?.quality;
    }finally{if(generation===detectionGeneration){isDetecting=false;drafts.setBusy(false);button.disabled=false;container.querySelectorAll('[name=checks]').forEach(input=>input.disabled=input.dataset.unavailable==='true');button.textContent='检测已选章节';}}
  }
  const downloadReport=async(button,kind)=>{if(!currentResult||!currentReportMeta)return;button.disabled=true;exportMessage.textContent='正在生成PDF报告…';try{const {downloadTextPdfReport}=await import('../pdf-download.js');const fileName=await downloadTextPdfReport({kind,scenario:'novel',title:currentReportMeta.title,scope:currentReportMeta.scope,chapters:currentReportMeta.chapters,result:currentResult});exportMessage.textContent=`已下载：${fileName}`;}catch(cause){exportMessage.textContent=cause?.message||'PDF报告生成失败，请重试。';}finally{button.disabled=kind==='ai'?!currentResult?.aiRisk:!currentResult?.quality;}};
  exportAi.addEventListener('click',()=>downloadReport(exportAi,'ai'));
  exportSecondary.addEventListener('click',()=>downloadReport(exportSecondary,'secondary'));
}
