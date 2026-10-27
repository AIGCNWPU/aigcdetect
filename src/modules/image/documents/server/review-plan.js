import {contentChecks,compareCoreContent,explainLocalCheck} from './content-rules.js';
import {validateBatch,fingerprint,evidence,decimal,compare,invoiceArithmetic,dateChecks,settlements} from './batch-engine.js';
import {documentChecks} from './document-rules.js';
import {invoiceSets} from './invoice-sets.js';
import {reviewScenario} from './review-scenarios.js';

export const REVIEW_VERSION='core-material-review/0.1';
const text=x=>typeof x==='string'&&x.trim().length>0;
const assert=(ok,message)=>{if(!ok)throw new Error(message);};
const refKey=x=>`${x?.materialId}\0${x?.fieldId}`;
const out=(rule,status,reason,refs=[],extra={})=>({rule,ruleVersion:REVIEW_VERSION,status,reason,evidence:refs,...extra});
const transactionKeys=new Set(['gross_amount','net_amount','tax_amount','payment_amount','invoice_number','transaction_number','invoice_date','transaction_date']);

function buildPlan(batch,options) {
  const index=validateBatch(batch),{coreMaterialId,objective}=options;
  assert(text(coreMaterialId)&&index.materials.has(coreMaterialId),'A valid coreMaterialId is required');
  assert(text(objective)&&objective.length<=100,'An objective is required');
  const relations=options.relations??[],groups=[...(options.settlements??[]).map(g=>({...g,kind:'settlement'})),...(options.invoiceSets??[]).map(g=>({...g,kind:'invoice_set'}))];
  assert(Array.isArray(relations)&&relations.length<=batch.materials.length*8,'Relation budget exceeded');
  assert(groups.length<=8,'Aggregate group budget exceeded');
  if(relations.length||groups.length) {
    assert(options.batchId===batch.id,'Trusted context belongs to another batch');
    assert(options.batchVersion===batch.version,'Trusted context is stale; reconfirm relationships after revisions');
  }
  const core=index.materials.get(coreMaterialId),scenario=reviewScenario(objective,core.type);
  const canonicalByHash=new Map([[core.fileSha256,core.id]]),duplicates=[],duplicateIds=new Set();
  for(const m of batch.materials) {
    if(m.id===core.id)continue;
    const canonical=canonicalByHash.get(m.fileSha256);
    if(canonical){duplicates.push({materialId:m.id,canonicalMaterialId:canonical,reason:'identical_file_not_proof_of_duplicate_reimbursement'});duplicateIds.add(m.id);}
    else canonicalByHash.set(m.fileSha256,m.id);
  }
  const edges=[],rejectedRelations=[],edgeIds=new Set(),perAux=new Map();
  for(const r of relations) {
    let reason=null;
    const a=r.left,b=r.right;
    if(!text(r.id)||edgeIds.has(r.id))throw new Error('Missing or duplicate relation id');
    edgeIds.add(r.id);
    const auxId=a?.materialId===core.id?b?.materialId:b?.materialId===core.id?a?.materialId:null;
    const aux=index.materials.get(auxId);
    if(!auxId||auxId===core.id)reason='not_adjacent_to_core';
    else if(!aux)reason='missing_related_material';
    else if(duplicateIds.has(aux.id))reason='duplicate_source_excluded';
    else if(scenario.status!=='PASS')reason='objective_scope_not_configured';
    else if(!scenario.profile.auxiliaryTypes.includes(aux.type))reason='material_type_outside_objective';
    else if(!['same_entity','same_transaction'].includes(r.kind)||!text(a?.role)||!text(b?.role))reason='relationship_semantics_not_configured';
    else if(r.status!=='confirmed'||!text(r.reviewer)||!text(r.reason))reason='relationship_not_confirmed';
    else if(r.basisType!=='reviewer_confirmation'&&!(Array.isArray(r.basis)&&r.basis.length>0&&r.basis.length<=20&&r.basis.every(ref=>{const x=index.fields.get(refKey(ref));return x&&x.field.confidence>=.9&&!x.field.extractionAmbiguous&&text(x.field.value);})))reason='independent_relationship_basis_missing';
    else if((perAux.get(auxId)??0)>=8)reason='per_material_relationship_budget';
    if(reason){rejectedRelations.push({relationId:r.id,materialId:auxId??null,status:'NEI',reason});continue;}
    perAux.set(auxId,(perAux.get(auxId)??0)+1);
    edges.push({relationId:r.id,coreMaterialId:core.id,auxiliaryMaterialId:auxId,kind:r.kind,coreRole:a.materialId===core.id?a.role:b.role,auxiliaryRole:a.materialId===core.id?b.role:a.role,amountScopeConfirmed:r.amountScopeConfirmed===true,dateScopeConfirmed:r.dateScopeConfirmed===true,documentScopeConfirmed:r.documentScopeConfirmed===true});
  }
  const aggregates=[],rejectedGroups=[],groupIds=new Set();
  let groupReferences=0;
  for(const g of groups) {
    assert(text(g.id)&&!groupIds.has(g.id),'Missing or duplicate aggregate group id');groupIds.add(g.id);
    const members=g.kind==='settlement'?g.payments:g.invoices;
    assert(Array.isArray(members)&&members.length<=200,'Invalid aggregate member budget');
    groupReferences+=members.length;assert(groupReferences<=1600,'Aggregate reference budget exceeded');
    let reason=null;
    if(g.target?.materialId!==core.id)reason='aggregate_target_is_not_core';
    else if(scenario.status!=='PASS'||objective==='identity_consistency')reason='aggregate_outside_objective';
    else if(members.some(ref=>ref.materialId===core.id))reason='target_cannot_be_its_own_evidence';
    else if(members.some(ref=>!index.fields.has(refKey(ref)))||!index.fields.has(refKey(g.target)))reason='missing_field_reference';
    else if(members.some(ref=>!scenario.profile.auxiliaryTypes.includes(index.materials.get(ref.materialId).type)))reason='aggregate_material_type_outside_objective';
    if(reason)rejectedGroups.push({groupId:g.id,status:'NEI',reason});
    else aggregates.push({id:g.id,kind:g.kind,materialIds:[...new Set(members.map(r=>r.materialId))],scopeConfirmed:g.scopeConfirmed===true,complete:g.complete===true});
  }
  const selected=new Set(edges.map(e=>e.auxiliaryMaterialId));
  for(const g of aggregates)for(const id of g.materialIds)selected.add(id);
  const excluded=batch.materials.filter(m=>m.id!==core.id&&!selected.has(m.id)).map(m=>({materialId:m.id,status:'NEI',reason:duplicateIds.has(m.id)?'duplicate_source_excluded':scenario.status!=='PASS'?'objective_scope_not_configured':!scenario.profile.auxiliaryTypes.includes(m.type)?'material_type_outside_objective':'no_confirmed_core_relationship'}));
  const plan={version:REVIEW_VERSION,coreMaterialId:core.id,coreMaterialVersion:core.version,objective,scenario,edges,aggregates,excluded,rejectedRelations,rejectedGroups,duplicates,limits:{materials:200,fields:2000,relationsPerMaterial:8,aggregateGroups:8,aggregateReferences:1600},complexity:{strategy:'core_star_with_explicit_aggregates',indexedMaterials:index.materials.size,indexedFields:index.fields.size,relationsInspected:relations.length,selectedEdges:edges.length,aggregateReferences:groupReferences}};
  return {plan,index,groups,relations};
}

