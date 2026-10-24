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
  return {title:confirmedTitle,content:confirmedContent,source:{url:result.sourceUrl,finalUrl:result.finalUrl,siteName:result.siteName,author:result.author,publishedAt:result.publishedAt,extractionStatus:result.extractionStatus,completeness:result.completeness,notice:result.notice,confirmedAt:new Date().toISOString(),userEdited:confirmedTitle!==result.title.trim()||confirmedContent!==result.content.trim()}};
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
    <header class="text-workspace-head"><div><p>新闻稿 · 投稿内容</p><h2>稿件审校工作台</h2><span>AI来源风险与三审三校问题分别展示，结论始终关联具体稿件版本。</span></div><output class="text-version" data-version>当前稿件 · 未保存</output></header>
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
          <div class="text-check-list"><label><input type="checkbox" name="checks" value="ai-risk" checked><span><strong>AI生成风险</strong><small>分析全文及主要段落，定位可疑内容</small></span></label><label><input type="checkbox" name="checks" value="proofreading" checked><span><strong>三审三校</strong><small>检查表述、逻辑、用词、错别字与标点</small></span></label></div>
          <label class="text-field">修订说明 <span class="optional">选填</span><textarea name="revisionNote" rows="4" maxlength="500" placeholder="例如：根据编辑意见调整了第二、四段"></textarea></label>
          <div class="text-truth-note"><strong>结果真实性</strong><p>未收到检测服务结果前，页面只显示“未检测”或明确失败，不生成风险分数。</p></div>
        </div>
        <footer class="text-actions"><p data-form-error role="alert"></p><button type="submit" class="text-primary">保存并开始检测</button></footer>
      </form>
    </section>
    <section class="text-panel" role="tabpanel" data-panel="result" hidden>
      <div class="text-result-head"><div><p>当前版本</p><h3 data-result-title>尚未提交检测</h3></div><span class="text-status is-idle" data-result-status>未检测</span></div>
      <div class="text-result-grid"><article class="text-result-card"><span>AI生成风险</span><strong data-ai-summary>等待检测结果</strong><p>完成后将在这里展示全文结论、覆盖范围和可疑段落位置。</p><ul data-ai-findings></ul></article><article class="text-result-card"><span>三审三校</span><strong data-proof-summary>等待检测结果</strong><p>表述、逻辑、用词、错别字和标点问题将与AI风险分开显示。</p><ul data-proof-findings></ul></article></div>
      <div class="text-empty" data-result-empty><strong>还没有检测记录</strong><p>先在“稿件提交”中填写材料。提交失败时，本区域会保留真实失败状态。</p></div>
    </section>
    <section class="text-panel" role="tabpanel" data-panel="history" hidden>
      <div class="text-history-head"><div><h3>版本记录</h3><p>修订后创建新版本，旧结果保持原始关联。</p></div><button type="button" class="text-secondary" data-export disabled>导出当前报告</button></div>
      <ol class="text-history" data-history><li><strong>暂无版本记录</strong><span>成功收到服务回执后才会添加记录</span></li></ol>
    </section>`;
  const form=container.querySelector('form'),status=container.querySelector('[data-result-status]'),error=container.querySelector('[data-form-error]'),submit=form.querySelector('[type=submit]');
  const importPreview=container.querySelector('[data-news-import-preview]'),importStatus=container.querySelector('[data-news-import-status]'),importMessage=container.querySelector('[data-news-import-message]'),importFetch=container.querySelector('[data-news-import-fetch]');
  let version=0,currentResult=null,dirty=false,importDraft=null,confirmedLink=null;
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
  form.addEventListener('input',()=>{error.textContent='';if(currentResult&&!dirty){dirty=true;status.textContent='内容已修改';status.className='text-status is-warning';container.querySelector('[data-version]').textContent=`当前稿件 · 待生成 v${version+1}`;}});
  container.querySelector('[data-export]').addEventListener('click',()=>{
    if(!currentResult)return;const blob=new Blob([JSON.stringify(currentResult,null,2)],{type:'application/json;charset=utf-8'}),link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=`新闻稿检测报告-v${version}.json`;link.click();URL.revokeObjectURL(link.href);
  });
  form.addEventListener('submit',async event=>{
    event.preventDefault();const sourceType=form.elements.sourceType.value,file=form.elements.document.files[0],values={title:form.elements.title.value,sourceType,content:form.elements.content.value,url:form.elements.url.value,file};
    const problem=validateNewsInput(values);if(problem){error.textContent=problem;return;}
    if(sourceType==='link'){const linkProblem=validateConfirmedNewsLink(values.url,confirmedLink);if(linkProblem){error.textContent=linkProblem;return;}}
    const checks=Array.from(form.elements.checks).filter(item=>item.checked).map(item=>item.value);if(!checks.length){error.textContent='请至少选择一个检测项目。';return;}
    const resultGrid=container.querySelector('.text-result-grid');submit.disabled=true;submit.textContent='正在提交…';status.textContent='处理中';status.className='text-status is-running';resultGrid.hidden=true;selectTab('result');
    try{
      const result=await globalThis.Veritas.api.invoke('/text/news',{action:'analyze',material:{title:values.title.trim(),sourceType,content:sourceType==='paste'?values.content:sourceType==='link'?confirmedLink.content:undefined,url:sourceType==='link'?values.url:undefined,file:sourceType==='document'?{name:file.name,size:file.size,type:file.type}:undefined,source:sourceType==='link'?confirmedLink.source:undefined},checks,revisionNote:form.elements.revisionNote.value.trim(),previousVersion:version||undefined});
      if(!result||!['completed','partial'].includes(result.status))throw new Error('检测服务未返回有效的完成状态。');
      version+=1;currentResult=result;dirty=false;status.textContent=result.status==='partial'?'部分完成':'已完成';status.className=`text-status ${result.status==='partial'?'is-warning':'is-success'}`;container.querySelector('[data-version]').textContent=`当前稿件 · v${version}`;container.querySelector('[data-result-title]').textContent=`${values.title.trim()} · v${version}`;container.querySelector('[data-result-empty]').hidden=true;resultGrid.hidden=false;
      container.querySelector('[data-ai-summary]').textContent=result.aiRisk?.summary||'服务未返回AI风险摘要';container.querySelector('[data-proof-summary]').textContent=result.proofreading?.summary||'服务未返回三审三校摘要';
      const fill=(node,items)=>{node.replaceChildren(...(Array.isArray(items)?items:[]).map(item=>{const li=document.createElement('li');li.textContent=[item.location,item.type,item.message||item.summary].filter(Boolean).join(' · ');return li;}));};fill(container.querySelector('[data-ai-findings]'),result.aiRisk?.findings);fill(container.querySelector('[data-proof-findings]'),result.proofreading?.issues);
      const history=container.querySelector('[data-history]');if(version===1)history.replaceChildren();const li=document.createElement('li'),strong=document.createElement('strong'),span=document.createElement('span');strong.textContent=`v${version} · ${values.title.trim()}`;span.textContent=`${status.textContent} · ${sourceLabels[sourceType]}`;li.append(strong,span);history.prepend(li);container.querySelector('[data-export]').disabled=false;
    }catch(cause){status.textContent='检测失败';status.className='text-status is-error';container.querySelector('[data-result-title]').textContent=values.title.trim();container.querySelector('[data-result-empty] strong').textContent='本次检测未完成';container.querySelector('[data-result-empty] p').textContent=apiError(cause);container.querySelector('[data-result-empty]').hidden=false;container.querySelector('[data-export]').disabled=!currentResult;}
    finally{submit.disabled=false;submit.textContent='保存并开始检测';}
  });
}
