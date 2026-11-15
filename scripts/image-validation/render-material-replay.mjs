// Render frozen evaluation results using the production UI. No models/API.
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import path from 'node:path';
import {renderDocumentResult} from '../../src/modules/image/pages/documents.js';
const [inputArg,outArg]=process.argv.slice(2);if(!inputArg||!outArg)throw new Error('Usage: render-material-replay.mjs INPUT NEW_OUTPUT');
const input=path.resolve(inputArg),out=path.resolve(outArg);await mkdir(out,{mode:0o700});
const moduleSource=await readFile(new URL('../../src/modules/image/pages/documents.js',import.meta.url),'utf8');
const css=await readFile(new URL('../../src/styles.css',import.meta.url),'utf8')+'\n'+moduleSource.match(/const docCss = `([\s\S]*?)`;/)[1];
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={11:'授权书',26:'出库单',41:'在职证明',70:'营业执照',100:'印尼票据对照一',101:'印尼票据对照二'};
const report=JSON.parse(await readFile(path.join(input,'report.json'),'utf8'));
const nav=report.groups.map(g=>`<a href="group-${g.groupId}.html">${esc(labels[g.groupId]||'材料')}</a>`).join(' · ');
const shell=(title,body)=>`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · 智鉴</title><style>${css}main{max-width:1080px;margin:28px auto;padding:0 20px}.doc-workspace{background:white;border-radius:20px}nav{font-size:14px;line-height:2.5;padding:16px 0}nav a{color:#3568ac}.note{margin:16px 0;color:#64748b;font-size:13px;line-height:1.8}[hidden]{display:none!important}</style><header class="topbar"><div class="brand"><span class="brand-mark">V</span>VERITAS 智鉴</div><a href="../">发票示例</a></header><main><h1>${esc(title)}</h1><nav>${nav}</nav>${body}</main></html>`;
for(const group of report.groups){
 const slug=`group-${String(group.groupId).padStart(2,'0')}`,source=path.join(input,slug),r=JSON.parse(await readFile(path.join(source,'result.json'),'utf8'));
 const materials=await Promise.all(r.batch.materials.map(async(m,i)=>({...m,name:`${labels[group.groupId]||'材料'}${i+1}${i===0?' · 核心材料':''}`,status:'completed',checks:r.review.perMaterial.find(p=>p.materialId===m.id)?.checks||[],stages:{ocr:{status:'completed'},rules:{status:'completed'},mirror:{status:'not_run'},seed:{status:'not_run'},explanation:{status:'not_run'}},pages:[{number:1,status:'completed',regions:[],previewDataUrl:'data:image/png;base64,'+(await readFile(path.join(source,r.images.find(img=>img.id===m.id).name))).toString('base64')}]})));
 const data={materials,review:r.review,presentation:r.presentation};
 const body=`<p class="note">使用冻结的真实图片、新运行的OCR及当前本地规则结果。未调用整图模型、定位模型或外部API。待确认差异与未覆盖项均保留。</p><div class="doc-workspace"><label for="material-select">查看材料 </label><select id="material-select">${materials.map(m=>`<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('')}</select>${materials.map((m,i)=>`<div data-view="${esc(m.id)}"${i?' hidden':''}>${renderDocumentResult(data,m.id)}</div>`).join('')}</div><script>document.querySelector('select').addEventListener('change',e=>{for(const el of document.querySelectorAll('[data-view]'))el.hidden=el.dataset.view!==e.target.value;});</script>`;
 await writeFile(path.join(out,`group-${group.groupId}.html`),shell(labels[group.groupId]||'材料核验',body),{flag:'wx'});
}
await writeFile(path.join(out,'index.html'),shell('新增材料核验示例',`<p class="note">授权书、出库单、在职证明、营业执照，以及另一数据集CORD的票据边界对照。点击上方选择材料类别。</p><div class="doc-workspace"><p>新增${report.totals.files}张实际OCR图像，${report.totals.fields}个结构字段、${report.totals.candidates}个核心标识候选。仍有未覆盖材料，不将提取数量当准确率。</p>${report.groups.map(g=>`<p><a href="group-${g.groupId}.html">${esc(labels[g.groupId]||'材料')}：${g.files}张 · ${g.fields}字段</a></p>`).join('')}</div>`),{flag:'wx'});
console.log(JSON.stringify({out,pages:report.groups.length+1}));