/** options.relations/sets are trusted server context; never forward client JSON. */
export function planReview(batch,options={}) {return buildPlan(batch,options).plan;}

/** Convert an explicit local-user assertion into auditable context. This is NOT
 * external verification, authenticated identity, or automatic entity resolution.
 * HTTP adapters must pass this narrow input, never raw client relations. */
export function buildUserConfirmedRelations(batch,{coreMaterialId,confirmations=[]}={}) {
  const index=validateBatch(batch),core=index.materials.get(coreMaterialId);
  assert(core,'A valid coreMaterialId is required');
  assert(Array.isArray(confirmations)&&confirmations.length<=batch.materials.length*8,'Confirmation budget exceeded');
  const seen=new Set();
  const relations=confirmations.map(c=>{
    const aux=index.materials.get(c?.materialId);
    assert(aux&&aux.id!==core.id,'Confirmation references missing or core auxiliary material');
    assert(['same_entity','same_transaction'].includes(c.kind),'Unsupported confirmed relationship kind');
    assert(text(c.reason)&&c.reason.trim().length<=1000,'Confirmation requires a bounded reason');
    assert(text(c.coreRole)&&core.fields.some(f=>f.role===c.coreRole),'Core role does not exist in extracted fields');
    assert(text(c.auxiliaryRole)&&aux.fields.some(f=>f.role===c.auxiliaryRole),'Auxiliary role does not exist in extracted fields');
    const key=JSON.stringify([core.id,aux.id,c.kind,c.coreRole,c.auxiliaryRole]);
    assert(!seen.has(key),'Duplicate relationship confirmation');seen.add(key);
    const statement={kind:c.kind,left:{materialId:core.id,role:c.coreRole},right:{materialId:aux.id,role:c.auxiliaryRole},reason:c.reason.trim(),amountScopeConfirmed:c.amountScopeConfirmed===true,dateScopeConfirmed:c.dateScopeConfirmed===true,documentScopeConfirmed:c.documentScopeConfirmed===true};
    return {...statement,id:`user-confirmation-${fingerprint({batchId:batch.id,batchVersion:batch.version,...statement}).slice(0,24)}`,status:'confirmed',reviewer:'local-workbench-user',basisType:'reviewer_confirmation',trust:'user_asserted_not_external_verified',authentication:'not_available_in_local_workbench',materialVersions:{[core.id]:core.version,[aux.id]:aux.version}};
  });
  return {batchId:batch.id,batchVersion:batch.version,relations};
}

