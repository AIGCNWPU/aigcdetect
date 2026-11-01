import { downloadCurrentRefundPdf } from '../refund/pdf-export.js';
import { createRefundMaterials, validateRefundFields } from '../refund/materials.js';
import { refundSubmission } from '../refund/submission.js';
import { mountRefundDetection } from '../refund/detection-view.js';
import { mountRefundTabs } from '../refund/tabs.js';
import { refundDetection } from '../refund/detection.js';
import { createRefundBackend } from '../refund/backend.js';
import { refundPresets, loadRefundPresetFile } from '../refund/presets.js';

const refundPdfExportAvailable=true;

/** Material preparation and detection UI; services are configured through adapters. */
export function renderImageRefund(container) {
  container.classList.add('refund-workspace');
  container.innerHTML = `
    <div class="refund-case-header"><div><h2>售后案件工作区</h2><p data-workspace-case>当前案件</p></div><div class="refund-case-status"><span data-workspace-count>凭证 0 张</span><span data-workspace-status role="status" aria-live="polite">尚未开始检测</span><button type="button" class="refund-button refund-button-secondary" data-workspace-cancel hidden>取消检测</button></div></div>
    <div class="refund-tabs refund-main-tabs" id="refund-workspace-tabs" aria-label="案件工作区"><button data-tab="materials">案件与凭证</button><button data-tab="detection">检测与核对</button><button data-tab="summary">案件汇总</button></div>
    <p class="refund-status" data-refund-status role="status" aria-live="polite" hidden></p>
    <div data-workspace-panel data-tab-panel="materials">
    <div class="refund-intro"><div><h2>整理售后凭证</h2><p>填写案件资料，添加需要核查的商品图片。</p></div></div>
    <section class="refund-presets" aria-labelledby="refund-presets-title"><div class="refund-presets-heading"><div><h3 id="refund-presets-title">演示预设</h3><p>一键填入资料和图片，开始检测后查看分析结果。</p></div><button type="button" class="refund-button refund-button-secondary" data-preset-undo hidden>撤销填充</button></div><div class="refund-preset-grid" data-preset-list></div></section>
    <form class="refund-form" novalidate>
      <div class="refund-columns">
        <fieldset class="refund-details"><legend><span>01</span> 案件资料</legend>
          <p class="refund-section-hint">带 * 的项目为提交材料时的必填项。</p>
          <label for="refund-case-number">案件编号 <span aria-hidden="true">*</span></label>
          <input id="refund-case-number" name="caseNumber" aria-label="案件编号" maxlength="100" required placeholder="例如：AS-20261021-001" aria-describedby="refund-error-caseNumber">
          <p class="refund-field-error" id="refund-error-caseNumber" hidden></p>
          <label for="refund-product-name">商品名称 <span aria-hidden="true">*</span></label>
          <input id="refund-product-name" name="productName" aria-label="商品名称" maxlength="200" required placeholder="填写需要核查的商品名称" aria-describedby="refund-error-productName">
          <p class="refund-field-error" id="refund-error-productName" hidden></p>
          <label for="refund-style">商品款式 <small>选填</small></label>
          <input id="refund-style" name="style" aria-label="商品款式" maxlength="200" placeholder="颜色、规格或型号" aria-describedby="refund-error-style">
          <p class="refund-field-error" id="refund-error-style" hidden></p>
          <label for="refund-product-info">商品资料 <small>选填</small></label>
          <textarea id="refund-product-info" name="productInfo" aria-label="商品资料" maxlength="2000" rows="3" placeholder="补充商品材质、外观或规格说明" aria-describedby="refund-error-productInfo"></textarea>
          <p class="refund-field-error" id="refund-error-productInfo" hidden></p>
          <label for="refund-description">问题描述 <span aria-hidden="true">*</span></label>
          <textarea id="refund-description" name="description" aria-label="问题描述" maxlength="2000" rows="4" required placeholder="描述破损、污损等问题，以及需要核查的位置" aria-describedby="refund-error-description"></textarea>
          <p class="refund-field-error" id="refund-error-description" hidden></p>
        </fieldset>
        <fieldset class="refund-evidence"><legend><span>02</span> 图片凭证 <output data-refund-count aria-live="polite">0 / 10</output></legend>
          <p class="refund-section-hint">建议包含商品全貌和问题部位的清晰近照。</p>
          <div class="refund-dropzone" data-refund-drop>
            <svg viewBox="0 0 48 48" width="42" height="42" fill="none" aria-hidden="true"><rect x="6" y="8" width="36" height="32" rx="6" stroke="currentColor" stroke-width="1.5"/><circle cx="17" cy="18" r="3" stroke="currentColor" stroke-width="1.5"/><path d="m7 32 10-8 8 7 7-9 9 10" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>
            <strong>将图片拖到这里</strong><span>或选择本机图片，支持一次添加多张</span>
            <button class="refund-button refund-button-secondary" type="button" data-refund-choose>选择图片</button>
            <input type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" multiple hidden aria-label="选择图片文件">
            <small>JPG / PNG / WebP · 单张 ≤ 5 MiB · 最多 10 张<br>图片分辨率不超过 4000 万像素</small>
          </div>
          <ul class="refund-file-errors" data-refund-errors role="alert" hidden></ul>
          <div class="refund-list-heading"><h3>已添加的凭证</h3><span>点击图片查看大图</span></div>
          <ul class="refund-image-list" aria-label="图片凭证列表"></ul>
          <div class="refund-empty" data-refund-empty><span>还没有图片凭证</span><p>先添加图片，再对照案件资料检查。</p></div>
        </fieldset>
      </div>
      <div class="refund-actions"><div><strong>检查资料后提交</strong><p>核对案件资料与图片凭证。</p></div><button type="submit" class="refund-button refund-button-primary">提交材料</button></div>
    </form>
    </div>
    <div data-workspace-panel data-tab-panel="detection" hidden><div data-refund-detection></div></div>
    <div data-workspace-panel data-tab-panel="summary" hidden>
    <div class="refund-report-actions"><div><strong>当前分析报告</strong><p>${refundPdfExportAvailable?'包含结果图表、原图与标记对照、商品核对依据。':'报告导出功能后续开放。'}</p></div><button type="button" class="refund-button refund-button-primary" data-report-pdf disabled title="${refundPdfExportAvailable?'导出当前材料与结果。':'报告导出暂未开放'}">导出 PDF</button></div>
      <div data-refund-summary></div>
    </div>
    <dialog class="refund-preview" aria-labelledby="refund-preview-title">
      <div class="refund-preview-header"><div><h3 id="refund-preview-title"></h3><p data-refund-preview-meta></p></div><button type="button" class="refund-button refund-button-secondary" data-refund-close aria-label="关闭预览">关闭</button></div>
      <div class="refund-preview-image"><img alt=""></div>
    </dialog>`;

  const materials=createRefundMaterials();
  const form=container.querySelector('form');
  const chooser=container.querySelector('input[type=file]');
  const drop=container.querySelector('[data-refund-drop]');
  const list=container.querySelector('.refund-image-list');
  const status=container.querySelector('[data-refund-status]');
  const cancelButton=container.querySelector('[data-workspace-cancel]');
  const fileErrors=container.querySelector('[data-refund-errors]');
  const dialog=container.querySelector('dialog');
  const dialogImage=dialog.querySelector('img');
  let loading=false, submitting=false, disposed=false, opener=null, requestController=null,presetController=null,presetUndo=null,exporting=false,pdfController=null,backendReady=false;
  const readFields=()=>Object.fromEntries(['caseNumber','productName','style','productInfo','description'].map(key=>[key,form.elements.namedItem(key).value]));
  const tabs=mountRefundTabs(container.querySelector('.refund-main-tabs'),Array.from(container.querySelectorAll('[data-workspace-panel]')));
  const backend=createRefundBackend({getImages:()=>materials.items});
  const detection=mountRefundDetection(container.querySelector('[data-refund-detection]'),{
    summaryHost:container.querySelector('[data-refund-summary]'),onOpen:()=>tabs.select('detection'),
    onProgress(progress){
      container.querySelector('[data-workspace-case]').textContent=readFields().caseNumber.trim()||'当前案件';
      container.querySelector('[data-workspace-count]').textContent=`凭证 ${materials.items.length} 张`;
      container.querySelector('[data-workspace-status]').textContent=progress.busy?`检测中 · ${progress.text}`:progress.text||'尚未开始检测';
      const restoreFocus=!progress.busy && document.activeElement===cancelButton;
      cancelButton.hidden=!progress.busy;
      if(restoreFocus)container.querySelector('.refund-main-tabs [aria-selected="true"]').focus({preventScroll:true});
    },getFields:readFields,getImages:()=>materials.items,onBusyChange:controls,isBlocked:()=>loading||submitting||!backendReady
  });
  cancelButton.addEventListener('click',()=>detection.cancel());

  // A public frontend hook only; the backend's fields remain the adapter's responsibility.
  if (globalThis.Veritas) globalThis.Veritas.refund=refundSubmission;
  const sizeLabel=bytes=>bytes<1024*1024 ? `${Math.max(1,Math.round(bytes/1024))} KiB` : `${(bytes/1024/1024).toFixed(1)} MiB`;
  function message(text,kind='info') { status.textContent=text; status.dataset.kind=kind; status.hidden=false; }
  function controls() {
    container.querySelector('.refund-evidence').disabled=loading || submitting || detection.busy;
    container.querySelector('.refund-details').disabled=loading || submitting || detection.busy;
    container.querySelector('[data-report-pdf]').disabled=!refundPdfExportAvailable || loading || submitting || detection.busy || !materials.items.length;
    container.querySelector('[data-report-pdf]').textContent=exporting?'正在生成 PDF…':'导出 PDF';
    for(const element of container.querySelectorAll('.refund-presets button'))element.disabled=loading || submitting || detection.busy;
    container.querySelector('[data-preset-undo]').hidden=!presetUndo;
    const submit=form.querySelector('[type=submit]');
    submit.disabled=!backendReady || loading || submitting || detection.busy;
    submit.textContent=submitting && !exporting ? '正在提交…' : '提交材料';
    drop.setAttribute('aria-busy',String(loading));
    detection.refreshControls();
  }
  const presetList=container.querySelector('[data-preset-list]');
  for(const preset of refundPresets) {
    const button=document.createElement('button');button.type='button';button.className='refund-preset';button.dataset.preset=preset.id;
    const name=document.createElement('strong');name.textContent=preset.title;
    const description=document.createElement('span');description.textContent=preset.description;
    button.append(name,description);presetList.append(button);
  }
  function clearFieldErrors() {
    for(const key of ['caseNumber','productName','style','productInfo','description']) {
      form.elements.namedItem(key).removeAttribute('aria-invalid');
      const error=container.querySelector(`#refund-error-${key}`);error.textContent='';error.hidden=true;
    }
    fileErrors.replaceChildren();fileErrors.hidden=true;chooser.value='';
  }
  async function fillPreset(preset) {
    if(disposed || loading || submitting || detection.busy)return;
    const previous={fields:readFields(),files:materials.items.map(item=>item.file),kinds:detection.getKinds()};
    loading=true;presetController=new AbortController();controls();message(`正在准备${preset.title}…`);
    try {
      const file=await loadRefundPresetFile(preset,{signal:presetController.signal});
      if(disposed)return;
      const result=await materials.replace([file]);
      if(disposed)return;
      if(!result.replaced)throw new Error(result.errors[0]?.message||'演示图片无法读取，当前资料保持不变。');
      const fields={...preset.fields,caseNumber:`DEMO-${Date.now().toString(36).toUpperCase()}`};
      for(const [key,value] of Object.entries(fields))form.elements.namedItem(key).value=value;
      presetUndo=previous;clearFieldErrors();renderImages();detection.setKinds(preset.kinds);
      message(`已填入${preset.title}。可继续修改，或到“检测与核对”开始检测。`);
    } catch(error){if(!disposed)message(error.message||'预设加载失败，当前资料保持不变。','warning');}
    finally{loading=false;presetController=null;if(!disposed){controls();const button=container.querySelector(`[data-preset="${preset.id}"]`);if(document.activeElement===document.body && button?.checkVisibility())button.focus({preventScroll:true});}}
  }
  presetList.addEventListener('click',event=>{
    const button=event.target.closest('[data-preset]');if(!button)return;
    const preset=refundPresets.find(item=>item.id===button.dataset.preset);if(preset)void fillPreset(preset);
  });
  container.querySelector('[data-preset-undo]').addEventListener('click',async()=>{
    if(!presetUndo || disposed || loading || submitting || detection.busy)return;
    const previous=presetUndo;loading=true;controls();
    try {
      const result=await materials.replace(previous.files);if(disposed)return;
      if(!result.replaced)throw new Error('原图片无法恢复，当前材料保持不变。');
      for(const [key,value] of Object.entries(previous.fields))form.elements.namedItem(key).value=value;
      presetUndo=null;clearFieldErrors();renderImages();detection.setKinds(previous.kinds);
      message('已恢复填充前的资料与图片。');
    } catch(error){if(!disposed)message(error.message,'warning');}
    finally{loading=false;if(!disposed){controls();const field=form.elements.namedItem('caseNumber');if(document.activeElement===document.body && field.checkVisibility())field.focus({preventScroll:true});}}
  });
  function renderImages() {
    list.replaceChildren();
    for (const item of materials.items) {
      const li=document.createElement('li');
      li.className='refund-image-item';
      const previewButton=document.createElement('button');
      previewButton.type='button'; previewButton.className='refund-thumbnail';
      previewButton.dataset.preview=item.id; previewButton.setAttribute('aria-label',`预览 ${item.file.name}`);
      const image=document.createElement('img'); image.src=item.url; image.alt=item.file.name;
      previewButton.append(image);
      const body=document.createElement('div'); body.className='refund-image-info';
      const name=document.createElement('span'); name.textContent=item.file.name; name.title=item.file.name;
      const detail=document.createElement('small'); detail.textContent=`${sizeLabel(item.file.size)} · ${item.width} × ${item.height}`;
      const remove=document.createElement('button'); remove.type='button'; remove.className='refund-remove';
      remove.dataset.remove=item.id; remove.textContent='移除'; remove.setAttribute('aria-label',`移除 ${item.file.name}`);
      body.append(name,detail,remove); li.append(previewButton,body); list.append(li);
    }
    container.querySelector('[data-refund-count]').textContent=`${materials.items.length} / 10`;
    container.querySelector('[data-refund-empty]').hidden=materials.items.length>0;
    backend.reset();detection.sync();
  }
  async function addFiles(files) {
    if (disposed || submitting || detection.busy) return;
    if (loading) { message('图片正在读取，请稍候再添加。'); return; }
    if (!files.length) return;
    presetUndo=null;
    loading=true; controls(); message('正在读取图片…');
    try {
      const result=await materials.add(files);
      if (disposed) return;
      renderImages(); fileErrors.replaceChildren();
      for (const error of result.errors) {
        const li=document.createElement('li'); li.textContent=`${error.name}：${error.message}`; fileErrors.append(li);
      }
      fileErrors.hidden=!result.errors.length;
      message(`已添加 ${result.added} 张图片${result.errors.length ? `，${result.errors.length} 个文件未能添加，请查看原因。` : '，仅供当前页面预览，尚未上传。'}`, result.errors.length ? 'warning' : 'info');
    } finally { loading=false; if (!disposed) controls(); }
  }
  container.querySelector('[data-refund-choose]').addEventListener('click',()=>chooser.click());
  chooser.addEventListener('change',()=>{ const files=Array.from(chooser.files); chooser.value=''; void addFiles(files); });
  for (const type of ['dragenter','dragover','dragleave','drop']) drop.addEventListener(type,event=>{
    event.preventDefault();
    drop.classList.toggle('is-dragging',(type==='dragenter'||type==='dragover')&&!loading&&!submitting&&!detection.busy);
    if(type==='drop') void addFiles(Array.from(event.dataTransfer?.files || []));
  });
  list.addEventListener('click',event=>{
    if (loading || submitting || detection.busy) return;
    const button=event.target.closest('button');
    if (!button) return;
    if (button.dataset.remove) {
      presetUndo=null;
      const item=materials.items.find(value=>value.id===button.dataset.remove);
      materials.remove(button.dataset.remove); renderImages();
      message(`已移除 ${item.file.name}，其余资料保持不变。`);
      container.querySelector('[data-refund-choose]').focus();
    } else if (button.dataset.preview) {
      const item=materials.items.find(value=>value.id===button.dataset.preview);
      opener=button; dialogImage.src=item.url; dialogImage.alt=item.file.name;
      dialog.querySelector('h3').textContent=item.file.name;
      dialog.querySelector('[data-refund-preview-meta]').textContent=`${sizeLabel(item.file.size)} · ${item.width} × ${item.height} · 原图预览`;
      dialog.showModal(); dialog.querySelector('[data-refund-close]').focus();
    }
  });
  dialog.querySelector('[data-refund-close]').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('click',event=>{if(event.target===dialog) dialog.close();});
  dialog.addEventListener('close',()=>{dialogImage.removeAttribute('src'); if(opener?.isConnected) opener.focus();});
  form.addEventListener('input',event=>{
    const target=event.target;
    if (!target.name) return;
    presetUndo=null;
    target.removeAttribute('aria-invalid');
    const error=container.querySelector(`#refund-error-${target.name}`);
    if(error) error.hidden=true;
    if(status.dataset.kind==='success')status.hidden=true;
    backend.reset();detection.sync();
  });
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if (loading || submitting || disposed || detection.busy) return;
    const fields=readFields();
    const errors=validateRefundFields(fields);
    for (const key of Object.keys(fields)) {
      const error=container.querySelector(`#refund-error-${key}`);
      error.textContent=errors[key] || ''; error.hidden=!errors[key];
      form.elements.namedItem(key).setAttribute('aria-invalid',String(Boolean(errors[key])));
    }
    if (Object.keys(errors).length) {
      message('请补全标记的案件资料。','warning'); form.elements.namedItem(Object.keys(errors)[0]).focus(); return;
    }
    if (!materials.items.length) { message('请至少添加一张图片凭证。','warning'); container.querySelector('[data-refund-choose]').focus(); return; }
    submitting=true; controls(); requestController=new AbortController();
    message('正在提交材料…可以离开页面，离开将取消尚未完成的提交。');
    try {
      await refundSubmission.submit(fields,materials.items,{signal:requestController.signal});
      if(!disposed) {
        message('材料已准备，可以开始检测。','success');
        if(container.querySelector('.refund-main-tabs [data-tab="materials"]').getAttribute('aria-selected')==='true') {
          tabs.select('detection',{focus:true});
          container.querySelector('#refund-detection-title').scrollIntoView({block:'center'});
        }
      }
    } catch(error) { if(!disposed) message(error.message || '提交失败，材料仍保留在当前页面。','warning'); }
    finally { submitting=false; if(!disposed) controls(); }
  });
  container.querySelector('[data-report-pdf]').addEventListener('click',async()=>{
    if(!refundPdfExportAvailable || disposed || loading || submitting || detection.busy || !materials.items.length)return;
    exporting=true;submitting=true;pdfController=new AbortController();controls();message('正在生成当前结果的 PDF…');
    try {await downloadCurrentRefundPdf(readFields(),detection.entries,{signal:pdfController.signal,onProgress:progress=>{if(disposed)return;const text=progress.phase==='loading'?'正在准备 PDF 导出组件…':progress.phase==='saving'?'正在生成 PDF 文件…':progress.phase==='images'?`正在排版凭证 ${Math.min(progress.completed+1,progress.total)} / ${progress.total}…`:'正在整理报告内容…';message(text);}});if(!disposed)message('PDF 已导出。','success');}
    catch(error){if(!disposed)message(error.message||'PDF 导出失败，请重试。','warning');}
    finally{exporting=false;submitting=false;pdfController=null;if(!disposed)controls();}
  });
  void backend.status().then(value=>{
    if(disposed || value.version!==2)return;
    refundSubmission.configure(backend.submit);refundDetection.configure(backend.handlers);detection.setCapabilities(value.capabilities);backendReady=true;controls();
  }).catch(()=>{if(!disposed)message('分析服务暂时无法连接，请稍后刷新重试。','warning');});
  const onPageHide=event=>{dispose();if(event.persisted)window.addEventListener('pageshow',next=>{if(next.persisted)window.location.reload();},{once:true});};
  window.addEventListener('pagehide',onPageHide);
  const observer=new MutationObserver(()=>{if (!container.isConnected) dispose();});
  observer.observe(container.ownerDocument.body,{childList:true,subtree:true});
  function dispose() {
    if(disposed) return;
    disposed=true; observer.disconnect(); requestController?.abort();presetController?.abort();pdfController?.abort();backend.dispose();window.removeEventListener('pagehide',onPageHide);
    detection.dispose();
    if(dialog.open) dialog.close();
    materials.dispose();
  }
  return dispose;
}
