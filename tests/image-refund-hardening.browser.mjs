import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { chromium } from '../tmp/browser-check/node_modules/playwright/index.mjs';
import { createServer } from '../scripts/serve.mjs';

const server=createServer({dist:process.env.REFUND_TEST_DIST==='1'});
server.listen(0,'127.0.0.1');await once(server,'listening');
const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL || 'msedge',headless:true});
const labels={ai:'AI生成凭证检测',tamper:'局部篡改检测',comparison:'商品与描述核对'};

async function withCase(run){
  const page=await browser.newPage();page.setDefaultTimeout(5000);const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  try{
    await page.goto(`http://127.0.0.1:${server.address().port}/#/image/refund`);
    await page.getByLabel('案件编号',{exact:true}).fill('CASE-A');
    await page.getByLabel('商品名称',{exact:true}).fill('陶瓷杯');
    await page.getByLabel('问题描述',{exact:true}).fill('杯口破损');
    const png=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=20;return canvas.toDataURL().split(',')[1];});
    await page.locator('input[type=file]').setInputFiles({name:'凭证.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
    await page.waitForFunction(()=>document.querySelectorAll('.refund-image-item').length===1);
    await run(page);assert.deepEqual(errors,[]);
  }finally{await page.close();}
}

async function selectKind(page,kind){
  await page.getByRole('tab',{name:'检测与核对',exact:true}).click();
  for(const [value,label] of Object.entries(labels))await page.getByRole('checkbox',{name:label,exact:true}).setChecked(value===kind);
}

async function prepareRetry(page,kind){
  await selectKind(page,kind);
  await page.evaluate(kind=>window.Veritas.refundDetection.configure({[kind]:async()=>{throw Error('测试：服务暂时失败');}}),kind);
  await page.getByRole('button',{name:'开始检测',exact:true}).click();
  await page.waitForFunction(()=>!window.Veritas.refundDetection.busy);
  if(kind==='comparison')await page.getByRole('tab',{name:'商品核对',exact:true}).click();
  await page.getByRole('button',{name:`重试${labels[kind]}`,exact:true}).waitFor();
}

async function configurePending(page,kind){
  await page.evaluate(kind=>{
    window.resolveDetection=null;
    window.Veritas.refundDetection.configure({[kind]:({image})=>new Promise(resolve=>{
      window.resolveDetection=()=>resolve(kind==='comparison'
        ? {imageId:image.id,kind,summary:'测试：需要补充信息',coverage:'full',scope:'可见外观',checks:['appearance','style','issue'].map(dimension=>({dimension,outcome:'unknown',observed:'信息不足',evidence:'需要补充角度'}))}
        : {imageId:image.id,kind,risk:'low',summary:'测试结果',coverage:'full',scope:'整张图片',...(kind==='tamper'?{regions:[]}:{})});
    })});
  },kind);
}

async function finishDetection(page){
  await page.evaluate(()=>window.resolveDetection());
  await page.waitForFunction(()=>!window.Veritas.refundDetection.busy);
}

async function assertVisibleFocus(page,message){
  const valid=await page.evaluate(()=>{
    const active=document.activeElement;
    return active!==document.body && active.isConnected && active.checkVisibility() && !active.matches(':disabled');
  });
  assert.equal(valid,true,message);
}

