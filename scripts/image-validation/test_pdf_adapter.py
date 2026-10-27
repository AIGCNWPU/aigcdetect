"""Controlled PDF correctness tests, not invoice authenticity accuracy tests."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'src/modules/image/documents/python'))
from pdf_adapter import PdfLimits, prepare_pdf, transform_point


def make_pdf(path, *, pages=2, rotation=0, crop=False, password=None, hidden=False, sizes=None):
    from pypdf import PdfWriter
    from pypdf.generic import NameObject, DictionaryObject, DecodedStreamObject
    writer=PdfWriter()
    for i in range(pages):
        width,height=sizes[i] if sizes else (300,400)
        page=writer.add_blank_page(width,height)
        font=DictionaryObject({NameObject('/Type'):NameObject('/Font'),NameObject('/Subtype'):NameObject('/Type1'),NameObject('/BaseFont'):NameObject('/Helvetica')})
        page[NameObject('/Resources')]=DictionaryObject({NameObject('/Font'):DictionaryObject({NameObject('/F1'):writer._add_object(font)})})
        stream=DecodedStreamObject()
        stream.set_data(f'BT /F1 12 Tf 40 60 Td (INVOICE {i+1} TOTAL 106.00) Tj ET\n'.encode()+
                        (b'BT /F1 12 Tf 40 100 Td 3 Tr (HIDDEN 999.00) Tj ET\n' if hidden else b''))
        page[NameObject('/Contents')]=writer._add_object(stream)
        if crop:
            page.cropbox.lower_left=(20,30);page.cropbox.upper_right=(width-20,height-30)
        if rotation:page.rotate(rotation)
    if password:writer.encrypt(password,algorithm='RC4-128')
    writer.write(path)


@unittest.skipUnless(importlib.util.find_spec('pypdf') and importlib.util.find_spec('pypdfium2'), 'Requires isolated OCR/PDF environment')
class PdfAdapterTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
    def tearDown(self):self.tmp.cleanup()
    def run_pdf(self,**kwargs):
        path=self.root/'input.pdf';make_pdf(path,**kwargs)
        return prepare_pdf(path,self.root/'prepared')
    def test_multpage_text_and_source_hash(self):
        r=self.run_pdf(pages=3)
        self.assertEqual(r['status'],'succeeded');self.assertEqual(r['page_count'],3)
        self.assertEqual([p['page'] for p in r['pages']],[1,2,3])
        self.assertIn('INVOICE 2',r['pages'][1]['text_layer']['text'])
        self.assertTrue(all(p['requires_ocr'] for p in r['pages']))
        self.assertFalse(r['digital_signature_verified'])
    def test_rotation_crop_mapping(self):
        for rotation in (0,90,180,270):
            with self.subTest(rotation=rotation):
                path=self.root/f'rot-{rotation}.pdf';make_pdf(path,pages=1,rotation=rotation,crop=True)
                r=prepare_pdf(path,self.root/f'out-{rotation}')
                self.assertEqual(r['status'],'succeeded')
                page=r['pages'][0]
                for character in page['text_layer']['characters']:
                    for pixel,pdf in zip(character['rendered_polygon'],character['pdf_polygon']):
                        mapped=transform_point(page['pixel_to_pdf'],pixel)
                        self.assertLessEqual(max(abs(a-b) for a,b in zip(mapped,pdf)),.51)
    def test_encrypted_without_and_with_password(self):
        path=self.root/'secret.pdf';make_pdf(path,password='fixture-secret')
        denied=prepare_pdf(path,self.root/'denied')
        self.assertEqual(denied['status'],'password_required')
        allowed=prepare_pdf(path,self.root/'allowed',password='fixture-secret')
        self.assertEqual(allowed['status'],'succeeded')
        self.assertNotIn('fixture-secret',json.dumps(allowed))
    def test_corrupt_pdf_fails_without_success_report(self):
        path=self.root/'bad.pdf';path.write_bytes(b'%PDF-1.7\nnot a document')
        r=prepare_pdf(path,self.root/'bad')
        self.assertEqual(r['status'],'failed')
    def test_page_limit_rejects_whole_document(self):
        path=self.root/'many.pdf';make_pdf(path,pages=3)
        r=prepare_pdf(path,self.root/'many',PdfLimits(max_pages=2))
        self.assertEqual(r['status'],'resource_limit');self.assertEqual(r['unprocessed_page_count'],3)
        self.assertEqual(r['pages'],[])
    def test_oversized_page_does_not_hide_other_page(self):
        path=self.root/'large.pdf';make_pdf(path,sizes=[(1000,1000),(100,150)])
        r=prepare_pdf(path,self.root/'large',PdfLimits(max_page_pixels=100000))
        self.assertEqual(r['status'],'partial')
        self.assertEqual([p['status'] for p in r['pages']],['resource_limit','succeeded'])
        self.assertEqual(r['unprocessed_page_count'],1)
    def test_hidden_text_not_asserted_as_visible_truth(self):
        r=self.run_pdf(hidden=True,pages=1)
        self.assertIn('HIDDEN',r['pages'][0]['text_layer']['text'])
        self.assertEqual(r['pages'][0]['text_layer']['trust'],'unverified_text_layer_not_visual_truth')
        self.assertEqual(r['pages'][0]['text_image_consistency'],'not_checked')
    def test_text_limit_is_explicit(self):
        path=self.root/'long.pdf';make_pdf(path,pages=1)
        r=prepare_pdf(path,self.root/'long',PdfLimits(max_text_chars=5))
        self.assertEqual(r['pages'][0]['text_layer']['coverage'],'partial')
    def test_worker_timeout_is_explicit(self):
        path=self.root/'timeout.pdf';make_pdf(path,pages=1)
        r=prepare_pdf(path,self.root/'timeout',PdfLimits(timeout_seconds=.0001))
        self.assertEqual(r['error'],'timeout');self.assertEqual(r['status'],'failed')
    def test_refuse_overwrite_and_invalid_limits(self):
        r=self.run_pdf(pages=1)
        with self.assertRaises(FileExistsError):prepare_pdf(self.root/'input.pdf',self.root/'prepared')
        with self.assertRaises(ValueError):prepare_pdf(self.root/'input.pdf',self.root/'other',PdfLimits(dpi=0))


if __name__=='__main__':unittest.main()
