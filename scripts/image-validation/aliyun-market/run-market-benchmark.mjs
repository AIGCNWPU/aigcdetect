// Paired benchmark runner: external Aliyun-marketplace APIs vs our frozen OCR
// fields on the same fixtures. Dry by default; --live places real AppCode calls
// under a persistent budget with raw archival. Scoring lives in the scorer.
//
// Usage:
//   node scripts/image-validation/aliyun-market/run-market-benchmark.mjs <outDir> [--live]
// Fixture contract (prepare separately, mirrors invoice-benchmark conventions):
//   <outDir>/fixtures.json  [{id, imageBase64|imagePath, gold:{field:value}, side?}]
//   <outDir>/ours.json      {id:{field:value}}   frozen results of our pipeline
// Env per product: ALIYUN_APPCODE_<KEY>, ALIYUN_MARKET_ENDPOINT_<KEY> (or --endpoint key=url)
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {basename} from 'node:path';
import path from 'node:path';
import {createMarketClient,loadBudget,saveBudget,marketEnvName,endpointEnvName} from './client.mjs';
import {marketProducts,buildRequest,normalizeResponse,fieldMap} from './adapters.mjs';

const out=path.resolve(process.argv[2]||'');
if(!process.argv[2])throw Error('Output directory required');
const live=process.argv.includes('--live');
const products=process.argv.filter(argument=>argument.startsWith('--product=')).map(argument=>argument.slice(10));
const endpointArgs=Object.fromEntries(process.argv.filter(argument=>argument.startsWith('--endpoint=')).map(argument=>argument.slice(11).split('=')));

const load=async file=>JSON.parse(await readFile(file,'utf8'));
const save=(file,value)=>writeFile(file,JSON.stringify(value,null,2)+'\n',{mode:0o600});
let fixtures=[],ours={};
try{fixtures=await load(path.join(out,'fixtures.json'));}catch{throw Error(`fixtures.json missing: prepare fixtures first (see docs/image-workstream/aliyun-api-market-research-20261109.md)`);}
try{ours=await load(path.join(out,'ours.json'));}catch{}
const selected=marketProducts.filter(product=>!products.length||products.includes(product.key));
await mkdir(path.join(out,'raw'),{recursive:true});
const budget=await loadBudget(path.join(out,'budget.json'),{limit:60});
const persist=()=>saveBudget(path.join(out,'budget.json'),budget);
const client=createMarketClient({appcode:process.env.MARKET_APPCODE||process.env.ALIYUN_APPCODE_INVOICE_OCR,budget,live,saveBudget:persist,archiveDir:path.join(out,'raw')});

const results=[];
for(const product of selected){
  const appcode=process.env[marketEnvName(product.key)]||process.env.MARKET_APPCODE;
  const endpoint=endpointArgs[product.key]||process.env[endpointEnvName(product.key)]||product.endpointDefault;
  const perSample=[];
  for(const fixture of fixtures){
    const oursFields=ours[fixture.id]||{};
    if(!live){perSample.push({id:fixture.id,ours:Object.keys(oursFields).length,external:'dry'});continue;}
    if(!appcode){perSample.push({id:fixture.id,error:'appcode_missing'});continue;}
    const image=fixture.imageBase64||fixture.imagePath?await readFile(fixture.imagePath).then(buffer=>buffer.toString('base64')):undefined;
    const request=buildRequest(product.key,{image,side:fixture.side,fields:fixture.fields,standard:fixture.standard,compare:fixture.compare,detectThreshold:fixture.detectThreshold,restrictProbability:fixture.restrictProbability,imgType:fixture.imgType});
    try{
      const response=await client.call({kind:product.key,url:endpoint,body:request.body,form:request.form});
      if(!response.ok){perSample.push({id:fixture.id,http:response.status,error:'provider_failed',detail:response.body??response.text});continue;}
      const normalized=normalizeResponse(product.key,response);
      const external=normalized.kind==='ocr'?fieldMap(normalized):normalized.kind==='tamper'?{tampered:String(normalized.tampered)}:normalized.kind==='aigc'?{aiGenerated:String(normalized.aiGenerated)}:normalized.kind==='verify'?{verified:String(normalized.verified)}:{differenceCount:String(normalized.differenceCount)};
      const scored={};
      for(const [key,value] of Object.entries(fixture.gold||{}))scored[key]={gold:value,ours:oursFields[key]??null,external:external[key]??null};
      perSample.push({id:fixture.id,http:response.status,...normalized,scored});
    }catch(error){perSample.push({id:fixture.id,error:String(error?.message||error)});}
  }
  results.push({product:{key:product.key,name:product.name,code:product.code,trial:product.trial},endpoint:live?(endpoint||'unconfigured'):'dry',samples:perSample});
  await save(path.join(out,'market-results.json'),results);
  console.log(JSON.stringify({product:product.key,samples:perSample.length,live}));
}
if(!live)console.log('Dry plan written to market-results.json; add --live plus AppCode/endpoint env to execute.');
