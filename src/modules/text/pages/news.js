import { createAiScoringSegments } from '../ai-segmentation.js';
import { mergeIndependentResultServices, renderAiOverview, renderProofreadingStages, renderResultCompletion, runIndependentResultServices, setResultServiceState, setupAiSentenceFilter, setupResultServiceTabs } from '../result-render.js';

const sourceLabels={paste:'粘贴正文',document:'上传文档',link:'新闻链接'};

export function validateNewsUrl(value){
  let url;try{url=new URL(value);if(!['http:','https:'].includes(url.protocol))throw new Error();}
  catch{return '请输入有效的 http 或 https 新闻链接。';}
  if(url.username||url.password)return '请输入不含账号信息的新闻链接。';
  return '';
}

export function validateNewsInput({title,sourceType,content,url,file}){
  if(!title?.trim())return '请填写稿件标题。';
  if(sourceType==='paste'&&!content?.trim())return '请粘贴需要检测的稿件正文。';
  if(sourceType==='document'&&!file)return '请选择需要检测的文档。';
  if(sourceType==='link')return validateNewsUrl(url);
  return '';
}

function normalizedUrl(value){try{return new URL(value).href;}catch{return '';}}

export function validateConfirmedNewsLink(url,confirmed){
  if(!confirmed)return '请先提取并确认新闻正文。';
  if(normalizedUrl(url)!==normalizedUrl(confirmed.source.url))return '新闻链接已修改，请重新提取并确认正文。';
  return '';
}

export function createConfirmedNewsImport(result,{title=result?.title,content=result?.content}={}){
  const confirmedTitle=title?.trim(),confirmedContent=content?.trim();
  if(!result||!confirmedTitle||!confirmedContent)throw new Error('新闻导入预览需要包含标题和可读正文。');
  return {title:confirmedTitle,content:confirmedContent,source:{url:result.sourceUrl,finalUrl:result.finalUrl,siteName:result.siteName,author:result.author,publishedAt:result.publishedAt,extractionStatus:result.extractionStatus,completeness:result.completeness,...(result.extractionMethod?{extractionMethod:result.extractionMethod}:{}),notice:result.notice,confirmedAt:new Date().toISOString(),userEdited:confirmedTitle!==result.title.trim()||confirmedContent!==result.content.trim()}};
}

function apiError(error){
  if(error?.status===501||error?.code==='NOT_IMPLEMENTED')return '检测服务尚未接入，稿件内容仍保留在当前页面。';
  if(error?.name==='AbortError')return '本次检测已取消。';
  return error?.message||'提交失败，请稍后重试。';
}

function importError(error){
  if(error?.code==='ACCESS_RESTRICTED')return error.message||'页面要求登录、付费或验证，无法读取公开正文。';
  if(error?.code==='PRIVATE_ADDRESS')return '出于安全限制，不能访问本机、内网或其他非公开地址。';
  if(error?.code==='FETCH_TIMEOUT')return '获取网页超时，可重试或改用粘贴正文。';
  return error?.message||'新闻正文提取失败，可重试或改用粘贴正文。';
}

