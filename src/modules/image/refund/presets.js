/** Input-only public research samples. Expected verdicts never enter model requests. */
const refundCupAsset=Object.freeze({path:'./public/refund-demos/cup-evidence.png',name:'杯身凹陷凭证.png',type:'image/png',sha256:'2bc10c4b66a520d7de6befc5ce586d91af5a46955502efb337039864823c5c2d'});
const refundKnifeAsset=Object.freeze({path:'./public/refund-demos/knife-evidence.jpg',name:'刀身锈迹凭证.jpg',type:'image/jpeg',sha256:'9e9863ab8c549a740cbacbb4982af4791385cfab9663831860393e9a232c54d2'});
const refundCupFields=Object.freeze({productName:'带杯盖和吸管的随行杯',style:'粉紫色、金属光泽杯身',productInfo:'杯身呈金属光泽，配透明杯盖和吸管。',description:'前方杯身下部有一处明显凹陷。'});
export const refundPresets=Object.freeze([
  Object.freeze({id:'ds-match',title:'资料一致示例',description:'杯子凭证与商品资料相符',group:'商品资料核对',kinds:Object.freeze(['comparison']),fields:refundCupFields,image:refundCupAsset}),
  Object.freeze({id:'ds-mismatch',title:'商品错配示例',description:'杯子凭证搭配运动鞋资料',group:'商品资料核对',kinds:Object.freeze(['comparison']),fields:Object.freeze({productName:'红色运动鞋',style:'红色鞋面、白色鞋底',productInfo:'鞋带式运动鞋，红色鞋面、白色鞋底。',description:'前方杯身下部有一处明显凹陷。'}),image:refundCupAsset}),
  Object.freeze({id:'cospy-real',title:'真实照片示例',description:'公开样本中的真实刀身锈迹照',group:'AI来源风险',kinds:Object.freeze(['ai']),fields:Object.freeze({productName:'厨房刀具',style:'木色握柄、银色刀身',productInfo:'带木色握柄的厨房刀具。',description:'刀身表面出现锈迹。'}),image:refundKnifeAsset}),
  Object.freeze({id:'cospy-ai',title:'AI 编辑示例',description:'公开样本中的AI杯身凹陷图',group:'AI来源风险',kinds:Object.freeze(['ai']),fields:refundCupFields,image:refundCupAsset}),
]);

export async function loadRefundPresetFile(preset,{signal,request=fetch}={}) {
  if(!refundPresets.includes(preset))throw new Error('演示预设不存在。');
  const response=await request(preset.image.path,{signal});
  if(!response.ok)throw new Error('演示图片读取失败，请检查本机服务后重试。');
  const blob=await response.blob();
  if(!blob.size || blob.size>5*1024*1024)throw new Error('演示图片大小异常，未替换当前资料。');
  const bytes=await blob.arrayBuffer();
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  if(signal?.aborted)throw new DOMException('操作已取消','AbortError');
  if(hash!==preset.image.sha256)throw new Error('演示图片校验失败，未替换当前资料。');
  return new File([bytes],preset.image.name,{type:preset.image.type});
}