try{
  await test('编辑任一案件字段后旧接收回执隐藏，未编辑时跨面板保留回执',()=>withCase(async page=>{
    await page.evaluate(()=>window.Veritas.refund.configure(async()=>({accepted:true,receiptId:'receipt-A'})));
    for(const [label,value] of [['案件编号','CASE-B'],['商品名称','玻璃杯'],['商品款式','蓝色'],['商品资料','透明杯身'],['问题描述','杯身裂纹']]){
      await page.getByRole('button',{name:'提交材料',exact:true}).click();
      const status=page.locator('[data-refund-status]');await status.filter({hasText:'receipt-A'}).waitFor();
      await page.getByRole('tab',{name:'案件汇总',exact:true}).click();
      await page.getByRole('tab',{name:'案件与凭证',exact:true}).click();
      assert.equal(await status.isVisible(),true);
      await page.getByLabel(label,{exact:true}).fill(value);
      assert.equal(await status.isVisible(),false,`${label}变化后不能继续显示旧回执`);
    }
  }));

  await test('提交期间切到汇总，处理状态与接收回执仍可见',()=>withCase(async page=>{
    await page.evaluate(()=>window.Veritas.refund.configure(()=>new Promise(resolve=>{window.resolveSubmission=resolve;})));
    await page.getByRole('button',{name:'提交材料',exact:true}).click();await page.waitForFunction(()=>window.Veritas.refund.busy);
    const summaryTab=page.getByRole('tab',{name:'案件汇总',exact:true});await summaryTab.click();
    const status=page.locator('[data-refund-status]');
    assert.equal(await status.isVisible(),true,'切到其他面板后提交中的状态仍应可见');
    await page.evaluate(()=>window.resolveSubmission({accepted:true,receiptId:'summary-receipt'}));
    await page.waitForFunction(()=>!window.Veritas.refund.busy);
    assert.equal(await status.isVisible(),true,'完成后不能把接收回执隐藏在材料面板');
    assert.match(await status.innerText(),/summary-receipt/);
    assert.equal(await summaryTab.evaluate(el=>el===document.activeElement),true);
  }));

  for(const kind of Object.keys(labels))await test(`${labels[kind]}键盘重试开始和完成后保持可见焦点`,()=>withCase(async page=>{
    await prepareRetry(page,kind);await configurePending(page,kind);
    await page.getByRole('button',{name:`重试${labels[kind]}`,exact:true}).focus();await page.keyboard.press('Enter');
    await page.waitForFunction(()=>window.resolveDetection);
    await assertVisibleFocus(page,'重试按钮消失后不能把焦点留在 BODY 或隐藏控件');
    await finishDetection(page);await assertVisibleFocus(page,'重试完成后仍应有可见焦点');
  }));

  await test('重试期间切换面板并操作筛选，完成时不抢回用户焦点',()=>withCase(async page=>{
    await prepareRetry(page,'ai');await configurePending(page,'ai');
    await page.getByRole('button',{name:'重试AI生成凭证检测',exact:true}).focus();await page.keyboard.press('Enter');
    await page.waitForFunction(()=>window.resolveDetection);
    await page.getByRole('tab',{name:'案件汇总',exact:true}).click();
    const filter=page.getByLabel('筛选凭证',{exact:true});await filter.focus();await filter.selectOption('incomplete');
    await finishDetection(page);
    assert.equal(await filter.evaluate(el=>el===document.activeElement),true);
    assert.equal(await page.getByRole('tab',{name:'案件汇总',exact:true}).getAttribute('aria-selected'),'true');
  }));

  await test('在任一主面板取消检测后焦点落在当前可见页签',()=>withCase(async page=>{
    await selectKind(page,'ai');
    for(const panel of ['检测与核对','案件与凭证','案件汇总']){
      await page.getByRole('tab',{name:'检测与核对',exact:true}).click();await configurePending(page,'ai');
      await page.getByRole('button',{name:'开始检测',exact:true}).click();await page.waitForFunction(()=>window.resolveDetection);
      await page.getByRole('tab',{name:panel,exact:true}).click();
      await page.getByRole('button',{name:'取消检测',exact:true}).focus();await page.keyboard.press('Enter');
      await page.waitForFunction(()=>!window.Veritas.refundDetection.busy);
      assert.equal(await page.getByRole('tab',{name:panel,exact:true}).evaluate(el=>el===document.activeElement),true);
      await assertVisibleFocus(page,'取消后不能聚焦隐藏面板');
    }
  }));

  await test('任务结束隐藏取消按钮时恢复当前页签；用户已移开焦点则保留',()=>withCase(async page=>{
    await selectKind(page,'ai');await configurePending(page,'ai');
    await page.getByRole('button',{name:'开始检测',exact:true}).click();await page.waitForFunction(()=>window.resolveDetection);
    const summaryTab=page.getByRole('tab',{name:'案件汇总',exact:true});await summaryTab.click();
    await page.getByRole('button',{name:'取消检测',exact:true}).focus();await finishDetection(page);
    assert.equal(await summaryTab.evaluate(el=>el===document.activeElement),true);
    await page.getByRole('tab',{name:'检测与核对',exact:true}).click();await configurePending(page,'ai');
    await page.getByRole('button',{name:'开始检测',exact:true}).click();await page.waitForFunction(()=>window.resolveDetection);
    await page.getByRole('button',{name:'取消检测',exact:true}).focus();await summaryTab.click();
    const filter=page.getByLabel('筛选凭证',{exact:true});await filter.focus();await finishDetection(page);
    assert.equal(await filter.evaluate(el=>el===document.activeElement),true);
  }));
}finally{
  await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
