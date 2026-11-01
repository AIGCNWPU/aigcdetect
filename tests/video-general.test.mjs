import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_VIDEO_BYTES, formatBytes, formatDuration, formatTimecode, normalizeDetectionResult, validateVideoFile } from '../src/modules/video/general/model.js';
import { createVideoGeneralSamples } from '../src/modules/video/general/sample.js';
import { buildReportHtml, reportFileName } from '../src/modules/video/general/report.js';
import { videoGeneralDetection } from '../src/modules/video/general/detection.js';

const videoFile = (overrides = {}) => ({ name: 'clip.mp4', size: 1024 * 1024, type: 'video/mp4', ...overrides });
const messageOf = operation => {
  try {
    operation();
  } catch (error) {
    return error.message;
  }
  throw new Error('预期操作抛出异常，但没有抛出。');
};

test('视频时长、时间码与文件大小格式化',()=>{
  assert.equal(formatDuration(0),'00:00');
  assert.equal(formatDuration(96),'01:36');
  assert.equal(formatDuration(3661),'1:01:01');
  assert.equal(formatDuration(42.6),'00:43');
  assert.equal(formatTimecode(12.4),'00:12.4');
  assert.equal(formatTimecode(4.2),'00:04.2');
  assert.equal(formatTimecode(0),'00:00.0');
  assert.equal(formatTimecode(3661),'1:01:01.0');
  assert.equal(formatBytes(1024),'1.0 KiB');
  assert.equal(formatBytes(1024*1024),'1.0 MiB');
  assert.equal(formatBytes(0),'0 B');
});

test('视频文件选择只接受 MP4/WebM、非空且不超过上限',()=>{
  assert.equal(validateVideoFile(videoFile()).ok,true);
  assert.equal(validateVideoFile(videoFile({name:'CLIP.WEBM',type:'video/webm'})).ok,true);
  assert.match(validateVideoFile(videoFile({name:'clip.mov'})).message,/MP4 或 WebM/);
  assert.match(validateVideoFile(videoFile({name:'clip.txt'})).message,/MP4 或 WebM/);
  assert.match(validateVideoFile(videoFile({type:'text/plain'})).message,/不是视频/);
  assert.match(validateVideoFile(videoFile({size:0})).message,/为空/);
  assert.match(validateVideoFile(videoFile({size:MAX_VIDEO_BYTES+1})).message,/不能超过/);
  assert.equal(validateVideoFile(null).ok,false);
});

test('样例数据使用统一结果结构且明确可区分风险与覆盖范围',()=>{
  const samples=createVideoGeneralSamples();
  assert.equal(samples.length,2);
  assert.equal(new Set(samples.map(item=>item.id)).size,2);
  const [brand,travel]=samples;
  assert.equal(brand.sample,true);
  assert.equal(brand.result.risk,'high');
  assert.equal(brand.result.segments.length,3);
  assert.equal(brand.result.frames.length,8);
  assert.equal(brand.result.coverage,'full');
  assert.ok(brand.result.frames.every(frame=>frame.image.startsWith('data:image/svg+xml')));
  assert.equal(travel.result.risk,'low');
  assert.equal(travel.result.segments.length,0);
  assert.equal(travel.result.frames.length,5);
  const normalized=normalizeDetectionResult(brand.result);
  assert.equal(normalized.segments.length,3);
  assert.equal(normalized.frames.length,8);
});

