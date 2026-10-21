import { createRefundMaterials, validateRefundFields } from '../refund/materials.js';
import { refundSubmission } from '../refund/submission.js';
import { mountRefundDetection } from '../refund/detection-view.js';

/** Material preparation and detection UI; services are configured through adapters. */
export function renderImageRefund(container) {
  container.classList.add('refund-workspace');
  container.innerHTML = `
    <div class="refund-intro"><div><h2>整理售后凭证</h2><p>填写案件资料，添加需要核查的商品图片。</p></div><span class="refund-local-tag">材料整理</span></div>
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
      <p class="refund-status" data-refund-status role="status" aria-live="polite" hidden></p>
    </form>
    <div data-refund-detection></div>
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
  const fileErrors=container.querySelector('[data-refund-errors]');
  const dialog=container.querySelector('dialog');
  const dialogImage=dialog.querySelector('img');
  let loading=false, submitting=false, disposed=false, opener=null, requestController=null;
  const readFields=()=>Object.fromEntries(['caseNumber','productName','style','productInfo','description'].map(key=>[key,form.elements.namedItem(key).value]));
  const detection=mountRefundDetection(container.querySelector('[data-refund-detection]'),{getFields:readFields,getImages:()=>materials.items,onBusyChange:controls,isBlocked:()=>loading||submitting});

  // A public frontend hook only; the backend's fields remain the adapter's responsibility.
  if (globalThis.Veritas) globalThis.Veritas.refund=refundSubmission;
  const sizeLabel=bytes=>bytes<1024*1024 ? `${Math.max(1,Math.round(bytes/1024))} KiB` : `${(bytes/1024/1024).toFixed(1)} MiB`;
  function message(text,kind='info') { status.textContent=text; status.dataset.kind=kind; status.hidden=false; }
  function controls() {
    container.querySelector('.refund-evidence').disabled=loading || submitting || detection.busy;
    container.querySelector('.refund-details').disabled=submitting || detection.busy;
    const submit=form.querySelector('[type=submit]');
    submit.disabled=loading || submitting || detection.busy;
    submit.textContent=submitting ? '正在提交…' : '提交材料';
    drop.setAttribute('aria-busy',String(loading));
    detection.refreshControls();
  }
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
    detection.sync();
  }
  async function addFiles(files) {
    if (disposed || submitting || detection.busy) return;
    if (loading) { message('图片正在读取，请稍候再添加。'); return; }
    if (!files.length) return;
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
    target.removeAttribute('aria-invalid');
    const error=container.querySelector(`#refund-error-${target.name}`);
    if(error) error.hidden=true;
    detection.sync();
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
      const result=await refundSubmission.submit(fields,materials.items,{signal:requestController.signal});
      if(!disposed) message(`后端已接收材料，回执：${result.receiptId}。这不代表检测已完成。`,'success');
    } catch(error) { if(!disposed) message(error.message || '提交失败，材料仍保留在当前页面。','warning'); }
    finally { submitting=false; if(!disposed) controls(); }
  });
  const observer=new MutationObserver(()=>{if (!container.isConnected) dispose();});
  observer.observe(container.ownerDocument.body,{childList:true,subtree:true});
  function dispose() {
    if(disposed) return;
    disposed=true; observer.disconnect(); requestController?.abort();
    detection.dispose();
    if(dialog.open) dialog.close();
    materials.dispose();
  }
  return dispose;
}
