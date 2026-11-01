import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_VIDEO_BYTES,
  defaultPerson,
  formatBytes,
  formatDuration,
  formatProbability,
  formatTimecode,
  materialVersion,
  normalizeDeepfakeResult,
  resultStats,
  validateVideoFile,
} from '../src/modules/video/deepfake/model.js';
import { createVideoDeepfakeSamples } from '../src/modules/video/deepfake/sample.js';
import { buildReportHtml, reportFileName } from '../src/modules/video/deepfake/report.js';
import { videoDeepfakeDetection } from '../src/modules/video/deepfake/detection.js';

const videoFile = (overrides = {}) => ({ name: 'interview.mp4', size: 8 * 1024 * 1024, type: 'video/mp4', lastModified: 1790000000000, ...overrides });
const messageOf = operation => {
  try {
    operation();
  } catch (error) {
    return error.message;
  }
  throw new Error('预期操作抛出异常，但没有抛出。');
};

test('视频时长、时间码、文件大小与材料版本格式化',()=>{
  assert.equal(formatDuration(0),'00:00');
  assert.equal(formatDuration(128),'02:08');
  assert.equal(formatDuration(3661),'1:01:01');
  assert.equal(formatDuration(186.5),'03:07');
  assert.equal(formatTimecode(18.6),'00:18.6');
  assert.equal(formatTimecode(66.2),'01:06.2');
  assert.equal(formatTimecode(0),'00:00.0');
  assert.equal(formatTimecode(3661),'1:01:01.0');
  assert.equal(formatBytes(1024),'1.0 KiB');
  assert.equal(formatBytes(1024*1024),'1.0 MiB');
  assert.equal(formatBytes(0),'0 B');
  assert.equal(formatProbability(0.968),'96.8%');
  assert.equal(formatProbability(0.5),'50.0%');
  assert.equal(formatProbability(0),'0.0%');
  assert.equal(formatProbability(null),'未提供');
  const version=materialVersion(videoFile());
  assert.match(version,/^v[0-9A-Z]{7}$/);
  assert.equal(version,materialVersion(videoFile()));
  assert.notEqual(version,materialVersion(videoFile({size:9*1024*1024})));
  assert.notEqual(version,materialVersion(videoFile({lastModified:1790000000001})));
});

test('人物视频只接受 MP4/WebM、非空且不超过上限',()=>{
  assert.equal(validateVideoFile(videoFile()).ok,true);
  assert.equal(validateVideoFile(videoFile({name:'CLIP.WEBM',type:'video/webm'})).ok,true);
  assert.match(validateVideoFile(videoFile({name:'clip.mov'})).message,/MP4 或 WebM/);
  assert.match(validateVideoFile(videoFile({name:'clip.txt'})).message,/MP4 或 WebM/);
  assert.match(validateVideoFile(videoFile({type:'text/plain'})).message,/不是视频/);
  assert.match(validateVideoFile(videoFile({size:0})).message,/为空/);
  assert.match(validateVideoFile(videoFile({size:MAX_VIDEO_BYTES+1})).message,/不能超过/);
  assert.equal(validateVideoFile(null).ok,false);
});

test('样例包含多人物、逐人物片段与人脸画面且明确标注',()=>{
  const samples=createVideoDeepfakeSamples();
  assert.equal(samples.length,2);
  assert.equal(new Set(samples.map(item=>item.id)).size,2);
  const [interview,meeting]=samples;
  assert.equal(interview.sample,true);
  assert.equal(interview.result.persons.length,2);
  assert.equal(interview.result.risk,'high');
  assert.equal(resultStats(interview.result).segments,2);
  assert.equal(resultStats(interview.result).suspiciousPersons,1);
  assert.equal(interview.result.faceFrames,73);
  assert.equal(interview.result.aiProbability,0.968);
  assert.equal(meeting.result.aiProbability,0.612);
  assert.equal(meeting.result.persons.length,3);
  assert.equal(meeting.result.risk,'medium');
  assert.equal(resultStats(meeting.result).persons,3);
  assert.equal(meeting.result.persons.find(person=>person.coverage==='partial').label,'人物 E · 参会者 2');
  const defaultPersonInterview=defaultPerson(interview.result);
  assert.equal(defaultPersonInterview.risk,'high');
  assert.equal(defaultPersonInterview.segments.length,2);
  assert.ok(interview.result.persons[0].frames.every(frame=>frame.image.startsWith('data:image/svg+xml')));
  assert.ok(interview.result.persons[0].segments.every(segment=>interview.result.persons[0].frames.some(frame=>frame.id===segment.frameId)));
  const art=decodeURIComponent(interview.result.persons[0].frames[0].image.split(',')[1]);
  assert.match(art,/width="640" height="360"/);
  assert.match(art,/样例人脸/);
  const normalized=normalizeDeepfakeResult(interview.result);
  assert.equal(normalized.persons.length,2);
  assert.equal(normalized.persons[0].segments.length,2);
});