test('适配器结果严格校验时长、时间段、代表画面与风险字段',()=>{
  const result=structuredClone(createVideoGeneralSamples()[0].result);
  assert.equal(normalizeDetectionResult(result).risk,'high');
  assert.match(messageOf(()=>normalizeDetectionResult({...result,risk:'certain'})),/风险等级/);
  assert.match(messageOf(()=>normalizeDetectionResult({...result,summary:''})),/检测结论缺失/);
  assert.match(messageOf(()=>normalizeDetectionResult({...result,coverage:'mostly'})),/覆盖范围/);
  assert.match(messageOf(()=>normalizeDetectionResult(result,{expectedDuration:10})),/时长与视频不一致/);
  const noDuration=structuredClone(result);delete noDuration.duration;
  assert.equal(normalizeDetectionResult(noDuration,{expectedDuration:96}).duration,96);
  const badSegment=structuredClone(result);badSegment.segments[0].end=badSegment.segments[0].start-1;
  assert.match(messageOf(()=>normalizeDetectionResult(badSegment)),/起止时间/);
  const lateSegment=structuredClone(result);lateSegment.segments[0].start=result.duration+0.1;lateSegment.segments[0].end=result.duration+0.2;
  assert.match(messageOf(()=>normalizeDetectionResult(lateSegment)),/起止时间/);
  const duplicateFrame=structuredClone(result);duplicateFrame.frames[1].id=duplicateFrame.frames[0].id;
  assert.match(messageOf(()=>normalizeDetectionResult(duplicateFrame)),/代表画面标识重复/);
  const missingFrame=structuredClone(result);missingFrame.segments[0].frameId='missing-frame';
  assert.match(messageOf(()=>normalizeDetectionResult(missingFrame)),/不存在的代表画面/);
  const invalidImage=structuredClone(result);invalidImage.frames[0].image='javascript:alert(1)';
  assert.equal(normalizeDetectionResult(invalidImage).frames[0].image,'');
  const partial=structuredClone(result);partial.coverage='partial';
  assert.equal(normalizeDetectionResult(partial).coverage,'partial');
  const badFindings=structuredClone(result);badFindings.findings='线索';
  assert.match(messageOf(()=>normalizeDetectionResult(badFindings)),/线索格式/);
});

