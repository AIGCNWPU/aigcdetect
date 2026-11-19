import test from 'node:test';
import assert from 'node:assert/strict';
import { createReviewDrafts, reviewDocuments, resolveReviewAnchor, partitionReviewHighlights, buildReviewEntries, proofreadingRecords, commonEvidenceText } from '../src/modules/text/review-model.js';

test('复核编辑草稿独立于送检快照并按章节共享，支持撤销与检测锁定', () => {
  const input=[{id:'c1',title:'甲',content:'原文😀'}, {id:'c2',title:'乙',content:'另一章'}], drafts=createReviewDrafts({maxLength:20});
  let changes=0;drafts.subscribe(()=>changes++);drafts.reset(input);drafts.set('c1','编辑😀\n正文');
  assert.equal(input[0].content,'原文😀');assert.equal(drafts.changed('c1'),true);assert.equal(drafts.changed('c2'),false);
  assert.equal(drafts.documents()[1].content,'另一章');const snapshot=drafts.documents();snapshot[0].content='外部变更';
  assert.equal(drafts.content('c1'),'编辑😀\n正文');
  assert.throws(()=>drafts.set('missing','正文'),/找不到/);assert.throws(()=>drafts.set('c1','长'.repeat(21)),/不能超过/);
  drafts.setBusy(true);assert.throws(()=>drafts.set('c1','新稿'),/正在检测/);drafts.revert();assert.equal(drafts.changed(),true);
  drafts.setBusy(false);drafts.revert();assert.equal(drafts.changed(),false);assert.equal(drafts.content('c1'),'原文😀');
  drafts.reset([{id:'c1',content:'新回执原文'}]);assert.equal(drafts.changed(),false);assert.equal(drafts.content('c1'),'新回执原文');assert.ok(changes>4);
});

test('复核定位严格验证UTF-16原文与送检快照，不猜测重复引用的位置', () => {
  const content = '😀开场。\r\n  同一句话。同一句话。\n结尾。', docs = reviewDocuments([{ id: 'news', content }]);
  const start = content.lastIndexOf('同一句话');
  assert.equal(resolveReviewAnchor(docs, { absoluteStart: start, absoluteEnd: start + 4, quote: '同一句话' }).start, start);
  assert.equal(resolveReviewAnchor(docs, { start: 1, end: 2, text: content.slice(1, 2) }, { absolute: true }), null);
  assert.equal(resolveReviewAnchor(docs, { absoluteStart: start, absoluteEnd: start + 4, quote: '已改正文' }), null);
  assert.equal(resolveReviewAnchor(docs, { start: -1, end: 4, quote: '同一句话', paragraphIndex: 2 }), null);
  assert.equal(resolveReviewAnchor(docs, { quote: '同一句话' }), null);
  const anchor = resolveReviewAnchor(docs, { paragraphIndex: 2, start: 5, end: 9, quote: '同一句话' });
  assert.equal(anchor.start, start);
  assert.equal(content.slice(anchor.contextStart, anchor.contextEnd), content);
});

test('跨章定位使用章节ID而非相同标题或全书首次出现的位置', () => {
  const docs = reviewDocuments([{ id: 'c1', title: '同名章节', content: '前言\n重复内容在这里出现。' }, { id: 'c2', title: '同名章节', content: '这是不同长度的前言。\n重复内容在这里出现。' }]);
  const ref = { chapterId: 'c2', paragraphIndex: 2, start: 0, end: 10, quote: '重复内容在这里出现。' };
  const anchor = resolveReviewAnchor(docs, ref);
  assert.equal(anchor.documentId, 'c2');
  assert.equal(anchor.start, docs[1].content.indexOf(ref.quote));
  assert.equal(resolveReviewAnchor(docs, { ...ref, chapterId: 'missing' }), null);
  assert.equal(resolveReviewAnchor(docs, { ...ref, chapterId: undefined, chapter: '同名章节' }), null);
});

test('重叠高亮保持全部原文与关联关系，包括同ID重叠和特殊HTML字符', () => {
  const text = '<img>😀ab&cd', result = partitionReviewHighlights(text, [{ id: 'a', start: 0, end: 9 }, { id: 'a', start: 7, end: 11 }, { id: 'b', start: 8, end: 12 }]);
  assert.equal(result.map(item => item.text).join(''), text);
  assert.deepEqual(result.find(item => item.start === 9).ids, ['a', 'b']);
  assert.deepEqual(partitionReviewHighlights('😀', [{ id: 'bad', start: 1, end: 2 }]), [{ start: 0, end: 2, text: '😀', ids: [] }]);
});

test('无换行长章按小说既有900字虚拟段落核对证据，避免套用新闻段落', () => {
  const content = Array.from({ length: 35 }, (_, i) => `第${i + 1}句${'甲'.repeat(70)}。`).join('');
  const docs = reviewDocuments([{ id: 'c1', content }], { virtualParagraphChars: 900 });
  const paragraph = docs[0].paragraphs[1], quote = paragraph.text.slice(0, 12);
  const reference = { chapterId: 'c1', paragraphIndex: 2, start: 0, end: quote.length, quote };
  assert.equal(resolveReviewAnchor(docs, reference).start, paragraph.start);
  assert.equal(resolveReviewAnchor(reviewDocuments([{ id: 'c1', content }]), reference), null);
});

test('六阶段同一问题共享稳定处理键，其他问题仍独立', () => {
  const docs = reviewDocuments([{ id: 'news', content: '这是需要人工核实的原文。' }]);
  const issue = { type: '用词', message: '核实该表述', position: { paragraphId: 'p-0001', paragraphIndex: 1, absoluteStart: 0, absoluteEnd: 2, quote: '这是' } };
  const records = proofreadingRecords({ stages: [{ name: '初审', issues: [issue] }, { name: '复审', issues: [issue, { ...issue, message: '另一个问题' }] }] });
  const entries = buildReviewEntries('proofreading', records, docs);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0].occurrences, [0, 1]);
  assert.deepEqual(entries[0].stageNames, ['初审', '复审']);
  assert.equal(buildReviewEntries('proofreading', records, docs)[0].key, entries[0].key);
  const longer = { ...issue, position: { ...issue.position, absoluteEnd: 4, quote: '这是需要' } };
  assert.equal(buildReviewEntries('proofreading', [issue, longer], docs).length, 1);
});

test('并排证据只突出字面相同部分，不把短共用词或语义相似当作相同原文', () => {
  assert.equal(commonEvidenceText('雨夜里众人终于回到城门前。', '天亮前众人终于回到城门前。'), '众人终于回到城门前。');
  assert.equal(commonEvidenceText('他说可以。', '他说不行。'), '');
  assert.equal(commonEvidenceText('向东走。', '前往东方。'), '');
  assert.equal(commonEvidenceText('甲😀这里是完整相同文字乙', '丙😀这里是完整相同文字丁'), '😀这里是完整相同文字');
});
