import test from 'node:test';
import assert from 'node:assert/strict';
import { getMaterialCatalog, assessScenarioCoverage } from '../src/modules/image/documents/server/catalog.js';
test('all profiles reference primary sources and do not activate proposed checks',()=>{
  const c=getMaterialCatalog();assert.equal(c.profiles.length,12);
  for (const p of c.profiles) {
    assert.ok(p.sourceIds.every(id=>c.sources.some(s=>s.id===id&&s.url.startsWith('https://'))));
    const r=assessScenarioCoverage(p.id,p.candidateMaterialGroups.flat());
    assert.equal(r.status,'NEI');assert.equal(r.mandatoryPolicyEvaluated,false);assert.deepEqual(r.rulesExecuted,[]);
  }
});
test('missing optional alternatives are coverage gaps, never forged or mandatory',()=>{
  const r=assessScenarioCoverage('inheritance',['identity','will']);
  assert.ok(r.missingCandidateGroups.length);assert.deepEqual(r.requiredMissing,[]);
  assert.ok(r.groups.some(g=>g.present.includes('will')));
  assert.equal(assessScenarioCoverage('unknown',[]).reason,'unknown_scenario');
});
test('catalog is not mutable through callers',()=>{
  getMaterialCatalog().profiles.length=0;assert.equal(getMaterialCatalog().profiles.length,12);
});
