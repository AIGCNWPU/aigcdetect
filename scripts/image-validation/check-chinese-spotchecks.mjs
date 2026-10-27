// Selected manual visual readings are diagnostics, not independent test labels.
import {readFile,writeFile} from 'node:fs/promises';
import {evaluateBatch,reviseField,isCurrent} from '../../src/modules/image/documents/server/batch-engine.js';
const [input,annotations,output]=process.argv.slice(2);
if(!input||!annotations||!output)throw new Error('Usage: node check-chinese-spotchecks.mjs evaluation.json manual-labels.json output.json');
const report=JSON.parse(await readFile(input,'utf8'));
const selected=JSON.parse(await readFile(annotations,'utf8'));
const spotchecks=[];
for(const row of selected){const page=report.documents.find(d=>d.id===row.document)?.pages.find(p=>p.page===row.page);for(const [key,role,value] of row.expected){const fs=page?.extraction.material.fields.filter(f=>f.key===key&&f.role===role)??[];spotchecks.push({document:row.document,page:row.page,key,role,expected:value,actual:fs.map(f=>f.value),passed:fs.length===1&&fs[0].value===value&&fs[0].source.page===row.page&&fs[0].source.regions.length>0});}}
const original=report.documents.find(d=>d.id==='procurement-equipment').pages[0].extraction.material;
const batch={id:'controlled-field-mutation',version:1,materials:[original]},base=evaluateBatch(batch);
const field=original.fields.find(f=>f.key==='gross_amount');
const revised=reviseField(batch,{materialId:original.id,fieldId:field.id},{value:'306501.00',reason:'synthetic +1 field fault for regression, original image unchanged',actor:'diagnostic_fixture',expectedFieldVersion:1});
const changed=evaluateBatch(revised);
const mutation={kind:'synthetic_field_mutation_on_real_ocr_not_real_image_tampering',oldReportInvalidated:!isCurrent(base,revised),originalTextPreserved:revised.materials[0].fields.find(f=>f.id===field.id).source.observedText===field.source.observedText,checks:changed.checks.filter(c=>['invoice_net_tax_gross','amount_words_numeric'].includes(c.rule)).map(c=>({rule:c.rule,status:c.status}))};
const result={purpose:'selected_visual_spotcheck_not_independent_accuracy',reviewer:'codex_visual_inspection_of_rendered_pages',spotchecks,passed:spotchecks.filter(s=>s.passed).length,total:spotchecks.length,mutation};
await writeFile(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({passed:result.passed,total:result.total,mutation}));
if(result.passed!==result.total||!mutation.oldReportInvalidated||!mutation.originalTextPreserved||mutation.checks.length!==2||mutation.checks.some(c=>c.status!=='FAIL'))process.exitCode=1;
