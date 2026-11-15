/** Fill the missing visual stages of an actual, already reviewed dataset pair. No API calls. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {executeStage,platformRoot as root} from '../../src/modules/image/documents/server/local-runtime.js';
const source=path.join(root,'runtime/replay/agent-four-types-20261031/group-16');
const out=path.join(root,'runtime/replay/complete-example-20261101');await mkdir(out,{recursive:true});
const local=JSON.parse(await readFile(source+'/local.json','utf8'));const rows=[];
for(const s of local.sources){const bytes=await readFile(s.path);if(createHash('sha256').update(bytes).digest('hex')!==s.sha256)throw Error('source_mismatch');rows.push({sample_id:s.id,path:s.path,expected_sha256:s.sha256});}
const manifest=path.join(out,'manifest.json');await writeFile(manifest,JSON.stringify(rows,null,2),{flag:'wx'});
for(const stage of ['mirror','seed']){console.log('Starting',stage);const report=await executeStage(stage,manifest,path.join(out,stage));await writeFile(path.join(out,stage+'-report.json'),JSON.stringify(report,null,2),{flag:'wx'});for(const r of rows){const s=report.samples.find(s=>s.sample_id===r.sample_id);if(s?.status!=='succeeded'||s.input_sha256!==r.expected_sha256)throw Error(stage+'_validation_failed');}console.log(stage,report.samples.map(s=>({id:s.sample_id,score:s.generated_score??s.detector_score,regions:s.regions?.length})));}