test('适配器结果严格校验人物、人脸画面、片段和整体风险一致性',()=>{
  const result=structuredClone(createVideoDeepfakeSamples()[0].result);
  assert.equal(normalizeDeepfakeResult(result).risk,'high');
  assert.equal(normalizeDeepfakeResult(result).aiProbability,0.968);
  const badAiProbability=structuredClone(result);badAiProbability.aiProbability=1.2;
  assert.match(messageOf(()=>normalizeDeepfakeResult(badAiProbability)),/AI概率无效/);
  const noPersonAiProbability=structuredClone(result);noPersonAiProbability.persons=[];noPersonAiProbability.risk='unknown';noPersonAiProbability.aiProbability=0.5;
  assert.match(messageOf(()=>normalizeDeepfakeResult(noPersonAiProbability)),/不能给出AI概率/);
  assert.match(messageOf(()=>normalizeDeepfakeResult({...result,risk:'certain'})),/风险等级/);
  assert.match(messageOf(()=>normalizeDeepfakeResult({...result,summary:''})),/检测结论缺失/);
  assert.match(messageOf(()=>normalizeDeepfakeResult({...result,coverage:'mostly'})),/覆盖范围/);
  assert.match(messageOf(()=>normalizeDeepfakeResult(result,{expectedDuration:10})),/时长与视频不一致/);
  const noDuration=structuredClone(result);delete noDuration.duration;
  assert.equal(normalizeDeepfakeResult(noDuration,{expectedDuration:128}).duration,128);
  const noPersons=structuredClone(result);noPersons.persons=[];noPersons.risk='low';
  assert.match(messageOf(()=>normalizeDeepfakeResult(noPersons)),/不能给出确定风险等级/);
  const unknownNoPersons=structuredClone(noPersons);unknownNoPersons.risk='unknown';unknownNoPersons.aiProbability=null;
  assert.equal(normalizeDeepfakeResult(unknownNoPersons).persons.length,0);
  const lowOverall=structuredClone(result);lowOverall.risk='low';
  assert.match(messageOf(()=>normalizeDeepfakeResult(lowOverall)),/综合风险不能低于/);
  const unknownOverall=structuredClone(result);unknownOverall.risk='unknown';
  assert.equal(normalizeDeepfakeResult(unknownOverall).risk,'unknown');
  const duplicatePerson=structuredClone(result);duplicatePerson.persons[1].id=duplicatePerson.persons[0].id;
  assert.match(messageOf(()=>normalizeDeepfakeResult(duplicatePerson)),/人物标识重复/);
  const duplicateFrame=structuredClone(result);duplicateFrame.persons[1].frames[0].id=duplicateFrame.persons[0].frames[0].id;
  assert.match(messageOf(()=>normalizeDeepfakeResult(duplicateFrame)),/人脸画面标识重复/);
  const duplicateSegment=structuredClone(result);duplicateSegment.persons[1].segments=[structuredClone(duplicateSegment.persons[0].segments[0])];
  assert.match(messageOf(()=>normalizeDeepfakeResult(duplicateSegment)),/可疑时间段标识重复/);
  const badSegment=structuredClone(result);badSegment.persons[0].segments[0].end=badSegment.persons[0].segments[0].start-1;
  assert.match(messageOf(()=>normalizeDeepfakeResult(badSegment)),/起止时间/);
  const lateSegment=structuredClone(result);lateSegment.persons[0].segments[0].start=result.duration+0.1;lateSegment.persons[0].segments[0].end=result.duration+0.2;
  assert.match(messageOf(()=>normalizeDeepfakeResult(lateSegment)),/起止时间/);
  const crossPersonFrame=structuredClone(result);
  crossPersonFrame.persons[1].segments=[{
    id:'cross-person',start:20,end:22,risk:'medium',summary:'测试片段',
    frameId:crossPersonFrame.persons[0].frames[0].id,
  }];
  assert.match(messageOf(()=>normalizeDeepfakeResult(crossPersonFrame)),/其他人物或不存在的画面/);
  const missingFrame=structuredClone(result);missingFrame.persons[0].segments[0].frameId='missing-frame';
  assert.match(messageOf(()=>normalizeDeepfakeResult(missingFrame)),/其他人物或不存在的画面/);
  const invalidImage=structuredClone(result);invalidImage.persons[0].frames[0].image='javascript:alert(1)';
  assert.equal(normalizeDeepfakeResult(invalidImage).persons[0].frames[0].image,'');
  const partial=structuredClone(result);partial.coverage='partial';partial.persons[1].coverage='partial';
  assert.equal(normalizeDeepfakeResult(partial).persons[1].coverage,'partial');
  const badSignals=structuredClone(result);badSignals.persons[0].segments[0].signals='边缘重复';
  assert.match(messageOf(()=>normalizeDeepfakeResult(badSignals)),/面部合成线索格式/);
  const badQuality=structuredClone(result);badQuality.persons[0].frames[0].quality=120;
  assert.match(messageOf(()=>normalizeDeepfakeResult(badQuality)),/清晰度/);
  const badPresence=structuredClone(result);badPresence.persons[0].lastSeen=200;
  assert.match(messageOf(()=>normalizeDeepfakeResult(badPresence)),/出现时间/);
});