export function renderTextNews(container){
  container.classList.add('text-workspace');
  container.innerHTML=`
    <header class="text-workspace-head"><div><p>新闻稿 · 投稿内容</p><h2>稿件审校工作台</h2><span>当前接入三审三校；结论始终关联具体稿件版本和原文段落。</span></div><output class="text-version" data-version>当前稿件 · 未保存</output></header>
    <div class="text-tabs" role="tablist" aria-label="稿件工作区">
      <button type="button" role="tab" aria-selected="true" data-tab="material">稿件提交</button>
      <button type="button" role="tab" aria-selected="false" data-tab="result">检测结果</button>
      <button type="button" role="tab" aria-selected="false" data-tab="history">历史与报告</button>
    </div>
    <section class="text-panel" role="tabpanel" data-panel="material">
      <form class="text-form" novalidate>
        <div class="text-card text-source-card"><div class="text-card-title"><span>01</span><div><h3>稿件来源</h3><p>选择一种方式提交正文</p></div></div>
          <fieldset class="text-source-switch"><legend class="sr-only">稿件来源</legend>${Object.entries(sourceLabels).map(([value,label])=>`<label><input type="radio" name="sourceType" value="${value}" ${value==='paste'?'checked':''}><span>${label}</span></label>`).join('')}</fieldset>
          <label class="text-field">稿件标题 <span aria-hidden="true">*</span><input name="title" maxlength="120" placeholder="例如：关于校园科技节的新闻稿" autocomplete="off"></label>
          <div data-source="paste"><label class="text-field">稿件正文 <span aria-hidden="true">*</span><textarea name="content" rows="13" maxlength="50000" placeholder="在此粘贴新闻稿或投稿文章正文"></textarea></label><p class="text-field-meta"><span>仅在提交检测时发送正文</span><output data-count>0 / 50,000 字</output></p></div>
          <div data-source="document" hidden><label class="text-upload"><input type="file" name="document" accept=".txt,.md,.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"><strong>选择稿件文档</strong><span data-file-name>支持 TXT、MD、DOC、DOCX；文档解析由后端完成</span></label></div>
          <div data-source="link" hidden><section class="novel-import-panel" aria-labelledby="news-import-title"><div class="novel-import-heading"><div><strong id="news-import-title">从新闻网页导入</strong><p>仅获取公开可读的新闻正文页，不绕过登录、付费或验证限制。</p></div><span class="text-status is-idle" data-news-import-status>未提取</span></div>
            <div class="novel-import-row"><label class="text-field">新闻链接 <span aria-hidden="true">*</span><input name="url" type="url" maxlength="2000" placeholder="https://example.com/news/article"></label><button type="button" class="text-secondary" data-news-import-fetch>提取正文</button></div>
            <p class="text-operation-message" data-news-import-message role="status"></p>
            <div class="novel-import-preview" data-news-import-preview hidden><p class="novel-import-meta" data-news-import-meta></p><label class="text-field">提取标题<input name="importNewsTitle" maxlength="120"></label><label class="text-field">提取正文<textarea name="importNewsContent" rows="9" maxlength="50000"></textarea></label><p class="text-help" data-news-import-notice></p><div class="text-inline-actions"><button type="button" class="text-primary" data-news-import-confirm>确认作为稿件材料</button></div></div>
          </section></div>
        </div>
        <div class="text-card"><div class="text-card-title"><span>02</span><div><h3>检测项目</h3><p>两类结果独立呈现</p></div></div>
          <div class="text-check-list"><label><input type="checkbox" name="checks" value="ai-risk" checked><span><strong>疑似AI风险</strong><small>按句调用中文 C-ReD，逐句展示未校准AI类得分与判断</small></span></label><label><input type="checkbox" name="checks" value="proofreading" checked><span><strong>三审三校</strong><small>检查表述、逻辑、用词、错别字与标点</small></span></label></div>
          <div class="text-truth-note"><strong>结果真实性</strong><p>未收到检测服务结果前，页面只显示“未检测”或明确失败，不生成风险分数。</p></div>
        </div>
        <footer class="text-actions"><p data-form-error role="alert"></p><button type="submit" class="text-primary">保存并开始检测</button></footer>
      </form>
    </section>
    <section class="text-panel" role="tabpanel" data-panel="result" hidden>
      <div class="text-result-head"><div><p>当前版本</p><h3 data-result-title>尚未提交检测</h3></div><span class="text-status is-idle" data-result-status>未检测</span></div><p class="text-result-completion" data-result-completion hidden></p>
      <div class="result-service-tabs" role="tablist" aria-label="检测结果类型" data-result-service-tabs hidden><button type="button" role="tab" aria-selected="true" data-result-service-tab="ai-risk">AI内容分析</button><button type="button" role="tab" aria-selected="false" data-result-service-tab="proofreading">三审三校</button></div>
      <div class="text-result-grid"><article class="text-result-card" data-result-service-panel="ai-risk"><span>句级疑似AI检测</span><div class="result-service-progress" data-service-progress hidden aria-live="polite"><i aria-hidden="true"></i><span></span></div><strong data-ai-summary>等待检测结果</strong><p data-ai-notice>短句会优先与同段相邻句合并；合并得分属于两句整体。</p><div class="ai-overview" data-ai-overview hidden></div><div class="ai-result-filter" data-ai-filter><div role="group" aria-label="句级结果筛选"><button type="button" data-ai-filter-value="all" aria-pressed="true">全部显示</button><button type="button" data-ai-filter-value="suspected" aria-pressed="false">仅疑似AI</button></div><output data-ai-filter-count aria-live="polite">显示 0 / 0 个片段</output></div><ul data-ai-findings></ul></article><article class="text-result-card" data-result-service-panel="proofreading"><span>三审三校</span><div class="result-service-progress" data-service-progress hidden aria-live="polite"><i aria-hidden="true"></i><span></span></div><strong data-proof-summary>等待检测结果</strong><p>初审、复审、终审、一校、二校、三校分别执行并展示检查范围与发现；每条问题均附可回查的原文片段。</p><div data-proof-stages></div></article></div>
      <div class="text-empty" data-result-empty><strong>还没有检测记录</strong><p>先在“稿件提交”中填写材料。提交失败时，本区域会保留真实失败状态。</p></div>
    </section>
    <section class="text-panel" role="tabpanel" data-panel="history" hidden>
      <div class="text-history-head"><div><h3>版本记录</h3><p>AI内容分析与三审三校分别导出为适合A4打印的PDF报告。</p></div><div class="text-inline-actions"><button type="button" class="text-secondary" data-export-ai disabled>导出AI分析PDF</button><button type="button" class="text-secondary" data-export-secondary disabled>导出三审三校PDF</button></div></div><p class="text-operation-message" data-export-message role="alert"></p>
      <ol class="text-history" data-history><li><strong>暂无版本记录</strong><span>成功收到服务回执后才会添加记录</span></li></ol>
    </section>`;
  const form=container.querySelector('form'),status=container.querySelector('[data-result-status]'),completion=container.querySelector('[data-result-completion]'),error=container.querySelector('[data-form-error]'),submit=form.querySelector('[type=submit]'),exportAi=container.querySelector('[data-export-ai]'),exportSecondary=container.querySelector('[data-export-secondary]'),exportMessage=container.querySelector('[data-export-message]'),aiSentenceView=setupAiSentenceFilter(container),resultServiceTabs=setupResultServiceTabs(container);
  const importPreview=container.querySelector('[data-news-import-preview]'),importStatus=container.querySelector('[data-news-import-status]'),importMessage=container.querySelector('[data-news-import-message]'),importFetch=container.querySelector('[data-news-import-fetch]');
  container.querySelector('.text-result-grid').hidden=true;
  let version=0,currentResult=null,currentReportMeta=null,dirty=false,importDraft=null,confirmedLink=null;
  const selectTab=name=>{for(const button of container.querySelectorAll('[data-tab]'))button.setAttribute('aria-selected',String(button.dataset.tab===name));for(const panel of container.querySelectorAll('[data-panel]'))panel.hidden=panel.dataset.panel!==name;};
  container.querySelector('.text-tabs').addEventListener('click',event=>{const button=event.target.closest('[data-tab]');if(button)selectTab(button.dataset.tab);});
  form.addEventListener('change',event=>{
    if(event.target.name==='sourceType')for(const panel of form.querySelectorAll('[data-source]'))panel.hidden=panel.dataset.source!==event.target.value;
    if(event.target.name==='document')container.querySelector('[data-file-name]').textContent=event.target.files[0]?.name||'支持 TXT、MD、DOC、DOCX；文档解析由后端完成';
  });
  form.elements.content.addEventListener('input',()=>{container.querySelector('[data-count]').textContent=`${form.elements.content.value.length.toLocaleString()} / 50,000 字`;});
  form.elements.url.addEventListener('input',()=>{if(confirmedLink&&normalizedUrl(form.elements.url.value)!==normalizedUrl(confirmedLink.source.url)){importStatus.textContent='需重新提取';importStatus.className='text-status is-warning';importMessage.textContent='新闻链接已修改，请重新提取并确认正文。';}});
  importFetch.addEventListener('click',async()=>{
    const url=form.elements.url.value.trim(),problem=validateNewsUrl(url);if(problem){importMessage.textContent=problem;return;}
    importDraft=null;importPreview.hidden=true;importFetch.disabled=true;importFetch.textContent='正在提取…';importStatus.textContent='处理中';importStatus.className='text-status is-running';importMessage.textContent='';
    try{
      const result=await globalThis.Veritas.api.importNewsArticle(url);importDraft=result;form.elements.importNewsTitle.value=result.title;form.elements.importNewsContent.value=result.content;container.querySelector('[data-news-import-meta]').textContent=`${result.siteName} · ${result.content.length.toLocaleString()} 字${result.author?` · 作者：${result.author}`:''}${result.publishedAt?` · 发布时间：${result.publishedAt}`:''} · 来源：${result.finalUrl}`;container.querySelector('[data-news-import-notice]').textContent=result.notice;importStatus.textContent=result.extractionStatus==='partial'?'仅可读部分':'完整性待确认';importStatus.className=`text-status ${result.extractionStatus==='partial'?'is-warning':'is-success'}`;importPreview.hidden=false;
    }catch(cause){importStatus.textContent=cause?.details?.extractionStatus==='restricted'?'读取受限':'提取失败';importStatus.className='text-status is-error';importMessage.textContent=importError(cause);}
    finally{importFetch.disabled=false;importFetch.textContent='提取正文';}
  });
  container.querySelector('[data-news-import-confirm]').addEventListener('click',()=>{
    if(!importDraft){importMessage.textContent='请先提取新闻正文。';return;}
    try{const confirmed=createConfirmedNewsImport(importDraft,{title:form.elements.importNewsTitle.value,content:form.elements.importNewsContent.value});confirmedLink=confirmed;form.elements.title.value=confirmed.title;form.elements.content.value=confirmed.content;container.querySelector('[data-count]').textContent=`${confirmed.content.length.toLocaleString()} / 50,000 字`;importStatus.textContent='已确认';importStatus.className='text-status is-success';importMessage.textContent=confirmed.source.completeness==='partial'?'已确认仅可读部分；后续仅检测已导入内容。':'已确认为稿件材料；请继续核对后提交检测。';}
    catch(cause){importMessage.textContent=cause.message;}
  });
  form.addEventListener('input',()=>{error.textContent='';if(currentResult&&!dirty){dirty=true;completion.hidden=true;status.textContent='内容已修改';status.className='text-status is-warning';container.querySelector('[data-version]').textContent=`当前稿件 · 待生成 v${version+1}`;}});
  const downloadReport=async(button,kind)=>{if(!currentResult||!currentReportMeta)return;button.disabled=true;exportMessage.textContent='正在生成PDF报告…';try{const {downloadTextPdfReport}=await import('../pdf-download.js');const fileName=await downloadTextPdfReport({kind,scenario:'news',title:currentReportMeta.title,version:currentReportMeta.version,scope:currentReportMeta.scope,result:currentResult});exportMessage.textContent=`已下载：${fileName}`;}catch(cause){exportMessage.textContent=cause?.message||'PDF报告生成失败，请重试。';}finally{button.disabled=kind==='ai'?!currentResult?.aiRisk:!currentResult?.proofreading;}};
  exportAi.addEventListener('click',()=>downloadReport(exportAi,'ai'));
  exportSecondary.addEventListener('click',()=>downloadReport(exportSecondary,'secondary'));
  form.addEventListener('submit',async event=>{
    event.preventDefault();const sourceType=form.elements.sourceType.value,file=form.elements.document.files[0],values={title:form.elements.title.value,sourceType,content:form.elements.content.value,url:form.elements.url.value,file};
    const problem=validateNewsInput(values);if(problem){error.textContent=problem;return;}
    if(sourceType==='link'){const linkProblem=validateConfirmedNewsLink(values.url,confirmedLink);if(linkProblem){error.textContent=linkProblem;return;}}
    const checks=Array.from(form.elements.checks).filter(item=>item.checked).map(item=>item.value);if(!checks.length){error.textContent='请至少选择一个检测项目。';return;}
    const resultGrid=container.querySelector('.text-result-grid'),submittedContent=sourceType==='paste'?values.content:sourceType==='link'?confirmedLink.content:undefined;
    const material={title:values.title.trim(),sourceType,content:submittedContent,language:'zh',url:sourceType==='link'?values.url:undefined,file:sourceType==='document'?{name:file.name,size:file.size,type:file.type}:undefined,source:sourceType==='link'?confirmedLink.source:undefined};
    const services=checks.map(id=>id==='ai-risk'
      ? {id,label:'AI内容分析',resultKey:'aiRisk',run:()=>globalThis.Veritas.api.invoke('/text/news',{action:'analyze',material:{...material,aiSegments:createAiScoringSegments(submittedContent,{prefix:'news-s'})},checks:['ai-risk'],previousVersion:version||undefined})}
      : {id,label:'三审三校',resultKey:'proofreading',run:()=>globalThis.Veritas.api.invoke('/text/news',{action:'analyze',material,checks:['proofreading'],previousVersion:version||undefined})});
    submit.disabled=true;submit.textContent='正在检测…';status.textContent=`处理中 · 0/${services.length}`;status.className='text-status is-running';completion.hidden=true;resultGrid.hidden=false;resultServiceTabs.show(checks);container.querySelector('[data-result-empty]').hidden=true;container.querySelector('[data-result-title]').textContent=`${values.title.trim()} · 检测中`;selectTab('result');currentResult=null;currentReportMeta=null;exportAi.disabled=true;exportSecondary.disabled=true;exportMessage.textContent='';
    if(checks.includes('ai-risk')){container.querySelector('[data-ai-summary]').textContent='正在调用AI文本检测服务…';container.querySelector('[data-ai-notice]').textContent='收到该项结果后会立即展示，无需等待三审三校。';renderAiOverview(container.querySelector('[data-ai-overview]'),null);aiSentenceView.render([]);}
    if(checks.includes('proofreading')){container.querySelector('[data-proof-summary]').textContent='正在执行三审三校…';container.querySelector('[data-proof-stages]').replaceChildren();}
    const liveOutcomes={};let settled=0;
    try{
      const outcomes=await runIndependentResultServices(services,event=>{
        if(event.status==='running'){setResultServiceState(container,event.id,'running',`${event.service.label}正在检测…`);return;}
        liveOutcomes[event.id]={status:event.status,result:event.result,error:event.error};settled+=1;
        if(event.status==='completed'){
          setResultServiceState(container,event.id,'completed',`${event.service.label}已完成，结果已更新。`);
          if(event.id==='ai-risk'){const value=event.result.aiRisk;container.querySelector('[data-ai-summary]').textContent=value.summary;container.querySelector('[data-ai-notice]').textContent=value.notice;renderAiOverview(container.querySelector('[data-ai-overview]'),value);aiSentenceView.render(value.findings);}
          else{const value=event.result.proofreading;container.querySelector('[data-proof-summary]').textContent=value.summary;renderProofreadingStages(container.querySelector('[data-proof-stages]'),value);}
          currentResult=mergeIndependentResultServices(services,liveOutcomes,apiError);
        }else{
          const reason=apiError(event.error);setResultServiceState(container,event.id,'failed',`${event.service.label}失败：${reason}`);
          if(event.id==='ai-risk'){container.querySelector('[data-ai-summary]').textContent='AI内容分析失败';container.querySelector('[data-ai-notice]').textContent=reason;}
          else{container.querySelector('[data-proof-summary]').textContent='三审三校失败';container.querySelector('[data-proof-stages]').replaceChildren();}
        }
        if(settled<services.length){status.textContent=`处理中 · ${settled}/${services.length}`;status.className='text-status is-running';}
      });
      const result=mergeIndependentResultServices(services,outcomes,apiError),completed=services.length-result.incompleteServices.length;
      if(completed){version+=1;currentResult=result;currentReportMeta={title:values.title.trim(),version,scope:sourceLabels[sourceType]};dirty=false;container.querySelector('[data-version]').textContent=`当前稿件 · v${version}`;container.querySelector('[data-result-title]').textContent=`${values.title.trim()} · v${version}`;const history=container.querySelector('[data-history]');if(version===1)history.replaceChildren();const li=document.createElement('li'),strong=document.createElement('strong'),span=document.createElement('span');strong.textContent=`v${version} · ${values.title.trim()}`;span.textContent=`${result.status==='partial'?'部分完成':'已完成'} · ${sourceLabels[sourceType]}`;li.append(strong,span);history.prepend(li);}
      status.textContent=result.status==='completed'?'已完成':result.status==='partial'?'部分完成':'检测失败';status.className=`text-status ${result.status==='completed'?'is-success':result.status==='partial'?'is-warning':'is-error'}`;
      if(result.status==='failed'){completion.textContent=`未完成：${result.incompleteServices.map(item=>`${item.label}（${item.reason}）`).join('；')}`;completion.hidden=false;completion.className='text-result-completion is-warning';}
      else renderResultCompletion(completion,result);
      exportAi.disabled=!currentResult?.aiRisk;exportSecondary.disabled=!currentResult?.proofreading;
    }finally{submit.disabled=false;submit.textContent='保存并开始检测';}
  });
}