export function evaluateReview(batch,options={}) {
  const {plan,index,groups,relations}=buildPlan(batch,options);
  const perMaterial=batch.materials.map(m=>{
    // Explicit non-Chinese jurisdiction disables all China-specific format rules.
    const country=m.jurisdiction??options.jurisdiction??null;
    const countryChecks=country==='CN'?documentChecks(m,{evidence,decimal}):[out('jurisdiction_specific_rules','NEI',country?'jurisdiction_rule_pack_not_configured':'jurisdiction_not_confirmed',[],{jurisdiction:country})];
    const checks=[...invoiceArithmetic(m),...dateChecks(m),...countryChecks,...contentChecks(m,{evidence,decimal})];
    if(!m.fields.length)checks.push(out('field_extraction_coverage','NEI','no_supported_fields'));
    return {materialId:m.id,materialVersion:m.version,checks,fieldCount:m.fields.length};
  });
  const checks=perMaterial.flatMap(m=>m.checks.map(c=>({...c,materialId:m.materialId})));
  checks.push(out('scenario_applicability',plan.scenario.status,plan.scenario.reason,[],{sources:plan.scenario.sources}));
  checks.push(out('institution_policy','NEI','institution_policy_not_configured'));
  const lookup=new Map();
  for(const m of batch.materials){const fields=new Map();for(const f of m.fields){const k=`${f.role}\0${f.key}`;if(!fields.has(k))fields.set(k,[]);fields.get(k).push(f);}lookup.set(m.id,fields);}
  const relationMap=new Map(relations.map(r=>[r.id,r])),candidates=[];
  const core=index.materials.get(plan.coreMaterialId);
  for(const edge of plan.edges) {
    const aux=index.materials.get(edge.auxiliaryMaterialId),r=relationMap.get(edge.relationId);
    let emitted=0;
    for(const key of plan.scenario.profile.fieldKeys) {
      if(transactionKeys.has(key)!==(edge.kind==='same_transaction'))continue;
      const a=lookup.get(core.id).get(`${edge.coreRole}\0${key}`)??[],b=lookup.get(aux.id).get(`${edge.auxiliaryRole}\0${key}`)??[];
      if(!a.length&&!b.length)continue;
      emitted++;
      const refs=[...a.map(f=>evidence(core,f)),...b.map(f=>evidence(aux,f))];
      if(a.length!==1||b.length!==1)candidates.push(out('field_comparison','NEI','missing_or_ambiguous_role_field',refs,{relationId:r.id}));
      else candidates.push({...compare({material:core,field:a[0]},{material:aux,field:b[0]},{relations:[r]},index),relationshipEvidence:structuredClone(r)});
    }
    if(!emitted)candidates.push(out('core_relationship_coverage','NEI','no_comparable_fields_for_relation',[],{relationId:r.id,materialIds:[core.id,aux.id]}));
  }
  const groupMap=new Map(groups.map(g=>[g.id,g]));
  for(const group of plan.aggregates) {
    const g=groupMap.get(group.id);
    const context=group.kind==='settlement'?{settlements:[g]}:{invoiceSets:[g]};
    checks.push(...(group.kind==='settlement'?settlements(context,index):invoiceSets(context,index,{decimal,evidence})));
  }
  checks.push(...plan.rejectedGroups.map(g=>out('aggregate_selection','NEI',g.reason,[],{groupId:g.groupId})));
  const localContent=compareCoreContent(batch,{coreMaterialId:core.id},{evidence});
  plan.contentCandidates=localContent.candidates;
  candidates.push(...localContent.checks);
  for(const check of [...checks,...candidates])Object.assign(check,explainLocalCheck(check));
  const incompletePages=batch.materials.flatMap(m=>m.pages.length?m.pages.filter(p=>p.status!=='succeeded').map(p=>({materialId:m.id,page:p.number,status:p.status})):[{materialId:m.id,page:null,status:'not_run',reason:'text_only_no_rendered_pages'}]);
  return {localContent,engineVersion:REVIEW_VERSION,batchId:batch.id,batchVersion:batch.version,inputFingerprint:fingerprint({batch,options}),execution:incompletePages.length?'partial':'succeeded',plan,perMaterial,checks,candidates,duplicates:plan.duplicates,incompletePages,pairs:plan.edges,visualFindings:[],externalVerification:'not_run',overallAuthenticity:null,coverage:{materialCount:batch.materials.length,fieldCount:index.fields.size,candidateCount:candidates.length,excludedMaterialCount:plan.excluded.length,unimplemented:['institution_policy','official_registry_verification','complete_C01_C15_G01_G08']}};
}
