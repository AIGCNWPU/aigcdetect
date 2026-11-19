import test from 'node:test';
import assert from 'node:assert/strict';
import {readChapterDocument} from '../src/modules/text/chapter-document.js';

test('小说文档保留正文，识别UTF-8、UTF-16和GB编码，不把文件名当作正文', async()=>{
  assert.equal(await readChapterDocument(new File(['\uFEFF第一章\r\n正文'],'章节.txt')),'第一章\n正文');
  assert.equal(await readChapterDocument(new File([Buffer.concat([Buffer.from([255,254]),Buffer.from('中文正文','utf16le')])],'章节.md')),'中文正文');
  assert.equal(await readChapterDocument(new File([new Uint8Array([0xd6,0xd0,0xce,0xc4])],'章节.txt')),'中文');
});

test('空文档、超限、旧DOC和损坏DOCX明确失败，不能送检文件元数据', async()=>{
  await assert.rejects(readChapterDocument(new File([],'空.txt')),/文档为空/);
  await assert.rejects(readChapterDocument({name:'大.docx',size:11*1024*1024}),/10 MB/);
  await assert.rejects(readChapterDocument(new File(['字'.repeat(100001)],'长.txt')),/100,000/);
  await assert.rejects(readChapterDocument(new File([' '],'空白.md')),/未读取/);
  await assert.rejects(readChapterDocument(new File(['a\0b'],'二进制.txt')),/格式不受支持/);
  await assert.rejects(readChapterDocument(new File(['old'],'旧.doc')),/旧版 DOC/);
  await assert.rejects(readChapterDocument(new File(['broken'],'损坏.docx')),/文档损坏/);
});
