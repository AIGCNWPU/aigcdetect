import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdir} from 'node:fs/promises';
import {deflateRawSync} from 'node:zlib';
import {chromium} from '../tmp/browser-check/node_modules/playwright/index.mjs';
import {createServer} from '../scripts/serve.mjs';

function docx(xml) {
  const name=Buffer.from('word/document.xml'),body=Buffer.from(xml),packed=deflateRawSync(body);
  let crc=0xffffffff;for(const byte of body){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}crc=(crc^0xffffffff)>>>0;
  const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(8,8);local.writeUInt32LE(crc,14);local.writeUInt32LE(packed.length,18);local.writeUInt32LE(body.length,22);local.writeUInt16LE(name.length,26);
  const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(8,10);central.writeUInt32LE(crc,16);central.writeUInt32LE(packed.length,20);central.writeUInt32LE(body.length,24);central.writeUInt16LE(name.length,28);
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+packed.length,16);
  return Buffer.concat([local,name,packed,central,name,end]);
}
const egteClient={async analyze({segments}){return segments.map(item=>({segmentId:item.segmentId,status:'success',aiScore:.2,predictedLabel:0,documentTokens:40}));}};
const server=createServer({dist:process.argv.includes('--dist'),egteClient});server.listen(0,'127.0.0.1');await once(server,'listening');
const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(10000);
try{
  await page.goto(`http://127.0.0.1:${server.address().port}/#/text/novel`);
  const select=page.getByLabel('发布平台',{exact:true}),file=page.locator('[name=document]'),body=page.getByLabel('章节正文',{exact:true});
  assert.equal(await select.evaluate(node=>node.tagName),'SELECT');assert.equal(await select.locator('option').count(),8);
  await select.selectOption('jjwxc');assert.equal(await select.inputValue(),'jjwxc');
  await page.getByLabel('章节链接',{exact:true}).fill('https://read.zongheng.com/chapter/1419877/90785944.html');assert.equal(await select.inputValue(),'zongheng');
  await page.getByLabel('章节链接',{exact:true}).fill('https://example.com/chapter/1');assert.equal(await select.inputValue(),'unknown');
  await page.getByLabel('作品名称 *',{exact:true}).fill('文档导入验收');
  await page.getByRole('button',{name:/选择章节文档/}).scrollIntoViewIfNeeded();const scrollBefore=await page.evaluate(()=>scrollY);
  const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:/选择章节文档/}).click();await(await chooser).setFiles([]);
  assert.equal(await body.inputValue(),'');assert.ok(Math.abs(await page.evaluate(()=>scrollY)-scrollBefore)<5);
  const text='清晨，她走进村口的院落，认真核对昨夜留下的记录，再将新的线索逐条写在纸上，准备和同伴商量接下来的行程。';
  await file.setInputFiles({name:'第一章.txt',mimeType:'text/plain',buffer:Buffer.from('\uFEFF'+text+'\r\n第二段正文。')});
  await page.locator('[data-document-status]').filter({hasText:'正文已读取'}).waitFor();
  assert.equal(await body.inputValue(),text+'\n第二段正文。');assert.equal(await page.getByLabel('章节名称 *',{exact:true}).inputValue(),'第一章');
  await page.getByRole('button',{name:'添加章节',exact:true}).click();
  const xml='<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>第二章 &amp; 新线索</w:t><w:tab/><w:t>继续核查</w:t></w:r></w:p><w:p><w:r><w:t>'+text+'</w:t></w:r></w:p></w:body></w:document>';
  await file.setInputFiles({name:'第二章.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:docx(xml)});
  await page.locator('[data-document-status]').filter({hasText:'正文已读取'}).waitFor();assert.equal(await body.inputValue(),'第二章 & 新线索\t继续核查\n'+text);
  page.once('dialog',dialog=>dialog.dismiss());await file.setInputFiles({name:'覆盖.md',mimeType:'text/markdown',buffer:Buffer.from('不应替换')});
  await page.locator('[data-document-status]').filter({hasText:'已取消替换'}).waitFor();assert.match(await body.inputValue(),/第二章 & 新线索/);
  await file.setInputFiles({name:'损坏.docx',mimeType:'application/octet-stream',buffer:Buffer.from('broken')});
  await page.locator('[data-form-error]').filter({hasText:/文档损坏/}).waitFor();assert.match(await body.inputValue(),/第二章 & 新线索/);
  await file.setInputFiles({name:'旧文件.doc',mimeType:'application/msword',buffer:Buffer.from('old')});await page.locator('[data-form-error]').filter({hasText:/旧版 DOC/}).waitFor();
  await page.getByRole('button',{name:'添加章节',exact:true}).click();
  assert.equal(await page.locator('[data-chapter-list]>li').count(),2);
  await page.getByRole('tab',{name:'章节检测',exact:true}).click();await page.getByRole('checkbox',{name:/重复与水稿线索/}).uncheck();
  const request=page.waitForRequest(req=>req.url().endsWith('/text/novel')&&req.method()==='POST');await page.getByRole('button',{name:'检测已选章节',exact:true}).click();
  const payload=(await request).postDataJSON();assert.equal(payload.chapters.length,2);assert.equal(payload.chapters[0].content,text+'\n第二段正文。');assert.match(payload.chapters[1].content,/第二章 & 新线索/);
  await page.locator('[data-result-status]').filter({hasText:'已完成'}).waitFor();
  await page.getByRole('tab',{name:'作品与章节',exact:true}).click();await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  await mkdir('output/text-editor',{recursive:true});await page.locator('.novel-platform-select').screenshot({path:'output/text-editor/platform-native.png'});
  assert.deepEqual(errors,[]);console.log('Novel document passed: native platform, cancel without jump, TXT/DOCX preview, overwrite protection, invalid files and real text payload');
}catch(error){console.error({errors,body:(await page.locator('body').innerText()).slice(-1500)});throw error;}finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
