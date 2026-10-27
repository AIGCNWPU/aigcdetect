import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runReview} from '../src/modules/image/documents/server/review-workflow.js';
const sha=b=>createHash('sha256').update(b).digest('hex');
const base=fileURLToPath(new URL('../../runtime/test-artifacts/content-workflow/',import.meta.url));
const layout=name=>[
 ['增值税电子普通发票',500,20,500],['发票代码：012345678901',1200,80,400],['发票号码：12345678',1200,120,400],['开票日期：2026年10月26日',1200,160,450],
 ['购买方',30,220,70],['名称：'+name,200,220,300],
 ['货物或应税劳务、服务名称',100,400,350],['规格型号',520,400,150],['数量',780,400,80],['单价',970,400,80],['金额',1200,400,80],['税率',1380,400,80],['税额',1530,400,80],
 ['*服务*咨询',100,460,300],['2',870,460,20],['100.00',1020,460,100],['200.00',1260,460,100],['13%',1390,460,50],['26.00',1590,460,100],
 ['合计',160,700,100],['￥200.00',1220,710,130],['￥26.00',1570,710,130],['价税合计(大写)',160,780,300],['贰佰元整',500,780,400],['(小写)￥200.00',1280,780,300],
];
test('workbench unknown-type files get actual format/subtype, content candidates and persistent local alerts',async()=>{
 await mkdir(base,{recursive:true});const out=await mkdtemp(path.join(base,'case-'));let modelRequests=0;
 const payload={coreMaterialId:'m1',objective:'invoice_review',jurisdiction:'CN',options:{runModels:false,semanticReview:true,privacyMode:'redacted'},files:[1,2].map(i=>({id:'m'+i,name:`invoice-${i}.png`,materialType:'unknown',contentBase64:Buffer.from('unique-file-'+i).toString('base64')}))};
 const adapters={
  async runLocal(command,args){
   const input=args[args.indexOf('--input')+1],dir=args[args.indexOf('--output-dir')+1],id=args[args.indexOf('--material-id')+1];await mkdir(dir,{recursive:true});const bytes=await readFile(input);await writeFile(path.join(dir,'page.png'),bytes);
   await writeFile(path.join(dir,'material.json'),JSON.stringify({material_id:id,file_sha256:sha(bytes),status:'completed',kind:'image',coverage:{},blocks:[],pages:[{page:1,status:'completed',rendered_file:'page.png',rendered_size:[1800,2500],rendered_sha256:sha(bytes)}]}));return {code:0};
  },
  async executeStage(name,manifest){assert.equal(name,'ocr');const rows=JSON.parse(await readFile(manifest));return {provider:'controlled_ocr_fixture',model_asset_sha256:{},samples:rows.map((r,i)=>({sample_id:r.sample_id,status:'succeeded',input_sha256:r.expected_sha256,oriented_size:[1800,2500],regions:layout(i?'乙方名称':'甲方名称').map(([text,x,y,w],j)=>({region_id:`r${j}`,observed_text:text,recognition_confidence:.99,polygon:[[x,y],[x+w,y],[x+w,y+20],[x,y+20]],coordinate_space:'exif_oriented_image_pixels',source:{page:1,input_sha256:r.expected_sha256}}))}))};},
  async semanticSender(request){modelRequests++;const p=JSON.parse(request.messages[1].content);return {summary:'模拟待核实版本。',items:p.items.map(i=>({id:i.id,verdict:'needs_more_information',explanation:'模拟仅核对衔接。',warning:'',recommendation:'核实版本。',evidenceIds:[i.evidenceIds[0]]}))};}
 };
 const r=await runReview(payload,out,()=>{},adapters);
 assert.ok(r.materials.every(m=>m.type==='invoice'));assert.ok(r.materials.every(m=>m.stages.ocr.status==='completed'));
 assert.equal(r.review.plan.contentCandidates.length,1);assert.equal(r.review.plan.edges.length,0);
 assert.ok(r.review.checks.filter(c=>c.rule==='invoice_net_tax_gross').every(c=>c.status==='FAIL'));
 assert.ok(r.review.candidates.some(c=>c.comparedKey==='name'&&c.status==='FAIL'));
 assert.equal(r.presentation.status,'issues_found');assert.ok(r.presentation.warnings.some(w=>w.title==='价税金额核对'));
 assert.ok(r.materials.every(m=>m.stages.seed.status==='not_run'));
 assert.ok(modelRequests<=1);assert.ok(r.presentation.warnings.length>=3);
 const persisted=JSON.parse(await readFile(path.join(out,'result.json')));assert.equal(persisted.presentation.status,'issues_found');
});
