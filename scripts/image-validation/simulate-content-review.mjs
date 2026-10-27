// Offline provider-contract fixture, NOT inference by a local or remote LLM.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {buildSemanticPackage,runSemanticReview} from '../../src/modules/image/documents/server/semantic-review.js';
import {presentReview} from '../../src/modules/image/documents/server/review-presentation.js';
const [rootArg,runArg]=process.argv.slice(2);
if(!rootArg||!runArg)throw new Error('Usage: simulate-content-review.mjs PLATFORM_ROOT EVALUATION_RUN');
const root=path.resolve(rootArg),run=path.resolve(runArg);
if(!run.startsWith(root+path.sep))throw new Error('Run must remain inside platform root');
const load=async p=>JSON.parse(await readFile(p,'utf8'));
const save=async(p,v)=>writeFile(p,typeof v==='string'?v:JSON.stringify(v,null,2)+'\n',{flag:'wx',mode:0o600});
let attemptedNetwork=0,mockCalls=0;
globalThis.fetch=async()=>{attemptedNetwork++;throw new Error('network_forbidden_in_simulation');};
const out=path.join(run,'simulated-handoff');await mkdir(out,{mode:0o700});
const report={mode:'simulated_provider_contract_only_not_llm_inference',apiCalls:0,localModelCalls:0,networkAttempts:0,groups:[]};
for(const gid of [0,1,34,43,72,74]){
 const source=await load(path.join(run,`group-${String(gid).padStart(2,'0')}`,'result.json'));
 const {batch,review}=source,materials=batch.materials;
 for(const privacyMode of ['redacted','original']){
  const dir=path.join(out,`g${gid}-${privacyMode}`);await mkdir(dir,{mode:0o700});
  const pkg=buildSemanticPackage({batch,review,materials,objective:review.plan.objective,privacyMode});
  const sender=async request=>{
   mockCalls++;const sent=JSON.parse(request.messages.find(m=>m.role==='user').content);
   return {summary:'模拟回复：只验证待审核事项和证据引用衔接，不执行大模型推断。',items:sent.items.map(i=>({id:i.id,verdict:'needs_more_information',explanation:i.requiresPolicy?'模拟回复：未提供已确认适用的制度原文，制度项无法判定。':'模拟回复：本地确定差异及计算保留。本替身不推断条款、版本或机构适用性。',warning:'',recommendation:i.requiresPolicy?'提供本次适用的制度版本和对应条款。':'由实际语义模型或人工仅处理本地未解决的含义与例外，不重复计算。',evidenceIds:i.focusEvidenceIds.length?[i.focusEvidenceIds[0]]:[i.evidenceIds[0]]}))};
  };
  const response=await runSemanticReview(pkg,{enabled:true,outputDir:dir,sender,model:'deepseek-flash'});
  const presentation=presentReview({materials,review,semanticReview:response});
  assert.equal(response.status,pkg.items.length?'completed':'not_run');
  // NEI from the simulated sender cannot erase local determinate findings.
  assert.ok(presentation.warnings.length>=source.presentation.warnings.length);
  if(source.presentation.warnings.length)assert.equal(presentation.status,'issues_found');
  await save(path.join(dir,'package.json'),pkg);
  await save(path.join(dir,'result.json'),{simulation:true,notLLMInference:true,response,presentation});
  await save(path.join(dir,'说明.md'),`# 离线模拟语义衔接\n\n**本文件是模拟提供者返回，不是真实API或本地大模型推理。**\n\n组${gid}，模式${privacyMode}。本地已发现${source.presentation.warnings.length}条提醒；模拟未决回复后保留${presentation.warnings.length}条。本地确定结果没有被“需补信息”吞掉。\n\n待语义事项${pkg.items.length}项，可用证据${pkg.evidence.length}项；遗漏${response.omitted?.length||0}项。\n\n[实际构包](package.json) · [模拟回复和汇总](result.json)\n`);
  report.groups.push({groupId:gid,privacyMode,status:response.status,items:pkg.items.length,evidence:pkg.evidence.length,losses:pkg.losses.length,omitted:response.omitted?.length||0,retainedLocalWarnings:presentation.warnings.length});
 }
}
report.mockCalls=mockCalls;report.networkAttempts=attemptedNetwork;assert.equal(attemptedNetwork,0);
await save(path.join(out,'report.json'),report);
await save(path.join(out,'README.md'),'# 模拟语义衔接\n\n**这里没有运行任何大模型，也没有调用API。** 使用固定离线替身返回需补充信息，仅验证构包、模式、证据引用、事项拆分和本地告警保留。不能把模拟状态completed称为模型效果通过。\n\n'+report.groups.map(g=>`- [组${g.groupId} ${g.privacyMode}](g${g.groupId}-${g.privacyMode}/说明.md)：待审核${g.items}项，保留本地提醒${g.retainedLocalWarnings}条。`).join('\n')+'\n');
console.log(JSON.stringify({mode:report.mode,mockCalls,apiCalls:0,localModelCalls:0,networkAttempts:attemptedNetwork,groups:report.groups.length}));
