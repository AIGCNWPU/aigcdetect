// Visible status declarations, not a tax registry or an authenticity decision.
export const INVOICE_STATUS_VERSION='invoice-status/1.0';
export const INVOICE_STATUS_RULE='invoice_status_declaration';
export const INVOICE_STATUS_TITLE='票面无效或使用限制声明';
export const INVOICE_STATUS_VOCABULARY=['测试样张','发票样张','测试发票','样票','样张','测试联','测试版','仅供测试','仅供展示','无效','作废','禁止报销','不得报销','不得用于报销','不能作为报销凭证','禁止入账','报销凭证','入账凭证','本发票','此发票','该发票','本票','此票','该票','本凭证','本单据','票面状态','发票状态','状态','已被','已经','普通发票','电子发票','数电发票'];
const subject='(?:(?:本|此|该)?(?:电子|普通|数电)?发票|本票|此票|该票|本凭证|本单据)';
const declarations=[
  ['sample',new RegExp(`^(?:${subject}(?:为|系|是)?)?(?:测试样张|发票样张|测试发票|样票|样张|仅供(?:测试|展示)(?:使用)?)$`)],
  ['sample',/^(?:电子|普通|增值税|数电)?发票(?:测试联|测试版|样票|样张)$/],
  ['invalid',new RegExp(`^(?:${subject})?(?:当前状态|状态)?[:：]?(?:已被|已经|已|为|系|是)?(?:无效|作废)$`)],
  ['restricted',new RegExp(`^(?:${subject})?(?:禁止|不得|不能|不可|不允许)(?:用于|作为|用作)?(?:报销|入账)(?:凭证)?$`)],
  ['restricted',new RegExp(`^(?:${subject})?(?:不作为|非)(?:报销|入账)凭证$`)],
];
const normalize=text=>text.normalize('NFKC').replace(/[\s\u200b\u200c\u200d\ufeff]+/gu,'');
const positive=n=>Number.isInteger(n)&&n>0;

function matches(text) {
  // Match entire clauses. Negations, conditions, quotations and item/company
  // descriptions do not become declarations just because they contain a word.
  const unlabel=part=>normalize(part).replace(/^(?:备注|说明|提示|票面状态|发票状态|凭证状态|状态)[:：]/,'');
  return text.normalize('NFKC').split(/[。；;！!\n\r]+/u).flatMap(sentence=>{
    const context=unlabel(sentence);
    // Keep the condition/mention across commas: "若有涂改，本票无效" is
    // not the same declaration as "本票无效" on its own.
    if(/[？?]/u.test(sentence)||/^(?:若|如果|如有|如遇|如发生|一旦|假如|倘若|涂改|复印|复制|未盖章|逾期|过期|超过有效期|未发现|请勿|示例|商品名称[:：]|项目名称[:：]|购买方[:：]|销售方[:：]|名称[:：])/u.test(context))return [];
    return sentence.split(/[，,·•/|]+/u).flatMap(part=>{
      const clause=unlabel(part).replace(/^【([^【】]+)】$/,'$1');
      const match=declarations.find(([,pattern])=>pattern.test(clause));
      return match?[{kind:match[0],text:clause}]:[];
    });
  });
}

function boundSource(material,block) {
  const source=block.source;
  if(!source||source.fileSha256!==material.fileSha256)return false;
  if(source.provider==='docx_xml') {
    const l=source.location;
    return material.representation==='docx_text'&&l?.part==='word/document.xml'&&
      ((positive(l.paragraph)&&l.table===undefined)||(positive(l.table)&&positive(l.row)&&positive(l.cell)))&&
      source.page===undefined&&source.polygon===undefined&&block.page===undefined;
  }
  if(source.provider!=='ocr'||!positive(source.page)||(block.page!==undefined&&block.page!==source.page))return false;
  const page=material.pages.find(p=>p.number===source.page),polygon=source.polygon;
  if(page?.status!=='succeeded'||!Array.isArray(polygon)||polygon.length!==4||!polygon.every(p=>Array.isArray(p)&&p.length===2&&p.every((v,i)=>Number.isFinite(v)&&v>=0&&v<=(i?page.height:page.width))))return false;
  return Math.abs(polygon.reduce((sum,p,i)=>{const n=polygon[(i+1)%4];return sum+p[0]*n[1]-n[0]*p[1];},0))>0;
}

export function invoiceStatusChecks(material) {
  const blocks=Array.isArray(material.textBlocks)?material.textBlocks.slice(0,2000):[];
  const usable=b=>typeof b?.id==='string'&&b.id.trim()&&typeof b.text==='string'&&b.text.length<=10000;
  const reliable=b=>Number.isFinite(b.confidence)&&b.confidence>=.9&&b.confidence<=1&&boundSource(material,b);
  const invoiceTitle=/^(?:电子发票\((?:普通|增值税专用)发票\)|(?:增值税)?(?:电子)?(?:普通|专用)发票|普通发票测试联)$/;
  if(!['invoice','digital_invoice'].includes(material.type)&&!(material.type==='unknown'&&blocks.some(b=>usable(b)&&reliable(b)&&invoiceTitle.test(normalize(b.text)))))return [];
  const groups={confirmed:[],uncertain:[]};
  for(const block of blocks) {
    if(!usable(block))continue;
    const hits=matches(block.text);if(!hits.length)continue;
    const ref={materialId:material.id,materialVersion:material.version,blockId:block.id,key:INVOICE_STATUS_RULE,role:'transaction',value:block.text,confidence:block.confidence,
      source:{...structuredClone(block.source||{}),observedText:block.text},matchedDeclarations:hits};
    groups[reliable(block)?'confirmed':'uncertain'].push(ref);
  }
  return Object.entries(groups).filter(([,refs])=>refs.length).map(([group,refs])=>{
    const confirmed=group==='confirmed',phrases=[...new Set(refs.flatMap(r=>r.matchedDeclarations.map(h=>h.text)))];
    return {rule:INVOICE_STATUS_RULE,ruleVersion:INVOICE_STATUS_VERSION,materialId:material.id,status:confirmed?'WARN':'NEI',
      reason:confirmed?'invoice_self_declared_restriction':'invoice_status_evidence_requires_review',
      title:confirmed?INVOICE_STATUS_TITLE:'票面状态文字待确认',
      explanation:confirmed?`票面明确标注“${phrases.join('”“')}”，存在样张、无效/作废或使用限制声明，请核对原件及有效凭证。此结果仅针对票面文字，不代表已查验税务状态或证实造假。`:'识别文字疑似包含样张、无效/作废或使用限制声明，但识别质量或来源定位不足，请核对原图后确认。',
      scope:'visible_invoice_declaration_only',declarations:[...new Set(refs.flatMap(r=>r.matchedDeclarations.map(h=>h.kind)))],evidence:refs};
  });
}
