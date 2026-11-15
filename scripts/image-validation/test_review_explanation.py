import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'src/modules/image/documents/python'))
from deepseek_explainer import make_summary, validate_outbound, ExplanationError
from review_explanation import ExplanationBudget, make_target_summary


class BudgetTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        self.prompt=self.root/'prompt.txt';self.prompt.write_text('test-only prompt')
        self.summary=make_summary({'status':'succeeded','detector_score':.8,'oriented_size':[100,100],
            'regions':[{'box':[10,10,20,20]}]},checks=[{'rule':'invoice_net_tax_gross','status':'FAIL'}])
        self.settings={'DEEPSEEK_ENABLED':'true','DEEPSEEK_API_KEY':'test-only-not-real','DEEPSEEK_MODEL':'deepseek-flash'}
        self.calls=0

    def sender(self,*args):
        self.calls+=1
        return {'status':'succeeded','explanation':{'summary':'本地规则存在矛盾，未确认篡改','observations':[],
            'rule_explanations':[{'rule_id':'rule-1','explanation':'需复核金额口径'}],'limitations':['未查看原图']}}

    def test_default_never_calls(self):
        b=ExplanationBudget(self.root/'run')
        self.assertEqual(b.run(self.summary,{},self.prompt,sender=self.sender)['reason'],'debug_disabled')
        self.assertEqual(self.calls,0)

    def test_no_alarm_never_calls(self):
        self.summary['detector']['uncalibrated_score']=.2
        b=ExplanationBudget(self.root/'run',1)
        self.assertEqual(b.run(self.summary,self.settings,self.prompt,enabled=True,sender=self.sender)['reason'],'no_local_tamper_alarm')
        self.assertEqual(self.calls,0)

    def test_cache_and_persistent_budget(self):
        b=ExplanationBudget(self.root/'run',1)
        self.assertTrue(b.run(self.summary,self.settings,self.prompt,enabled=True,sender=self.sender)['api_called'])
        b=ExplanationBudget(self.root/'run',1)
        self.assertTrue(b.run(self.summary,self.settings,self.prompt,enabled=True,sender=self.sender)['cache_hit'])
        self.prompt.write_text('different prompt version')
        self.assertEqual(b.run(self.summary,self.settings,self.prompt,enabled=True,sender=self.sender)['reason'],'debug_budget_exhausted')
        self.assertEqual(self.calls,1)

    def test_failed_attempt_spends_budget_no_retry(self):
        b=ExplanationBudget(self.root/'run',1)
        def fail(*args):raise RuntimeError('do not persist provider body')
        self.assertEqual(b.run(self.summary,self.settings,self.prompt,enabled=True,sender=fail)['status'],'failed')
        self.assertEqual(b.run(self.summary,self.settings,self.prompt,enabled=True,sender=self.sender)['reason'],'debug_budget_exhausted')
        self.assertNotIn('provider body',(self.root/'run/budget.json').read_text())

    def test_unknown_evidence_rejected(self):
        b=ExplanationBudget(self.root/'run',1)
        def wrong(*args):
            result=self.sender();result['explanation']['rule_explanations'][0]['rule_id']='rule-999';return result
        self.assertEqual(b.run(self.summary,self.settings,self.prompt,enabled=True,sender=wrong)['status'],'failed')
        self.assertEqual(len(list((self.root/'run').glob('*.json'))),1)

    def test_raw_text_cannot_cross_boundary(self):
        b=ExplanationBudget(self.root/'run',1)
        self.summary['raw_ocr']='private text'
        with self.assertRaises(ExplanationError):b.run(self.summary,self.settings,self.prompt,enabled=True,sender=self.sender)
        self.assertEqual(self.calls,0)

    def test_budget_cannot_be_increased_in_same_experiment(self):
        b=ExplanationBudget(self.root/'run',1)
        b.run(self.summary,self.settings,self.prompt,enabled=True,sender=self.sender)
        with self.assertRaises(ExplanationError):ExplanationBudget(self.root/'run',3).run(self.summary,self.settings,self.prompt,enabled=True,sender=self.sender)

    def test_missing_config_does_not_spend(self):
        b=ExplanationBudget(self.root/'run',1)
        self.assertEqual(b.run(self.summary,{},self.prompt,enabled=True,sender=self.sender)['reason'],'provider_not_configured')
        self.assertFalse((self.root/'run/budget.json').exists())

    def test_geometry_links_are_source_bound_and_contain_no_text(self):
        detector={'status':'succeeded','detector_score':.8,'oriented_size':[100,100],
                  'input_sha256':'a'*64,'regions':[{'box':[10,10,20,20]}]}
        polygon=[[11,11],[19,11],[19,19],[11,19]]
        ocr={'status':'succeeded','input_sha256':'a'*64,'regions':[{'polygon':polygon,'recognition_confidence':.8,'observed_text':'PRIVATE RAW'}]}
        evidence={'materialId':'PRIVATE-ID','source':{'page':1,'renderedSha256':'a'*64,'polygon':polygon,'observedText':'PRIVATE RAW'}}
        checks=[{'rule':'invoice_net_tax_gross','status':'FAIL','evidence':[evidence]}]
        summary=make_target_summary(detector,ocr,checks,material_id='PRIVATE-ID',page=1)
        self.assertEqual(summary['region_rule_links'],[{'region_id':'region-1','rule_id':'rule-1','association':'bounding_boxes_overlap_not_proof'}])
        self.assertEqual(summary['region_ocr_support'][0]['low_confidence_regions'],1)
        self.assertNotIn('PRIVATE',json.dumps(summary))
        self.assertNotIn('a'*64,json.dumps(summary))
        evidence['source']['renderedSha256']='b'*64
        self.assertEqual(make_target_summary(detector,ocr,checks,material_id='PRIVATE-ID',page=1)['region_rule_links'],[])

    def test_extra_outbound_free_text_and_unknown_link_are_rejected(self):
        summary={**self.summary,'schema':'redacted-target-review/0.2','region_rule_links':[], 'region_ocr_support':[]}
        validate_outbound(summary)
        summary['region_rule_links']=[{'region_id':'region-1','rule_id':'rule-999','association':'bounding_boxes_overlap_not_proof'}]
        with self.assertRaises(ExplanationError):validate_outbound(summary)
        summary['region_rule_links']=[];summary['free_text']='PRIVATE'
        with self.assertRaises(ExplanationError):validate_outbound(summary)


if __name__=='__main__':unittest.main()
