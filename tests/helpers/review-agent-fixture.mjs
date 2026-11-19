import {buildSemanticPackage} from '../../src/modules/image/documents/server/semantic-review.js';

export function agentPackage({privacyMode='redacted',amount='100',objective='invoice_review'}={}) {
  const material={id:'/private/invoice.pdf',name:'private-invoice.pdf',type:'contract',fields:[
    {id:'amount',key:'gross_amount',role:'transaction',value:amount,confidence:.99},
    {id:'name',key:'name',role:'buyer',value:'测试客户',confidence:.99},
  ],textBlocks:[{id:'clause',text:'合同金额100元，首期支付50%。',page:1,confidence:.99}]};
  return buildSemanticPackage({batch:{id:'private-batch',materials:[material]},materials:[material],objective,privacyMode,
    review:{plan:{objective,coreMaterialId:material.id,edges:[]},executionAssessment:{items:[
      {id:'original-assessment',grade:'B',route:'semantic',rule:'document_context_review',status:'NEI',materialIds:[material.id],evidence:[{materialId:material.id,fieldId:'amount'}]},
      {id:'local',grade:'A',route:'local',rule:'invoice_net_tax_gross',status:'FAIL',materialIds:[material.id],evidence:[{materialId:material.id,fieldId:'amount'}]},
    ]}}});
}
export function agentReply(pkg,verdict='reasonable') {
  return {summary:'已复核所列内容。',items:pkg.items.map(i=>({id:i.id,verdict,
    explanation:'所列条款约定首期付款，按对应范围核对。',warning:verdict==='issues_found'?'金额范围存在冲突。':'',
    recommendation:'核对本次开票对应的付款范围。',evidenceIds:[i.evidenceIds[0]]}))};
}
export function fakeAgentSdk(execute) {
  const calls=[];
  return {calls,tool:(name,description,schema,handler)=>({name,description,schema,handler}),
    createSdkMcpServer:options=>options,
    query(request) {
      calls.push(request);
      const context={request,manifest:JSON.parse(request.prompt),
        call:(name,args)=>request.options.mcpServers.review.tools.find(t=>t.name===name).handler(args)};
      const stream=execute(context);
      stream.close=()=>{request.closed=true;};
      return stream;
    }};
}
export async function submitValid(context,pkg,verdict='reasonable') {
  await context.call('load_review_skill',{name:context.manifest.availableSkill});
  await context.call('get_evidence',{itemIds:pkg.items.map(i=>i.id)});
  return context.call('submit_review',agentReply(pkg,verdict));
}
export const agentSuccess={type:'result',subtype:'success',is_error:false,num_turns:5,
  modelUsage:{'deepseek-flash':{inputTokens:1200,outputTokens:300}}};
