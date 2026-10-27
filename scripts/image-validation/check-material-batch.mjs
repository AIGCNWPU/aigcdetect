// Local development CLI. Trusted reviewer context is a separate local file, not HTTP user data.
import { readFile, writeFile } from 'node:fs/promises';
import { evaluateBatch } from '../../src/modules/image/documents/server/batch-engine.js';
import { assessScenarioCoverage } from '../../src/modules/image/documents/server/catalog.js';
const [input,contextFile,output,profileId]=process.argv.slice(2);
if (!input || !contextFile || !output) throw new Error('Usage: node check-material-batch.mjs batch.json trusted-context.json output.json [scenario]');
const batch=JSON.parse(await readFile(input,'utf8'));
const context=JSON.parse(await readFile(contextFile,'utf8'));
const result=evaluateBatch(batch,context);
if (profileId) result.scenario=assessScenarioCoverage(profileId,batch.materials.map(m=>m.type));
await writeFile(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({execution:result.execution,checks:result.checks.length,candidates:result.candidates.length}));
