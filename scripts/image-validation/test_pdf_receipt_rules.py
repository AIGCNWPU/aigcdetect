import unittest
from pdf_receipt_rules import fuse_pdf_pages
class PdfRuleTests(unittest.TestCase):
    def fixture(self):
        h='a'*64
        m={'status':'succeeded','file_sha256':'b'*64,'page_count':1,'pages':[{'page':1,'status':'succeeded','rendered_sha256':h,'rendered_size':[100,200],'pixel_to_pdf':[.5,0,0,-.5,0,100]}]}
        s={'sample_id':'pdf-page-1','status':'succeeded','input_sha256':h,'oriented_size':[100,200],'regions':[{'region_id':'ocr-0','observed_text':'Unrecognized material','recognition_confidence':.99,'polygon':[[0,0],[80,0],[80,20],[0,20]],'coordinate_space':'exif_oriented_image_pixels','source':{'input_sha256':h,'page':1,'provider':'controlled_fixture'}}]}
        return m,{'samples':[s]}
    def test_unsupported_pdf_is_not_passed_verification(self):
        r=fuse_pdf_pages(*self.fixture());self.assertEqual(r['execution'],'succeeded');self.assertIsNone(r['overall_authenticity'])
        self.assertEqual(r['coverage']['executed_checks'],0);self.assertEqual(r['coverage']['pages_without_applicable_checks'],[1])
    def test_failed_ocr_is_not_hidden(self):
        m,o=self.fixture();o['samples'][0]['status']='failed';r=fuse_pdf_pages(m,o)
        self.assertEqual(r['execution'],'partial');self.assertEqual(r['pages'][0]['rules_status'],'not_run')
if __name__=='__main__':unittest.main()