test('报告导出汇总各人物、片段、人脸画面并转义外部文本',()=>{
  const [sample]=createVideoDeepfakeSamples();
  const task={...sample,name:'<img src=x onerror=alert(1)> 访谈.mp4'};
  const html=buildReportHtml({task,result:sample.result,generatedAt:new Date('2026-10-21T10:00:00+08:00')});
  assert.match(html,/VERITAS 智鉴/);
  assert.match(html,/人物换脸与深度伪造检测报告/);
  assert.match(html,/样例数据/);
  assert.match(html,/材料版本 SAMPLE-01/);
  assert.match(html,/人物汇总/);
  assert.match(html,/AI生成概率/);
  assert.match(html,/96.8%（未校准）/);
  assert.match(html,/人物 A · 左侧受访者/);
  assert.match(html,/可疑时间段（2）/);
  assert.match(html,/人脸画面（6）/);
  assert.match(html,/data:image\/svg\+xml/);
  assert.match(html,/打印 \/ 另存为 PDF/);
  assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.equal(html.includes('<img src=x onerror=alert(1)>'),false);
  const injected=structuredClone(sample.result);injected.summary='<script>alert(1)</script>';
  injected.persons[0].summary='<img src=x onerror=alert(2)>';
  const safeHtml=buildReportHtml({task:sample,result:injected});
  assert.equal(safeHtml.includes('<script>alert(1)</script>'),false);
  assert.match(safeHtml,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.equal(safeHtml.includes('<img src=x onerror=alert(2)>'),false);
  const noPersons=structuredClone(sample.result);
  noPersons.risk='unknown';noPersons.persons=[];noPersons.faceFrames=0;noPersons.aiProbability=null;
  noPersons.summary='未识别到可用于检测的人脸画面。';
  const emptyHtml=buildReportHtml({task:sample,result:noPersons});
  assert.match(emptyHtml,/未识别到可用于检测的人物画面/);
  assert.match(emptyHtml,/无法判断/);
});

test('报告文件名去除路径字符并保持 HTML 后缀',()=>{
  const name=reportFileName({name:'目录/访谈:*?"<>| 01.mp4'},new Date(2026,9,21,9,5));
  assert.equal(name.startsWith('VERITAS-深度伪造检测报告-'),true);
  assert.equal(name.endsWith('.html'),true);
  assert.equal(/[\\/:*?"<>|\s]/.test(name.replace(/^VERITAS-深度伪造检测报告-/,'')),false);
  assert.equal(name.includes('20261021-0905'),true);
});

test('检测适配器未配置时拒绝提交，配置后校验结果并约束进度',async()=>{
  videoDeepfakeDetection.configure(null);
  await assert.rejects(
    () => videoDeepfakeDetection.run({file:{name:'clip.mp4'}}),
    error => error.code === 'NOT_CONFIGURED' && /尚未接入/.test(error.message),
  );
  const [sample]=createVideoDeepfakeSamples();
  const seen=[];
  const unsubscribe=videoDeepfakeDetection.subscribe(configured=>seen.push(configured));
  let progress=null;
  videoDeepfakeDetection.configure(async (_input,{onProgress})=>{
    onProgress({stage:'  识别人脸画面  ',percent:150});
    return sample.result;
  });
  const output=await videoDeepfakeDetection.run(
    {file:{name:'clip.mp4'},metadata:{duration:128}},
    {onProgress:value=>{progress=value;}},
  );
  assert.equal(output.persons.length,2);
  assert.deepEqual(progress,{stage:'识别人脸画面',percent:100});
  assert.deepEqual(seen,[true]);
  videoDeepfakeDetection.configure(async()=>({risk:'low',summary:'无人物',coverage:'full',scope:'全片',duration:128,sampledFrames:1,faceFrames:0,persons:[]}));
  await assert.rejects(
    () => videoDeepfakeDetection.run({file:{name:'clip.mp4'},metadata:{duration:128}}),
    /不能给出确定风险等级/,
  );
  videoDeepfakeDetection.configure(null);
  unsubscribe();
  await assert.rejects(
    () => videoDeepfakeDetection.run({file:{name:'clip.mp4'}}),
    error => error.code === 'NOT_CONFIGURED',
  );
});
