import { readFileSync } from 'node:fs';
const catalog = JSON.parse(readFileSync(new URL('./material-catalog.json', import.meta.url), 'utf8'));
export function getMaterialCatalog() { return structuredClone(catalog); }
export function assessScenarioCoverage(profileId, materialTypes) {
  if (!Array.isArray(materialTypes) || materialTypes.some(x=>typeof x!=='string')) throw new Error('Expected material type array');
  const profile=catalog.profiles.find(p=>p.id===profileId);
  if (!profile) return {status:'NEI',reason:'unknown_scenario',catalogVersion:catalog.version};
  const present=new Set(materialTypes);
  const groups=profile.candidateMaterialGroups.map(alternatives=>({alternatives,present:alternatives.filter(t=>present.has(t))}));
  return {status:'NEI',reason:'candidate_material_coverage_not_policy_verification',profileId,
    catalogVersion:catalog.version,policyStatus:catalog.policyStatus,researchedAt:catalog.researchedAt,
    sources:catalog.sources.filter(s=>profile.sourceIds.includes(s.id)),groups,
    missingCandidateGroups:groups.filter(g=>!g.present.length).map(g=>g.alternatives),
    requiredMissing:[],mandatoryPolicyEvaluated:false,rulesExecuted:[],proposedRules:profile.proposedRules,exceptions:profile.exceptions};
}
