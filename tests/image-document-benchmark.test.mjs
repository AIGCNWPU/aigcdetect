import test from 'node:test';
import assert from 'node:assert/strict';
import {renderDocumentBenchmark} from '../src/modules/image/documents/benchmark.js';
test('benchmark hides unpublished results and displays paired counts without fabricating dominance',()=>{
 assert.equal(renderDocumentBenchmark({published:false}),'');
 const data={published:true,datasetLabel:'公开合成票据',samples:2,positive:1,negative:1,date:'2026-11-06',scope:'单文件',methods:[{id:'agent',title:'智鉴智能核验'},{id:'direct',title:'直接语义核验'},{id:'rules',title:'本地规则'}],rows:[{title:'金额',total:2,correct:{agent:1,direct:2,rules:0}}],summary:{agent:{detected:1,normal:0,abstained:1},direct:{detected:1,normal:1,abstained:0},rules:{detected:0,normal:0,abstained:2}}};
 const html=renderDocumentBenchmark(data);assert.match(html,/50.0%/);assert.match(html,/class="db-best"><strong>100.0%/);assert.match(html,/信息不足或失败/);assert.match(html,/同输入流程对照/);assert.doesNotMatch(html,/领先|优于/);
 assert.ok(html.includes('1 / 2'));assert.ok(html.includes('0 / 2'));
});
