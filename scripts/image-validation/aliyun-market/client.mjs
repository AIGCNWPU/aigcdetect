// Aliyun Cloud Marketplace (market.aliyun.com) AppCode client for benchmark runs.
// Mirrors repo conventions: no network unless live, persistent budget ledger,
// raw request/response archival per call, no retries that could improve scores.

import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';

export async function loadBudget(file,{limit=100}={}){
  try{return JSON.parse(await readFile(file,'utf8'));}
  catch{return {limit,attempts:0,requests:[]};}
}

export async function saveBudget(file,budget){
  await writeFile(file,JSON.stringify(budget,null,2)+'\n',{mode:0o600});
}

export function createMarketClient({appcode,budget,archiveDir,live=false,saveBudget:persist,fetchImpl=globalThis.fetch,now=()=>new Date().toISOString()}={}){
  if(live&&!appcode)throw Error('AppCode required for live calls (set env or --appcode)');
  return {
    async call({kind='market',method='POST',url,body,query,form,signal}={}){
      if(!live)throw Error('dry mode: add --live to place real requests');
      if(!url)throw Error('endpoint missing: confirm the request URL on the product page API console and pass --endpoint or its env variable');
      if(budget.attempts>=budget.limit)throw Error('test_budget_exhausted');
      const attempt=++budget.attempts;
      const target=new URL(url);
      if(query)for(const [key,value] of Object.entries(query))target.searchParams.set(key,String(value));
      const started=Date.now();
      const headers={Authorization:`APPCODE ${appcode}`};
      let payload;
      if(form!==undefined){headers['Content-Type']='application/x-www-form-urlencoded';payload=new URLSearchParams(Object.entries(form).filter(([,value])=>value!==undefined&&value!==null&&value!=='')).toString();}
      else if(body!==undefined){headers['Content-Type']='application/json; charset=UTF-8';payload=JSON.stringify(body);}
      let status=-1,text='',parsed=null,error='';
      try{
        const response=await fetchImpl(target.href,{method,headers,body:payload,signal:signal||AbortSignal.timeout(60000)});
        status=response.status;text=await response.text();
        try{parsed=JSON.parse(text);}catch{/* keep raw text */}
      }catch(requestError){error=String(requestError?.message||requestError);}
      const record={attempt,kind,url:target.href,method,seconds:(Date.now()-started)/1000,status,error,request:form??body,time:now(),response:parsed??text};
      budget.requests.push({attempt,kind,url:hostOf(target),status,seconds:record.seconds,time:record.time});
      if(persist)await persist();
      if(archiveDir){
        await mkdir(archiveDir,{recursive:true});
        await writeFile(path.join(archiveDir,`${String(attempt).padStart(3,'0')}-${kind}.json`),JSON.stringify(record,null,2)+'\n',{mode:0o600});
      }
      return {attempt,status,ok:status>=200&&status<300,error,body:parsed,text,seconds:record.seconds};
    },
  };
}

function hostOf(target){return `${target.hostname}${target.pathname}`;}

export function marketEnvName(productKey){
  return `ALIYUN_APPCODE_${String(productKey).replace(/[-a-z]/g,character=>character==='-'?'_':character.toUpperCase())}`;
}

export function endpointEnvName(productKey){
  return `ALIYUN_MARKET_ENDPOINT_${String(productKey).replace(/[-a-z]/g,character=>character==='-'?'_':character.toUpperCase())}`;
}
