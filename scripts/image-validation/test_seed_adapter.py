import importlib.util
import json,sys,tempfile,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'src/modules/image/documents/python'))
from seed_detector import starts,components
from deepseek_explainer import make_summary,validate_outbound,validate_response,ExplanationError,read_settings,explain
class SeedTests(unittest.TestCase):
    def test_tile_coverage_no_gaps(self):
        for length in (1,511,512,513,1024,1025,1800):
            spans=starts(length);self.assertEqual(spans[0],0);self.assertTrue(spans[-1]+512>=length)
            self.assertTrue(all(b-a<=512 for a,b in zip(spans,spans[1:])))
    @unittest.skipUnless(importlib.util.find_spec('cv2'), 'Requires seed-runtime OpenCV')
    def test_component_geometry_and_all_regions(self):
        import numpy as np
        a=np.zeros((10,20),np.float32);a[2:5,4:9]=.8;a[7:9,15:19]=.9
        mask,regions=components(a);self.assertEqual(len(regions),2);self.assertEqual(regions[0]['box'],[4,2,9,5]);self.assertEqual(int(mask.sum()),23)
        a[0,0]=float('nan')
        with self.assertRaises(ValueError):components(a)
    def sample(self):
        return {'status':'succeeded','detector_score':.9,'oriented_size':[100,200],'input_sha256':'hash',
          'path':'/private/NAME','regions':[{'box':[0,0,10,20],'observed_text':'PRIVATE_ID_123'}]}
    def test_private_strings_not_outbound(self):
        s=make_summary(self.sample(),{'input_sha256':'hash','status':'succeeded','regions':[{'recognition_confidence':.5,'observed_text':'SECRET_ACCOUNT'}]},[{'rule':'invoice_net_tax_gross','status':'FAIL','evidence':'PRIVATE_AMOUNT'}]);validate_outbound(s)
        raw=json.dumps(s);self.assertNotIn('PRIVATE',raw);self.assertNotIn('SECRET',raw);self.assertNotIn('hash',raw)
    def test_raw_payload_injection_is_rejected_before_network(self):
        s=make_summary(self.sample());s['raw_text']='sensitive'
        with self.assertRaises(ExplanationError):validate_outbound(s)
        s=make_summary(self.sample());s['regions'][0]['region_id']='secret'
        with self.assertRaises(ExplanationError):validate_outbound(s)
    def test_unknown_response_evidence_rejected(self):
        s=make_summary(self.sample());v={'summary':'待复核','observations':[],'rule_explanations':[],'limitations':['未看原图']};validate_response(v,s)
        v['observations']=[{'region_id':'invented','explanation':'x','limitations':'x'}]
        with self.assertRaises(ExplanationError):validate_response(v,s)
    def test_disabled_or_missing_key_never_calls(self):
        s=make_summary(self.sample());self.assertEqual(explain(s,{},'missing')['reason'],'disabled')
        self.assertEqual(explain(s,{'DEEPSEEK_ENABLED':'true'},'missing')['reason'],'api_key_missing')
    def test_config_permissions_and_no_shell_evaluation(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'.env';p.write_text('DEEPSEEK_API_KEY=$(not_executed)\n');p.chmod(0o600)
            self.assertEqual(read_settings(p)['DEEPSEEK_API_KEY'],'$(not_executed)');p.chmod(0o644)
            with self.assertRaises(ExplanationError):read_settings(p)
    def test_foreign_endpoint_rejected_before_network(self):
        with self.assertRaises(ExplanationError):explain(make_summary(self.sample()),{'DEEPSEEK_ENABLED':'true','DEEPSEEK_API_KEY':'dummy-test-key','DEEPSEEK_BASE_URL':'https://example.com'},'unused')

class SeedEvidenceTests(unittest.TestCase):
    @unittest.skipUnless(importlib.util.find_spec('cv2'), 'Requires seed-runtime OpenCV')
    def test_real_mask_pixels_required_not_just_bounding_box(self):
        import numpy as np
        from seed_evidence import associate
        mask=np.zeros((10,20),np.uint8);mask[1:3,1:3]=1
        detector={'status':'succeeded','input_sha256':'h','oriented_size':[20,10],'regions':[{'region_id':'seed-1'}]}
        ocr={'status':'succeeded','input_sha256':'h','oriented_size':[20,10],'regions':[{'region_id':'o','polygon':[[10,1],[15,1],[15,4],[10,4]],'observed_text':'private','recognition_confidence':.99}]}
        self.assertEqual(associate(detector,ocr,mask)['links'],[])
        ocr['regions'][0]['polygon']=[[0,0],[4,0],[4,4],[0,4]]
        r=associate(detector,ocr,mask);self.assertEqual(r['links'][0]['seed_region_id'],'seed-1');self.assertEqual(r['links'][0]['observed_text'],'private')
        ocr['input_sha256']='changed'
        with self.assertRaises(ValueError):associate(detector,ocr,mask)

if __name__=='__main__':unittest.main()
