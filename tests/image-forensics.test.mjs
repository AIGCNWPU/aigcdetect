import test from 'node:test';
import assert from 'node:assert/strict';
import {renderForensicCompanions} from '../src/modules/image/general/forensics-view.js';

test('face analysis renders source-coordinate rectangles and per-face scores without hash navigation',()=>{
 const html=renderForensicCompanions({face:{status:'completed',imageSize:[400,200],preview:'data:image/png;base64,AAAA',faces:[{box:[100,50,80,100],score:.82}]}});
 assert.match(html,/left:25%;top:25%;width:20%;height:50%/);
 assert.match(html,/82\.0/);assert.match(html,/data-face-target="ig-face-row-0"/);
 assert.doesNotMatch(html,/href="#ig-face/);assert.match(html,/人像伪造分析/);
});

test('no eligible face and failed face analysis cannot produce an authentic-image verdict',()=>{
 const missing=renderForensicCompanions({face:{status:'not_applicable',reason:'no_eligible_face'}});
 assert.match(missing,/未检出可分析人脸/);assert.doesNotMatch(missing,/图片真实|检测通过/);
 const failed=renderForensicCompanions({face:{status:'failed'},source:{status:'failed'}});
 assert.equal((failed.match(/分析未完成/g)||[]).length,2);assert.doesNotMatch(failed,/ig-face-preview/);
});

test('generator candidates require whole-image evidence and remain unconfirmed',()=>{
 const source={status:'completed',applicability:'whole_image_signal_present',supportedSources:['a','b'],candidates:[{source:'a',score:.99},{source:'b',score:.01}]};
 const html=renderForensicCompanions({source});assert.match(html,/99\.0/);assert.doesNotMatch(html,/候选归因|ig-source-scope/);

 const real=renderForensicCompanions({source:{...source,applicability:'no_whole_image_signal'}});
 assert.match(real,/暂不归属生成器/);assert.doesNotMatch(real,/99\.0|ig-source-name/);
 const absent=renderForensicCompanions({source:{...source,applicability:'global_analysis_unavailable'}});
 assert.doesNotMatch(absent,/99\.0/);
});

test('invalid candidate scores, HTML source labels and unsafe preview URLs are handled safely',()=>{
 const html=renderForensicCompanions({face:{status:'completed',imageSize:[1,1],preview:'javascript:alert(1)',faces:[{box:[0,0,1,1],score:.5}]},source:{status:'completed',applicability:'whole_image_signal_present',candidates:[{source:'<script>',score:.7},{source:'invalid',score:NaN}]}});
 assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>|javascript:|NaN|ig-face-preview/);
});

test('older reports retain independent not-yet-analyzed states for both companions',()=>{
 const html=renderForensicCompanions();assert.match(html,/重新检测后可查看/);
 assert.match(html,/人像伪造分析/);assert.match(html,/生成来源分析/);assert.doesNotMatch(html,/已分析 0 张|已知来源候选/);
});

test('compressed-image attribution candidates are collapsed and marked pending verification',()=>{
 const html=renderForensicCompanions({source:{status:'completed',encodingSensitive:true,applicability:'whole_image_signal_present',candidates:[{source:'a',score:.99}]}});
 assert.match(html,/压缩图片 · 来源待核验/);assert.match(html,/<details class="ig-source-reference">/);
 assert.doesNotMatch(html,/<details[^>]*\bopen\b/);assert.match(html,/查看参考候选/);assert.doesNotMatch(html,/未确认/);
});

test('file declarations are shown independently from the whole-image gate and do not assert provider identity',async()=>{
 const {renderFileEvidence}=await import('../src/modules/image/general/forensics-view.js');
 const html=renderFileEvidence({credentials:{status:'valid',signer:'<OpenAI>',claimGenerator:'writer'},sourceDeclarations:{status:'found',records:[{fields:{Label:'1',ContentProducer:'fixture-generator',ContentPropagator:'fixture-share'}}]}});
 assert.match(html,/内容绑定有效/);
 assert.match(html,/生成方声明/);assert.match(html,/传播方声明/);
 assert.match(html,/&lt;OpenAI&gt;/);assert.doesNotMatch(html,/<OpenAI>/);
 assert.doesNotMatch(html,/未执行厂商像素水印验证/);
 const absent=renderFileEvidence({credentials:{status:'absent'},sourceDeclarations:{status:'not_found'}});
 assert.match(absent,/ig-evidence-clear/);assert.match(absent,/未发现内容凭证/);
});

test('Tamper detective renders three maps and anomaly legend',async()=>{
 const {renderTamperEvidence}=await import('../src/modules/image/general/forensics-view.js');
 const png='data:image/png;base64,AAAA';
 const html=renderTamperEvidence({status:'completed',score:.75,resized:true,preview:png,overlay:png,anomalyMap:png,confidenceMap:png});
 assert.match(html,/75\.0 \/ 100/);assert.match(html,/篡改侦探/);
 assert.match(html,/ig-anomaly-legend/);assert.doesNotMatch(html,/定位置信度|TruFor|适用于/);
 assert.equal((html.match(/<figure>/g)||[]).length,3);
 const failed=renderTamperEvidence({status:'failed'});assert.match(failed,/分析未完成/);assert.doesNotMatch(failed,/\/ 100|<img/);
});

 test('tamper judgement respects the report threshold',async()=>{
 const {renderTamperEvidence}=await import('../src/modules/image/general/forensics-view.js');
 assert.match(renderTamperEvidence({status:'completed',score:.4,threshold:.3}),/发现疑似局部篡改线索/);
 assert.match(renderTamperEvidence({status:'completed',score:.4,threshold:.5}),/未见明显局部篡改线索/);
 });

test('face score bands have distinct labels and colors at boundaries',async()=>{
 const {faceSignalGrade,renderFileEvidence}=await import('../src/modules/image/general/forensics-view.js');
 assert.deepEqual([0,.2,.5,.5001,.8,.95,1].map(n=>faceSignalGrade(n).tone),['clear','low','low','medium','high','strong','strong']);
 assert.equal(faceSignalGrade(NaN).tone,'unknown');
 const html=renderFileEvidence({sourceDeclarations:{records:[{fields:{ContentProducer:'doubao'}}]}});
 assert.match(html,/ig-evidence-detected/);assert.match(html,/aria-haspopup="dialog"/);assert.doesNotMatch(html,/<details/);
});

test('credential field recognition does not rewrite signature validation',async()=>{
 const {renderCredentialCard}=await import('../src/modules/image/general/forensics-view.js');
 const credentials={status:'invalid',signer:'OpenAI',claimGenerator:'writer',validation:{activeManifest:{failure:[{code:'signingCredential.expired'}]}}};
 const html=renderCredentialCard(credentials);assert.match(html,/内容凭证识别成功/);assert.match(html,/OpenAI/);assert.match(html,/签名证书已过期/);assert.doesNotMatch(html,/凭证验证通过|内容绑定有效/);assert.equal(credentials.status,'invalid');
 assert.match(renderCredentialCard({status:'valid',signer:'OpenAI'}),/内容绑定有效/);
 assert.doesNotMatch(renderCredentialCard({status:'invalid',signer:'<script>bad</script>',claimGenerator:'<img onerror=alert(1)>'}),/<script>|<img onerror/);
});
