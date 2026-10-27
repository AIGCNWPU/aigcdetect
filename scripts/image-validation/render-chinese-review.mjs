// Local diagnostic artifact only. No material upload, server or external scripts.
import {readFile,writeFile} from 'node:fs/promises';
const [input,output]=process.argv.slice(2);
if(!input||!output)throw new Error('Usage: node render-chinese-review.mjs report.json review.html (output in research root)');
const report=JSON.parse(await readFile(input,'utf8'));
const pages=report.documents.flatMap(d=>(d.pages??[]).filter(p=>p.extraction).map(p=>({document:d.id,url:d.source.url,page:p.page,image:`${d.id}/pages/page-${String(p.page).padStart(4,'0')}.png`,material:p.extraction.material,review:p.extraction.review,checks:p.result.checks})));
const payload=JSON.stringify({summary:report.summary,pages}).replaceAll('<','\\u003c');
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>中文材料核验诊断</title><style>
body{font:15px system-ui;margin:24px;color:#243348;background:#f5f7fa}h1{font-size:24px}select{font:inherit;padding:8px}main{display:grid;grid-template-columns:minmax(400px,60%) 1fr;gap:24px;margin-top:20px}.paper{position:relative;align-self:start;background:white}.paper img{display:block;width:100%}.paper svg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}table{border-collapse:collapse;width:100%;background:white}td,th{text-align:left;padding:9px;border-bottom:1px solid #ddd}tr[data-field]{cursor:pointer}tr[data-field]:hover{background:#edf4ff}.PASS{color:#16704b}.FAIL{color:#b93030}.NEI{color:#885b00}li{margin:10px 0;overflow-wrap:anywhere}small{color:#566474}#value{overflow-wrap:anywhere}@media(max-width:850px){main{display:block}}
</style><h1>真实中文材料 · OCR 定位与规则诊断</h1><p>本地研究报告。文字框代表 OCR 引用区域；规则通过不证明登记真实性，规则冲突不证明图像篡改。</p><p id="summary"></p><select id="page"></select> <a id="source" target="_blank" rel="noopener">公开来源</a><main><div class="paper"><img id="image"><svg id="overlay"></svg></div><section><h2>字段（点击查看来源框）</h2><table><thead><tr><th>语义 / 角色</th><th>值</th></tr></thead><tbody id="fields"></tbody></table><p id="value"></p><h2>内容核验</h2><ul id="checks"></ul><h2>待复核 / 未覆盖</h2><ul id="review"></ul></section></main><script>
const data=${payload};
const $=id=>document.getElementById(id);
$('summary').textContent='已下载 '+data.summary.documentsDownloaded+' 份；已核验 '+data.summary.pagesEvaluated+' 页。合成规则测试与本报告分开统计。';
for(let i=0;i<data.pages.length;i++){const option=document.createElement('option');option.value=i;option.textContent=data.pages[i].document+' / PDF第 '+data.pages[i].page+' 页';$('page').append(option);}
function draw(field){const page=data.pages[Number($('page').value)];$('overlay').replaceChildren();for(const region of field.source.regions??[field.source]){const polygon=document.createElementNS('http://www.w3.org/2000/svg','polygon');polygon.setAttribute('points',region.polygon.map(p=>p.join(',')).join(' '));polygon.setAttribute('fill','rgba(255,175,40,.12)');polygon.setAttribute('stroke','#e16b16');polygon.setAttribute('stroke-width','2');$('overlay').append(polygon);}$('value').textContent='原文：'+field.source.observedText+'；定位精度：'+field.source.precision+'；字段分数：'+field.confidence.toFixed(3);}
function show(){const p=data.pages[Number($('page').value)];$('image').src=p.image;$('source').href=p.url;const dim=p.material.pages[0];$('overlay').setAttribute('viewBox','0 0 '+dim.width+' '+dim.height);$('overlay').replaceChildren();$('fields').replaceChildren();$('checks').replaceChildren();$('review').replaceChildren();$('value').textContent='';
for(const f of p.material.fields){const row=document.createElement('tr');row.dataset.field=f.id;for(const value of [f.key+' / '+f.role,f.value]){const td=document.createElement('td');td.textContent=value;row.append(td);}row.onclick=()=>draw(f);$('fields').append(row);}
for(const c of p.checks){const li=document.createElement('li');li.className=c.status;li.textContent=c.status+' · '+c.rule+' · '+c.reason;$('checks').append(li);}
for(const r of p.review){const li=document.createElement('li');li.textContent=(r.key?r.key+' · ':'')+r.reason;$('review').append(li);}
if(!p.material.fields.length){const li=document.createElement('li');li.textContent='未提取到支持的字段，不能视为通过。';$('review').append(li);}}
$('page').onchange=show;if(data.pages.length)show();
</script></html>`;
await writeFile(output,html,{flag:'wx'});
console.log('Local review written');
