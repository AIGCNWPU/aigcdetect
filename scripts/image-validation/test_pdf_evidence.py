import copy
from pathlib import Path
import sys,unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'src/modules/image/documents/python'))
from pdf_evidence import bind_pdf_ocr
class PdfEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.m={'status':'succeeded','file_sha256':'parent','page_count':2,'pages':[{'page':i,'status':'succeeded','rendered_sha256':'same','rendered_size':[100,200],'pixel_to_pdf':[.5,0,0,-.5,0,100]} for i in (1,2)]}
        self.r={'samples':[{'sample_id':f'pdf-page-{i}','status':'succeeded','input_sha256':'same','oriented_size':[100,200],'regions':[{'region_id':'ocr-0','observed_text':'100.00','recognition_confidence':.95,'polygon':[[0,0],[10,0],[10,10],[0,10]],'source':{'input_sha256':'same','page':1}}]} for i in (1,2)]}
    def test_identical_rendered_pages_still_keep_distinct_page_numbers(self):
        r=bind_pdf_ocr(self.m,self.r)
        self.assertEqual(r['status'],'succeeded')
        self.assertEqual([p['regions'][0]['pdf_source']['page'] for p in r['pages']],[1,2])
        self.assertEqual(r['pages'][0]['regions'][0]['pdf_source']['polygon'][0],[0,100])
        self.assertEqual(self.r['samples'][0]['regions'][0]['region_id'],'ocr-0')
    def test_wrong_hash_rejected(self):
        self.r['samples'][0]['input_sha256']='other'
        with self.assertRaises(ValueError):bind_pdf_ocr(self.m,self.r)
    def test_missing_or_failed_pages_not_hidden(self):
        self.r['samples'].pop();r=bind_pdf_ocr(self.m,self.r)
        self.assertEqual(r['status'],'partial');self.assertEqual(r['processed_pages'],1);self.assertEqual(r['pages'][1]['ocr_status'],'not_run')
    def test_unexpected_coordinate_change_rejected(self):
        self.r['samples'][0]['oriented_size']=[200,100]
        with self.assertRaises(ValueError):bind_pdf_ocr(self.m,self.r)
    def test_region_hash_and_duplicates_rejected(self):
        self.r['samples'][0]['regions'][0]['source']['input_sha256']='bad'
        with self.assertRaises(ValueError):bind_pdf_ocr(self.m,self.r)
        self.setUp();self.r['samples'].append(copy.deepcopy(self.r['samples'][0]))
        with self.assertRaises(ValueError):bind_pdf_ocr(self.m,self.r)
if __name__=='__main__':unittest.main()
