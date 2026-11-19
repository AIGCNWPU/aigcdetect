// Text locations are structural references, never invented page coordinates.
const labels=[
  ['本行税率','tax_rate','transaction'],['本行税额','line_tax_amount','transaction'],
  ['本行不含税金额','line_net_amount','transaction'],['本行计税方式','tax_method','transaction'],
  ['出差开始日期','travel_start_date','subject'],['出差结束日期','travel_end_date','subject'],
  ['合同生效日期','contract_start_date','transaction'],['合同截止日期','contract_end_date','transaction'],
  ['发票号码','invoice_number','transaction'],['交易编号','transaction_number','transaction'],
  ['合同编号','transaction_number','transaction'],['不含税金额','net_amount','transaction'],
  ['税额','tax_amount','transaction'],['价税合计（小写）','gross_amount','transaction'],
  ['合同总额','gross_amount','transaction'],['实付金额','payment_amount','transaction'],
  ['开票日期','invoice_date','transaction'],['出生日期','birth_date','subject'],
  ['身份证号','identity_number','subject'],['公民身份号码','identity_number','subject'],
  ['性别','gender','subject'],['姓名','name','subject'],['购买方名称','name','buyer'],
  ['销售方名称','name','seller'],['付款人','name','payer'],['收款人','name','payee'],
];
export function extractDocxFields(parsed,material) {
  const fields=[];
  for(const block of parsed.blocks || []) {
    for(const line of block.text.split('\n')) for(const [label,key,role] of labels) {
      const prefix=[label+'：',label+':'].find(p=>line.trim().startsWith(p));
      if(!prefix)continue;
      let value=line.trim().slice(prefix.length).trim();
      if(!value)continue;
      const field={id:`text-${fields.length+1}`,key,role,value,version:1,confidence:1,
        source:{provider:'docx_xml',fileSha256:material.fileSha256,observedText:line,
          location:{part:'word/document.xml',...block.source_location},
          extractionVersion:'docx-explicit-labels/0.1',scoreSemantics:'exact_xml_extraction_not_authenticity'}};
      if(label.startsWith('本行'))field.taxScope=`explicit-line:${block.id||JSON.stringify(block.source_location)}`;
      if(key.endsWith('_amount')) {
        const money=value.match(/^(?:人民币|CNY|[¥￥])\s*([+-]?\d{1,15}(?:\.\d{1,6})?)(?:元)?$/);
        if(money)Object.assign(field,{value:money[1],currency:'CNY',basis:key});
      }
      if(key.endsWith('_date')) {
        if(/^\d{4}-\d{2}-\d{2}$/.test(value))field.dateFormat='YYYY-MM-DD';
        if(/^\d{4}年\d{1,2}月\d{1,2}日$/.test(value))field.dateFormat='YYYY年MM月DD日';
      }
      fields.push(field);
    }
  }
  const counts=new Map();
  for(const f of fields)counts.set(`${f.role}:${f.key}:${f.taxScope||''}`,(counts.get(`${f.role}:${f.key}:${f.taxScope||''}`)||0)+1);
  for(const f of fields)if(counts.get(`${f.role}:${f.key}:${f.taxScope||''}`)>1)f.extractionAmbiguous=true;
  return fields;
}
