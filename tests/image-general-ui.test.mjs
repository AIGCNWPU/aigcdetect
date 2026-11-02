import test from 'node:test';
import assert from 'node:assert/strict';
import {validateGeneralImages,normalizeGeneralResult} from '../src/modules/image/pages/general.js';
const file=(name='image.png',size=100,type='image/png')=>({name,size,type});
test('通用图片格式、批量和大小限制，坏文件不排除正常图片',()=>{
 const {accepted,errors}=validateGeneralImages([],[file('bad.svg',100,'image/svg+xml'),file(),file('empty.png',0),file('huge.png',11*1048576)]);
 assert.equal(accepted.length,1);assert.equal(errors.length,3);
 assert.equal(validateGeneralImages(Array.from({length:8},()=>file()),[file()]).accepted.length,0);
 assert.equal(validateGeneralImages([file('a.png',10*1048576),file('b.png',10*1048576)],[file('c.png',5*1048576)]).accepted.length,0);
 assert.equal(validateGeneralImages([],[file('photo.jpg',10,'image/png')]).accepted.length,0);
});
test('结果必须关联当前图片，未完成或未知结论不得当作检测通过',()=>{
 const data={id:'a',status:'completed',verdict:'no_obvious_ai',summary:'测试返回'};
 assert.equal(normalizeGeneralResult({data},'a').status,'no_obvious_ai');
 for(const invalid of [{...data,id:'b'},{...data,status:'failed'},{...data,verdict:'real'},{}])assert.throws(()=>normalizeGeneralResult({data:invalid},'a'));
 assert.equal(normalizeGeneralResult({data:{...data,summary:{malformed:true}}},'a').summary,'');
});


test('benchmark uses product names without internal evaluation captions',async()=>{
 const {renderImageBenchmark}=await import('../src/modules/image/pages/general.js');
 const html=renderImageBenchmark();
 for(const label of ['生成模型</th>','智鉴</th>','方法1</th>','方法2</th>','方法3</th>','97.70%','78.20%'])assert.ok(html.includes(label));
 for(const internal of ['本地实测','同系列保留','加粗数值','生成模型子集','DDA-H','PGC','PROBE','SAFE','对比智鉴'])assert.equal(html.includes(internal),false,internal);
});
