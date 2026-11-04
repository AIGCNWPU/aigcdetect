import test from 'node:test';
import assert from 'node:assert/strict';
import {validateGeneralImages,normalizeGeneralResult} from '../src/modules/image/pages/general.js';
const file=(name='image.png',size=100,type='image/png')=>({name,size,type});
test('通用图片格式、批量和大小限制，坏文件不排除正常图片',()=>{
 const {accepted,errors}=validateGeneralImages([],[file('bad.svg',100,'image/svg+xml'),file(),file('empty.png',0),file('huge.png',11*1048576)]);
 assert.equal(accepted.length,1);assert.equal(errors.length,3);
 assert.equal(validateGeneralImages(Array.from({length:100},()=>file()),[file()]).accepted.length,0);
 assert.equal(validateGeneralImages(Array.from({length:100},()=>file('a.png',10*1048576)),[file('c.png',5*1048576)]).accepted.length,0);
 assert.equal(validateGeneralImages([],[file('photo.jpg',10,'image/png')]).accepted.length,0);
});
test('结果必须关联当前图片，未完成或未知结论不得当作检测通过',()=>{
 const data={id:'a',status:'completed',verdict:'no_obvious_ai',summary:'测试返回'};
 assert.equal(normalizeGeneralResult({data},'a').status,'no_obvious_ai');
 for(const invalid of [{...data,id:'b'},{...data,status:'failed'},{...data,verdict:'real'},{}])assert.throws(()=>normalizeGeneralResult({data:invalid},'a'));
 assert.equal(normalizeGeneralResult({data:{...data,summary:{malformed:true}}},'a').summary,'');
});


test('benchmark shows comparison methods with venue and year',async()=>{
 const {renderImageBenchmark}=await import('../src/modules/image/pages/general.js');
 const html=renderImageBenchmark();
 for(const label of ['生成模型</th>','智鉴</th>','PGC · ICML 2026</th>','PROBE · ICML 2026</th>','SAFE · KDD 2025</th>','97.70%','78.20%'])assert.ok(html.includes(label));
 for(const internal of ['本地实测','同系列保留','加粗数值','生成模型子集','DDA-H','对比智鉴','QWEN-IMAGE-BENCH'])assert.equal(html.includes(internal),false,internal);
});


test('固定生成示例与辅助诊断只使用静态资源，保留实测定位和来源状态',async()=>{
 const {renderGeneralShowcase,renderImageSource}=await import('../src/modules/image/pages/general.js');
 const {generalShowcase}=await import('../src/modules/image/general/example.js');
 const {readFile}=await import('node:fs/promises');const {createHash}=await import('node:crypto');
 const manifest=JSON.parse(await readFile(new URL('../public/image-examples/watch/provenance.json',import.meta.url)));
 assert.equal(manifest.label,1);assert.equal(generalShowcase.score,manifest.score);assert.equal(generalShowcase.sensitivity.markedCount,6);
 assert.equal(manifest.sensitivity.cells.filter(c=>c.marked).length,6);
 for(const [name,hash] of Object.entries(manifest.assets))assert.equal(createHash('sha256').update(await readFile(new URL(`../public/image-examples/watch/${name}.png`,import.meta.url))).digest('hex'),hash);
 const html=renderGeneralShowcase();assert.match(html,/已完成全图特征分析/);assert.match(html,/特征较弱/);assert.equal(manifest.spatial.coveredFraction,1);assert.match(html,/未发现内容凭证/);assert.doesNotMatch(html,/data:image|漏检|真实图|QWEN-IMAGE-BENCH/);
 assert.ok(html.indexOf('<strong>AI生成图片</strong>')<html.indexOf('<strong>AI 特征分布</strong>'));
 assert.equal(normalizeGeneralResult({id:'t',status:'completed',verdict:'likely_ai'},'t').status,'likely_ai');
 assert.match(renderImageSource({metadata:{Software:'<script>'},credentials:{status:'absent'}}),/&lt;script&gt;/);
});


test('结果浏览按当前筛选序号呈现，首尾禁用，长文件名转义',async()=>{
 const {renderResultNavigator}=await import('../src/modules/image/pages/general.js');
 const rows=[{id:'a',file:{name:'<first>.png'},url:'a',status:'likely_ai'},{id:'b',file:{name:'second.png'},url:'b',status:'no_obvious_ai'}];
 const first=renderResultNavigator(rows,rows[0]);assert.match(first,/id="ig-prev"[^>]*disabled/);assert.match(first,/1 \/ 2/);assert.match(first,/&lt;first&gt;/);
 const last=renderResultNavigator(rows,rows[1]);assert.match(last,/id="ig-next"[^>]*disabled/);assert.match(last,/2 \/ 2/);
 const filtered=renderResultNavigator([rows[1]],rows[1]);assert.match(filtered,/1 \/ 1/);assert.doesNotMatch(filtered,/data-result-select="a"/);
});

test('全图特征为默认图层且不暴露遮挡块计数和诊断均值',async()=>{
 const {renderGeneralDiagnostics,renderImageSource}=await import('../src/modules/image/pages/general.js');
 const html=renderGeneralDiagnostics({result:{score:.9,spatial:{status:'completed'},diagnostics:{dimensions:[100,200],layers:{original:'/original.png',aiFeatures:'/features.png',sensitivity:'/old.png'}}}});
 assert.match(html,/data-layer="aiFeatures" aria-pressed="true"/);assert.doesNotMatch(html,/data-layer="sensitivity"/);assert.match(html,/已完成全图分析/);assert.doesNotMatch(html,/已标出|几处/);
 const source=renderImageSource({layers:{residual:'/residual.png'},statistics:{residualMean:9.999},credentials:{status:'absent'}});
 assert.match(source,/查看纹理与边缘细节/);assert.doesNotMatch(source,/9.999|细节强度/);
});
