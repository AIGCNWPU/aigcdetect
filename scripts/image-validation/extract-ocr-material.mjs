// Local adapter for one smoke_ocr sample; no external service or auto relationship confirmation.
import { readFile, writeFile } from 'node:fs/promises';
import { extractOcrMaterial } from '../../src/modules/image/documents/server/ocr-fields.js';
const [input,indexText,id,type,output]=process.argv.slice(2);
if(!input||!/^\d+$/.test(indexText??'')||!id||!type||!output) throw new Error('Usage: node extract-ocr-material.mjs ocr-report.json sample-index material-id material-type output.json');
const report=JSON.parse(await readFile(input,'utf8'));
const extracted=extractOcrMaterial(report.samples?.[Number(indexText)],{id,type});
await writeFile(output,JSON.stringify(extracted,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({fields:extracted.material.fields.length,review:extracted.review.length,unmatchedRegions:extracted.coverage.unmatchedRegionIds.length}));
