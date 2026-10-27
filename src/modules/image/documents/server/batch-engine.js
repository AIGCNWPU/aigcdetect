import { createHash } from 'node:crypto';
import { displayedDate } from './date-fields.js';
import { invoiceSets } from './invoice-sets.js';
import { documentChecks } from './document-rules.js';
import { pairCoverage } from './cross-material-coverage.js';

// Internal scene service, not an HTTP request schema or authentication boundary.
export const ENGINE_VERSION = 'material-batch/0.3';
const SCALE = 1000000n;
const invariantKeys = new Set(['tax_identifier', 'identity_number', 'birth_date', 'invoice_number', 'transaction_number']);
const comparableKeys = new Set(['tax_identifier','identity_number','birth_date','invoice_number','transaction_number','issue_date','name','gender','registered_address','current_address','gross_amount','net_amount','tax_amount','payment_amount','invoice_date','transaction_date']);
const transactionKeys = new Set(['gross_amount', 'net_amount', 'tax_amount', 'payment_amount', 'invoice_number', 'transaction_number', 'invoice_date', 'transaction_date']);
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const nonempty = value => typeof value === 'string' && value.trim().length > 0;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]));
  return value;
}
export function fingerprint(value) { return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex'); }
export function decimal(value) {
  assert(typeof value === 'string' && /^[+-]?\d{1,15}(?:\.\d{1,6})?$/.test(value), 'Ambiguous decimal');
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = value.replace(/^[+-]/, '').split('.');
  return (BigInt(whole) * SCALE + BigInt(fraction.padEnd(6, '0'))) * (negative ? -1n : 1n);
}
function formatted(value) {
  const sign = value < 0 ? '-' : '';
  const abs = value < 0 ? -value : value;
  return `${sign}${abs / SCALE}.${String(abs % SCALE).padStart(6, '0')}`;
}
const abs = value => value < 0 ? -value : value;
const normalized = field => field.value.trim().normalize('NFC');
const refKey = ref => `${ref.materialId}\0${ref.fieldId}`;

export function validateBatch(batch) {
  assert(batch && nonempty(batch.id) && Number.isInteger(batch.version) && batch.version > 0, 'Invalid batch identity/version');
  assert(Array.isArray(batch.materials) && batch.materials.length > 0 && batch.materials.length <= 200, 'Invalid internal batch material count');
  const materials = new Map();
  const fields = new Map();
  for (const material of batch.materials) {
    assert(nonempty(material.id) && !materials.has(material.id), 'Duplicate or invalid material id');
    assert(Number.isInteger(material.version) && material.version > 0 && /^[a-f0-9]{64}$/.test(material.fileSha256), 'Invalid material version/hash');
    assert(nonempty(material.type) && Array.isArray(material.pages) && (material.pages.length > 0 || material.representation === 'docx_text'), 'Missing material type/pages');
    const pages = new Map();
    for (const page of material.pages) {
      assert(Number.isInteger(page.number) && page.number > 0 && !pages.has(page.number), 'Invalid or duplicate page');
      assert(['succeeded', 'failed', 'not_run', 'resource_limit'].includes(page.status), 'Invalid page status');
      if (page.status === 'succeeded') assert(Number.isFinite(page.width) && page.width > 0 && Number.isFinite(page.height) && page.height > 0, 'Missing rendered page dimensions');
      pages.set(page.number, page);
    }
    assert(Array.isArray(material.fields) && material.fields.length <= 10000, 'Missing/oversized fields');
    const ids = new Set();
    for (const field of material.fields) {
      assert(nonempty(field.id) && !ids.has(field.id) && nonempty(field.key) && nonempty(field.role), 'Invalid/duplicate field identity');
      ids.add(field.id);
      assert(typeof field.value === 'string' && field.value.length <= 10000 && Number.isInteger(field.version) && field.version > 0, 'Invalid field value/version');
      assert(Number.isFinite(field.confidence) && field.confidence >= 0 && field.confidence <= 1, 'Invalid OCR confidence');
      const source = field.source;
      assert(source && source.fileSha256 === material.fileSha256 && nonempty(source.provider) && nonempty(source.observedText), 'Missing/mismatched field source');
      if(source.provider==='docx_xml') {
        const location=source.location,positive=n=>Number.isInteger(n)&&n>0;
        assert(material.representation==='docx_text'&&location?.part==='word/document.xml','Missing DOCX source part/representation');
        assert((positive(location.paragraph)&&location.table===undefined)||(positive(location.table)&&positive(location.row)&&positive(location.cell)),'Invalid DOCX structural location');
        assert(source.page===undefined&&source.polygon===undefined,'DOCX XML cannot claim visual page coordinates');
      } else {
        const page = pages.get(source.page);
        assert(page?.status === 'succeeded', 'Field references unavailable page');
        assert(Array.isArray(source.polygon) && source.polygon.length === 4 && source.polygon.every(p => Array.isArray(p) && p.length === 2 && p.every((v,i) => Number.isFinite(v) && v >= 0 && v <= (i ? page.height : page.width))), 'Out of bounds field evidence');
        const twiceArea = source.polygon.reduce((sum,p,i)=>{ const next=source.polygon[(i+1)%4]; return sum+p[0]*next[1]-next[0]*p[1]; },0);
        assert(Math.abs(twiceArea) > 0, 'Degenerate field evidence');
      }
      fields.set(refKey({ materialId: material.id, fieldId: field.id }), { material, field });
      assert(fields.size <= 2000, 'Internal field budget exceeded');
    }
    materials.set(material.id, material);
  }
  return { materials, fields };
}

export function evidence(material, field) {
  return { materialId: material.id, materialVersion: material.version, fieldId: field.id,
    fieldVersion: field.version, key: field.key, role: field.role, value: field.value,
    confidence: field.confidence, source: structuredClone(field.source) };
}
function result(rule, status, reason, refs = [], extra = {}) {
  return { rule, ruleVersion: ENGINE_VERSION, status, reason, evidence: refs, ...extra };
}

function linkedRelation(left, right, relations, index) {
  const needed = transactionKeys.has(left.field.key) ? 'same_transaction' : 'same_entity';
  for (const relation of relations) {
    if (relation.kind !== needed || relation.status !== 'confirmed' || !nonempty(relation.reviewer) || !nonempty(relation.reason)) continue;
    const a = { materialId: left.material.id, role: left.field.role };
    const b = { materialId: right.material.id, role: right.field.role };
    const eq = (x,y) => x?.materialId === y.materialId && x.role === y.role;
    if (!(eq(relation.left,a) && eq(relation.right,b)) && !(eq(relation.left,b) && eq(relation.right,a))) continue;
    // Evidence may be independent source fields, or explicit trusted reviewer confirmation.
    const compared = new Set([refKey({materialId:a.materialId,fieldId:left.field.id}),refKey({materialId:b.materialId,fieldId:right.field.id})]);
    const basis = relation.basis ?? [];
    const independent = basis.length > 0 && basis.every(ref => {
      const source=index.fields.get(refKey(ref));
      return source && !compared.has(refKey(ref)) && source.field.confidence>=.90 && !source.field.extractionAmbiguous && normalized(source.field);
    });
    if (!independent && relation.basisType !== 'reviewer_confirmation') continue;
    return relation;
  }
  return null;
}

export function compare(left, right, context, index) {
  const {field:a, material:ma} = left, {field:b, material:mb} = right;
  const refs = [evidence(ma,a),evidence(mb,b)];
  if (a.key !== b.key) return result('field_comparison', 'NOT_APPLICABLE', 'same_text_different_semantics', refs);
  if (!comparableKeys.has(a.key)) return result('field_comparison','NEI','field_rule_not_configured',refs);
  const relation = linkedRelation(left, right, context.relations ?? [], index);
  if (!relation) return result('field_comparison', 'NEI', 'relationship_or_role_not_confirmed', refs);
  if (a.confidence < 0.90 || b.confidence < 0.90 || a.extractionAmbiguous || b.extractionAmbiguous) return result('field_comparison', 'NEI', 'recognition_requires_review', refs);
  if (!normalized(a) || !normalized(b)) return result('field_comparison','NEI','missing_field_value',refs);
  if (a.key === 'invoice_number' && relation.documentScopeConfirmed !== true) return result('field_comparison','NEI','same_invoice_not_confirmed',refs);
  if (a.key.endsWith('_date')) {
    if (a.key !== 'birth_date' && !relation.dateScopeConfirmed) return result('field_comparison','NEI','same_date_event_not_confirmed',refs);
    const av=displayedDate(a.value,a.dateFormat),bv=displayedDate(b.value,b.dateFormat);
    if (av.status!=='PASS'||bv.status!=='PASS') return result('field_comparison','NEI','date_requires_format_or_calendar_review',refs);
    return result('field_comparison',av.canonical===bv.canonical?'PASS':'FAIL','confirmed_relation_calendar_date_comparison',refs,{relationId:relation.id});
  }
  const amount = a.key.endsWith('_amount');
  if (!invariantKeys.has(a.key) && !amount && (!a.period || !b.period || a.period !== b.period)) {
    return result('field_comparison', a.period && b.period ? 'NOT_APPLICABLE' : 'NEI', 'effective_period_not_comparable', refs);
  }
  if (amount) {
    if (!a.currency || a.currency !== b.currency) return result('field_comparison', 'NOT_APPLICABLE', 'currency_not_comparable', refs);
    if (!a.basis || a.basis !== b.basis || !relation.amountScopeConfirmed) return result('field_comparison', 'NEI', 'amount_scope_or_basis_not_confirmed', refs);
    try { return result('field_comparison', decimal(a.value) === decimal(b.value) ? 'PASS' : 'FAIL', 'same_scope_amount_comparison', refs, {relationId:relation.id}); }
    catch { return result('field_comparison', 'NEI', 'ambiguous_numeric_text', refs); }
  }
  return result('field_comparison', normalized(a) === normalized(b) ? 'PASS' : 'FAIL', 'confirmed_relation_field_comparison', refs, {relationId:relation.id});
}

export function invoiceArithmetic(material) {
  if (!['invoice','digital_invoice','receipt'].includes(material.type)) return [];
  // Ordinary payment receipts have no invoice tax columns. Only run their
  // arithmetic when an actual tax column was extracted from the document.
  if (material.type === 'receipt' && !material.fields.some(f => ['net_amount','tax_amount'].includes(f.key))) return [];
  const keys = ['net_amount','tax_amount','gross_amount'];
  const choices = keys.map(key => material.fields.filter(f => f.key === key));
  const refs = choices.flat().map(f => evidence(material,f));
  if (choices.some(a => a.length !== 1)) return [result('invoice_net_tax_gross','NEI','missing_or_ambiguous_amounts',refs)];
  const fields = choices.map(a => a[0]);
  if (fields.some(f => f.confidence < 0.90 || f.extractionAmbiguous)) return [result('invoice_net_tax_gross','NEI','recognition_requires_review',refs)];
  if (!fields[0].currency || fields.some(f => f.currency !== fields[0].currency)) return [result('invoice_net_tax_gross','NEI','currency_not_comparable',refs)];
  try {
    const [net,tax,gross] = fields.map(f => decimal(f.value));
    return [result('invoice_net_tax_gross',abs(net+tax-gross) <= 10000n ? 'PASS':'FAIL','displayed_amount_arithmetic_only',refs,
      {expected:formatted(net+tax),actual:formatted(gross),netAmount:formatted(net),taxAmount:formatted(tax),difference:formatted(abs(net+tax-gross)),tolerance:'0.01',currency:fields[0].currency})];
  } catch { return [result('invoice_net_tax_gross','NEI','ambiguous_numeric_text',refs)]; }
}

export function dateChecks(material) {
  return material.fields.filter(f=>f.key.endsWith('_date')&&f.valueType!=='table_column').map(field=>{
    const checked=field.confidence < .90 || field.extractionAmbiguous ? {status:'NEI',reason:'recognition_requires_review'} : displayedDate(field.value,field.dateFormat);
    return result('displayed_calendar_date',checked.status,checked.reason,[evidence(material,field)],{canonical:checked.canonical??null});
  });
}

export function settlements(context,index) {
  return (context.settlements ?? []).map(group => {
    const refs = [group.target, ...(group.payments ?? [])];
    const selected = refs.map(ref => index.fields.get(refKey(ref)));
    if (selected.some(x => !x)) return result('settlement_sum','NEI','missing_field_reference',[],{groupId:group.id});
    const evidenceRefs = selected.map(x => evidence(x.material,x.field));
    if (group.complete !== true || group.scopeConfirmed !== true || !nonempty(group.reviewer) || !nonempty(group.reason) || !group.payments.length) return result('settlement_sum','NEI','incomplete_or_unconfirmed_settlement_scope',evidenceRefs);
    const [target,...payments] = selected;
    if (!target.field.currency || selected.some(x => x.field.currency !== target.field.currency || x.field.confidence < .90 || x.field.extractionAmbiguous)) return result('settlement_sum','NEI','currency_or_recognition_not_comparable',evidenceRefs);
    if (payments.some(x => x.field.key !== 'payment_amount') || target.field.key !== 'gross_amount') return result('settlement_sum','NEI','payment_semantics_not_explicit',evidenceRefs);
    // Same file/field selected twice is never counted twice. Different evidence for
    // the same receipt is unresolved until a reviewer confirms unique transactions.
    const unique = new Map();
    for (const payment of payments) {
      const f = payment.field;
      if (!nonempty(f.paymentReference) || !nonempty(f.paymentIssuer)) return result('settlement_sum','NEI','payment_transaction_identity_missing',evidenceRefs);
      const key = `${f.paymentIssuer}\0${f.paymentReference}`;
      if (unique.has(key)) {
        const previous = unique.get(key);
        if (previous.field.value !== f.value || previous.field.currency !== f.currency) return result('settlement_sum','NEI','duplicate_payment_values_conflict',evidenceRefs);
      } else unique.set(key,payment);
    }
    try {
      const total = [...unique.values()].reduce((sum,x) => sum+decimal(x.field.value),0n);
      const expected = decimal(target.field.value);
      return result('settlement_sum',abs(total-expected)<=10000n?'PASS':'FAIL','confirmed_complete_settlement_sum',evidenceRefs,
        {groupId:group.id,expected:formatted(expected),actual:formatted(total),deduplicatedPayments:payments.length-unique.size,tolerance:'0.01'});
    } catch { return result('settlement_sum','NEI','ambiguous_numeric_text',evidenceRefs); }
  });
}

export function evaluateBatch(batch, context = {}) {
  const index = validateBatch(batch);
  if ((context.relations?.length ?? 0) || (context.settlements?.length ?? 0) || (context.invoiceSets?.length ?? 0)) {
    assert(context.batchId === batch.id, 'Trusted context belongs to another batch');
    assert(context.batchVersion === batch.version, 'Trusted context is stale; reconfirm relationships after revisions');
  }
  // context is supplied by a trusted server adapter, never forwarded from client JSON.
  const results = batch.materials.flatMap(m=>[...invoiceArithmetic(m),...dateChecks(m),...documentChecks(m,{evidence,decimal})]);
  const candidates = [];
  const materialList = batch.materials;
  const duplicates = [];
  const pairs = [];
  for (let i=0;i<materialList.length;i++) for (let j=i+1;j<materialList.length;j++) {
    const a=materialList[i], b=materialList[j];
    if (a.fileSha256 === b.fileSha256) {
      duplicates.push({materialIds:[a.id,b.id],reason:'identical_file_not_proof_of_duplicate_reimbursement'});
    }
    const pairChecks=[];
    for (const af of a.fields) for (const bf of b.fields) {
      if (af.key !== bf.key && (!normalized(af) || normalized(af) !== normalized(bf))) continue;
      assert(candidates.length < 50000, 'Candidate budget exceeded; narrow the batch explicitly');
      const checked=compare({material:a,field:af},{material:b,field:bf},context,index);
      const relation=linkedRelation({material:a,field:af},{material:b,field:bf},context.relations??[],index);
      if (relation) checked.relationshipEvidence=structuredClone(relation);
      candidates.push(checked);
      pairChecks.push(checked);
    }
    pairs.push(pairCoverage(a,b,pairChecks,a.fileSha256===b.fileSha256));
  }
  results.push(...settlements(context,index),...invoiceSets(context,index,{decimal,evidence}));
  const incompletePages=batch.materials.flatMap(m=>m.pages.filter(p=>p.status!=='succeeded').map(p=>({materialId:m.id,page:p.number,status:p.status})));
  return {engineVersion:ENGINE_VERSION,batchId:batch.id,batchVersion:batch.version,
    inputFingerprint:fingerprint({batch,context}),execution:incompletePages.length?'partial':'succeeded',
    checks:results,candidates,duplicates,incompletePages,pairs,
    visualFindings:[],externalVerification:'not_run',overallAuthenticity:null,
    coverage:{materialCount:batch.materials.length,fieldCount:index.fields.size,candidateCount:candidates.length,
      unimplemented:['document_specific_legal_rules','automatic_entity_resolution','official_registry_verification','complete_C01_C15_G01_G08']}};
}

export function isCurrent(result,batch,context={}) { return result.engineVersion === ENGINE_VERSION && result.inputFingerprint === fingerprint({batch,context}); }

export function reviseField(batch,reference,{value,reason,actor,expectedFieldVersion}) {
  const index=validateBatch(batch);
  const original=index.fields.get(refKey(reference));
  assert(original && original.field.version===expectedFieldVersion,'Stale or missing field revision');
  assert(nonempty(reason)&&nonempty(actor)&&typeof value==='string','Revision needs actor, reason and value');
  const revised=structuredClone(batch);
  const material=revised.materials.find(m=>m.id===reference.materialId);
  const field=material.fields.find(f=>f.id===reference.fieldId);
  const history={value:field.value,version:field.version,actor,reason};
  field.history=[...(field.history??[]),history];
  field.value=value;field.version++;material.version++;revised.version++;
  // Keep raw OCR source and confidence. Human correction does not retroactively
  // change what the OCR recognized or create a model confidence of 1.
  validateBatch(revised);
  return revised;
}
