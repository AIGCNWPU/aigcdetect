// Internal trusted-context calculation. No automatic grouping or tax registry claim.
export function invoiceSets(context,index,{decimal,evidence}) {
 const refKey=r=>`${r?.materialId}\0${r?.fieldId}`;
 const text=s=>typeof s==='string'&&s.trim();
 const fmt=v=>`${v<0n?'-':''}${(v<0n?-v:v)/1000000n}.${String((v<0n?-v:v)%1000000n).padStart(6,'0')}`;
 return (context.invoiceSets??[]).map(group=>{
  const selected=[group.target,...(group.invoices??[])].map(r=>index.fields.get(refKey(r)));
  const refs=selected.filter(Boolean).map(x=>evidence(x.material,x.field));
  const out=(status,reason,extra={})=>({rule:'invoice_set_net_sum',ruleVersion:'invoice-set/0.1',status,reason,evidence:refs,groupId:group.id,...extra});
  if(selected.some(x=>!x))return out('NEI','missing_field_reference');
  if(group.complete!==true||group.scopeConfirmed!==true||!text(group.reviewer)||!text(group.reason)||!group.invoices?.length)return out('NEI','incomplete_or_unconfirmed_invoice_set');
  if(group.invoices.some(r=>refKey(r)===refKey(group.target)))return out('NEI','target_cannot_be_its_own_invoice_evidence');
  const [target,...items]=selected;
  if(selected.some(x=>x.field.key!=='gross_amount'||x.field.confidence<.90||x.field.extractionAmbiguous||!x.field.currency||x.field.currency!==target.field.currency))return out('NEI','amount_semantics_currency_or_recognition_not_comparable');
  if(items.some(x=>!['invoice','digital_invoice'].includes(x.material.type)))return out('NEI','invoice_material_type_not_confirmed');
  const unique=new Map(),numbers=new Map();
  try {
   for(const x of items) {
    const f=x.field;
    if(!text(f.invoiceIssuer)||!text(f.invoiceReference))return out('NEI','invoice_identity_missing');
    // Legacy number alone is not globally unique: code and issuer are required.
    if(x.material.type==='invoice'&&!text(f.invoiceCode))return out('NEI','legacy_invoice_code_missing');
    const key=JSON.stringify([f.invoiceIssuer,f.invoiceCode??'',f.invoiceReference]);
    if(unique.has(key)&&decimal(unique.get(key).field.value)!==decimal(f.value))return out('NEI','duplicate_invoice_values_conflict');
    unique.set(key,x);numbers.set(refKey({materialId:x.material.id,fieldId:f.id}),x);
   }
   for(const x of unique.values()) if(decimal(x.field.value)<0n) {
    const link=(group.redReferences??[]).find(r=>refKey(r.red)===refKey({materialId:x.material.id,fieldId:x.field.id}));
    const original=link&&numbers.get(refKey(link.original));
    if(!original||!text(link.reason)||decimal(original.field.value)<=0n||original.field.invoiceIssuer!==x.field.invoiceIssuer)return out('NEI','red_invoice_original_relationship_missing');
   }
   const total=[...unique.values()].reduce((sum,x)=>sum+decimal(x.field.value),0n),expected=decimal(target.field.value),diff=total-expected;
   return out(diff>=-10000n&&diff<=10000n?'PASS':'FAIL','confirmed_complete_invoice_set_net_sum',{actual:fmt(total),expected:fmt(expected),tolerance:'0.01',currency:target.field.currency,deduplicatedInvoices:items.length-unique.size,relationshipEvidence:structuredClone(group)});
  }catch{return out('NEI','ambiguous_numeric_text');}
 });
}
