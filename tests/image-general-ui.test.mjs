import test from 'node:test';
import assert from 'node:assert/strict';
import {validateGeneralImages,normalizeGeneralResult} from '../src/modules/image/pages/general.js';
const file=(name='image.png',size=100,type='image/png')=>({name,size,type});
test('通用图片格式、批量和大小限制，坏文件不排除正常图片',()=>{
 const {accepted,errors}=validateGeneralImages([],[file('bad.svg',100,'image/svg+xml'),file(),file('empty.png',0),file('huge.png',20*1048576+1)]);
 assert.equal(validateGeneralImages([],[file('limit.png',20*1048576)]).accepted.length,1);
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
 const manifest=JSON.parse(await readFile(new URL('../public/image-examples/doubao/provenance.json',import.meta.url)));
 assert.equal(generalShowcase.score,manifest.score);
 assert.equal(manifest.sourceSha256,'5c4b8127806164c127c8b20e7d12a9a57d1c63b6ba4deeeae0f0376dcd58417d');
 assert.notEqual(manifest.sourceSha256,manifest.portraitSha256);
 for(const [name,hash] of Object.entries(manifest.assets))assert.equal(createHash('sha256').update(await readFile(new URL(`../public/image-examples/doubao/${name}`,import.meta.url))).digest('hex'),hash);
 const html=renderGeneralShowcase();assert.match(html,/已完成全图<br><span class="ig-summary-line">特征分析/);assert.match(html,/特征较弱/);assert.equal(manifest.spatial.coveredFraction,1);assert.match(html,/未发现内容凭证/);assert.doesNotMatch(html,/data:image|QWEN-IMAGE-BENCH/);
 for(const label of ['林间暖阳 · 豆包2','篡改侦探','文件来源核查','人像伪造分析','生成来源分析','showcase-ig-face-title'])assert.ok(html.includes(label),label);
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
 assert.doesNotMatch(source,/查看纹理与边缘细节/);assert.doesNotMatch(source,/9.999|细节强度/);
});

test('explicit AI file marking supplements a missed model result without changing its score',()=>{
 const raw={id:'marked',status:'completed',verdict:'no_obvious_ai',score:.12,diagnostics:{sourceDeclarations:{records:[{fields:{Label:'1',ContentProducer:'doubao'}}]}}};
 const normalized=normalizeGeneralResult({data:raw},'marked');
 assert.equal(normalized.status,'likely_ai');assert.equal(normalized.result.score,.12);assert.equal(normalized.result.modelVerdict,'no_obvious_ai');assert.equal(normalized.result.decisionBasis,'file_declaration');assert.match(normalized.summary,/文件标识/);
 assert.equal(raw.verdict,'no_obvious_ai');
 for(const label of ['2','3','']){const r={...raw,diagnostics:{sourceDeclarations:{records:[{fields:{Label:label,ContentProducer:'OpenAI'}}]}}};assert.equal(normalizeGeneralResult(r,'marked').status,'no_obvious_ai');}
 const issuerOnly={...raw,diagnostics:{credentials:{status:'invalid',signer:'OpenAI',claimGenerator:'writer'}}};assert.equal(normalizeGeneralResult(issuerOnly,'marked').status,'no_obvious_ai');
});