test('报告导出包含片段、代表画面并转义外部文本',()=>{
  const [sample]=createVideoGeneralSamples();
  const task={...sample,name:'<img src=x onerror=alert(1)> 品牌短片.mp4'};
  const html=buildReportHtml({task,result:sample.result,generatedAt:new Date('2026-10-21T10:00:00+08:00')});
  assert.match(html,/VERITAS 智鉴/);
  assert.match(html,/样例数据/);
  assert.equal(html.includes('<h2>检测范围</h2>'),false);
  assert.equal(html.includes('<small>检测覆盖</small>'),false);
  assert.equal(html.includes('<small>采样画面</small>'),false);
  assert.equal(html.includes('阈值尚未校准'),false);
  assert.match(html,/可疑时间段（3）/);
  assert.match(html,/代表画面（8）/);
  assert.match(html,/data:image\/svg\+xml/);
  assert.match(html,/打印 \/ 另存为 PDF/);
  assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.equal(html.includes('<img src=x onerror=alert(1)>'),false);
  const injected=structuredClone(sample.result);injected.summary='<script>alert(1)</script>';
  const safeHtml=buildReportHtml({task:sample,result:injected});
  assert.equal(safeHtml.includes('<script>alert(1)</script>'),false);
  assert.match(safeHtml,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('对外文案与报告统一显示智鉴，不暴露上游引擎名称',()=>{
  const source=structuredClone(createVideoGeneralSamples()[0].result);
  source.summary='Native-Scale 对 12 个采样窗口进行视觉伪造检测，窗口模型得分均值 48%、最大 67%。';
  source.findings=['Native-Scale 窗口得分均值 48%、最大 67%。'];
  source.meta={method:'Native-Scale (ICLR 2026)'};
  const result=normalizeDetectionResult(source);
  assert.equal(result.summary,'智鉴对 12 个采样窗口进行视觉伪造检测，窗口模型得分均值 48%、最大 67%。');
  assert.deepEqual(result.findings,['智鉴 窗口得分均值 48%、最大 67%。']);
  assert.equal(result.meta.method,'智鉴');
  const html=buildReportHtml({task:{name:'clip.mp4',sample:false},result,generatedAt:new Date('2026-10-21T10:00:00+08:00')});
  assert.doesNotMatch(html,/Native-Scale/i);
  assert.match(html,/检测模型<\/h2><p>智鉴<\/p>/);
  assert.match(html,/智鉴对 12 个采样窗口/);
});

test('可疑片段的视觉复核进入页面模型与导出报告',()=>{
  const source=structuredClone(createVideoGeneralSamples()[0].result);
  source.segments[0].explanation='人物手指与杯壁交界处边缘发虚，局部纹理重复，建议人工复核。';
  source.meta={method:'智鉴',explanation:{status:'ok'}};
  const result=normalizeDetectionResult(source);
  assert.equal(result.segments[0].explanation,'人物手指与杯壁交界处边缘发虚，局部纹理重复，建议人工复核。');
  assert.equal(result.meta.explanationStatus,'ok');
  const html=buildReportHtml({task:{name:'clip.mp4',sample:false},result,generatedAt:new Date('2026-10-21T10:00:00+08:00')});
  assert.match(html,/视觉复核：人物手指/);
  assert.match(html,/画面复核说明/);
  const tooLong=structuredClone(source);tooLong.segments[0].explanation='痕'.repeat(501);
  assert.match(messageOf(()=>normalizeDetectionResult(tooLong)),/视觉复核/);
  const failed=structuredClone(source);failed.meta={method:'智鉴',explanation:{status:'failed'}};
  assert.equal(normalizeDetectionResult(failed).meta.explanationStatus,undefined);
});

test('多个可疑片段的视觉复核都进入页面模型与报告',()=>{
  const source=structuredClone(createVideoGeneralSamples()[0].result);
  source.segments[0].summary='第 1 窗口的视觉检测得分达到提示阈值，AI生成模型得分 67%；不代表逐帧定位或确定性结论。';
  source.segments[0].explanation='第一段复核：手指边缘融合。';
  source.segments[1].explanation='第二段复核：水面纹理重复。';
  source.meta={method:'智鉴',explanation:{status:'ok'}};
  const result=normalizeDetectionResult(source);
  assert.equal(result.segments.filter(segment=>segment.explanation).length,2);
  const html=buildReportHtml({task:{name:'clip.mp4',sample:false},result,generatedAt:new Date('2026-10-21T10:00:00+08:00')});
  assert.match(html,/视觉复核：第一段复核/);
  assert.match(html,/视觉复核：第二段复核/);
  assert.equal(html.includes('第 1 窗口的视觉检测得分达到提示阈值'),false);
  assert.equal((html.match(/视觉复核：/g)||[]).length >= 2,true);
});

test('检测结果保留整片AI概率并用于报告概览',()=>{
  const source=structuredClone(createVideoGeneralSamples()[0].result);
  source.meta={method:'智鉴',videoScore:0.5787};
  const result=normalizeDetectionResult(source);
  assert.equal(result.meta.aiProbability,0.5787);
  const html=buildReportHtml({task:{name:'clip.mp4',sample:false},result});
  assert.match(html,/AI概率：58%/);
  const zero=structuredClone(source);zero.meta={method:'智鉴',videoScore:0};
  assert.equal(normalizeDetectionResult(zero).meta.aiProbability,0);
  const missing=structuredClone(source);missing.meta={method:'智鉴'};
  assert.equal(normalizeDetectionResult(missing).meta.aiProbability,undefined);
  const outOfRange=structuredClone(source);outOfRange.meta={method:'智鉴',videoScore:1.2};
  assert.equal(normalizeDetectionResult(outOfRange).meta.aiProbability,undefined);
});

test('报告文件名去除路径字符并保持 HTML 后缀',()=>{
  const name=reportFileName({name:'目录/片段:*?"<>| 01.mp4'},new Date(2026,9,21,9,5));
  assert.equal(name.startsWith('VERITAS-视频检测报告-'),true);
  assert.equal(name.endsWith('.html'),true);
  assert.equal(/[\\/:*?"<>|\s]/.test(name.replace(/^VERITAS-视频检测报告-/,'')),false);
  assert.equal(name.includes('20261021-0905'),true);
});

test('检测适配器未配置时拒绝提交，配置后校验结果并约束进度',async()=>{
  videoGeneralDetection.configure(null);
  await assert.rejects(
    () => videoGeneralDetection.run({file:{name:'clip.mp4'}}),
    error => error.code === 'NOT_CONFIGURED' && /尚未接入/.test(error.message),
  );
  const [sample]=createVideoGeneralSamples();
  const seen=[];
  const unsubscribe=videoGeneralDetection.subscribe(configured=>seen.push(configured));
  let progress=null;
  videoGeneralDetection.configure(async (_input,{onProgress})=>{
    onProgress({stage:'  采样画面  ',percent:150});
    return sample.result;
  });
  const output=await videoGeneralDetection.run(
    {file:{name:'clip.mp4'},metadata:{duration:96}},
    {onProgress:value=>{progress=value;}},
  );
  assert.equal(output.risk,'high');
  assert.deepEqual(progress,{stage:'采样画面',percent:100});
  assert.deepEqual(seen,[true]);
  videoGeneralDetection.configure(null);
  unsubscribe();
  await assert.rejects(
    () => videoGeneralDetection.run({file:{name:'clip.mp4'}}),
    error => error.code === 'NOT_CONFIGURED',
  );
});
