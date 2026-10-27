"""Controlled parsing/security fixtures; not authenticity accuracy data."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'src/modules/image/documents/python'))
from material_parser import MaterialLimits, parse_material
from test_pdf_adapter import make_pdf

BODY = '<w:p><w:r><w:t>科研采购</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>金额</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>106.00</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'


def make_docx(path, body=BODY, extra=None):
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')
        archive.writestr('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + body + '</w:body></w:document>')
        for key, value in (extra or {}).items():
            archive.writestr(key, value)


class MaterialParserTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
    def tearDown(self):
        self.temp.cleanup()
    def parse(self, path, **kwargs):
        return parse_material(path, self.root / 'output', **kwargs)
    def test_docx_real_blocks_no_invented_pages(self):
        path = self.root / 'input.docx'; make_docx(path)
        report = self.parse(path)
        self.assertEqual(report['status'], 'partial')
        self.assertEqual(report['visual_status'], 'not_run')
        self.assertEqual(report['pages'], [])
        self.assertEqual(report['blocks'][0]['text'], '科研采购')
        self.assertEqual(report['blocks'][2]['source_location']['cell'], 2)
        self.assertEqual(report['blocks'][2]['text'], '106.00')
        self.assertTrue(report['file_version'].startswith('sha256:'))
    def test_external_relationship_never_fetched_or_rendered(self):
        path = self.root / 'input.docx'
        make_docx(path, extra={'word/_rels/document.xml.rels': '<Relationships><Relationship TargetMode="External" Target="https://127.0.0.1:1/private"/></Relationships>'})
        report = self.parse(path, render_docx=True)
        self.assertEqual(report['external_relationships_ignored'], 1)
        self.assertFalse(report['external_relationships_fetched'])
        self.assertIn('docx_render_unsafe_features', report['warnings'])
    def test_zip_traversal_rejected_without_extract(self):
        path = self.root / 'input.docx'; make_docx(path, extra={'../outside': 'bad'})
        report = self.parse(path)
        self.assertEqual(report['error'], 'zip_unsafe_entry')
        self.assertFalse((self.root / 'outside').exists())
    def test_macro_package_rejected(self):
        path = self.root / 'input.docx'; make_docx(path, extra={'word/vbaProject.bin': 'bad'})
        self.assertEqual(self.parse(path)['error'], 'active_content_forbidden')
    def test_xml_entity_rejected(self):
        path = self.root / 'input.docx'
        make_docx(path, extra={'custom.xml': '<!DOCTYPE x [<!ENTITY b SYSTEM "file:///etc/passwd">]><x>&b;</x>'})
        self.assertEqual(self.parse(path)['error'], 'xml_dtd_or_entity_forbidden')
    def test_zip_expansion_limit(self):
        path = self.root / 'input.docx'; make_docx(path, extra={'payload': 'a' * 10000})
        self.assertEqual(self.parse(path, limits=MaterialLimits(max_uncompressed_bytes=1000))['error'], 'zip_uncompressed_limit')
    def test_text_limit_reported(self):
        path = self.root / 'input.docx'; make_docx(path)
        report = self.parse(path, limits=MaterialLimits(max_text_chars=2))
        self.assertEqual(report['coverage']['text'], 'partial')
        self.assertEqual(report['blocks'][0]['text'], '科研')
        self.assertIn('text_or_block_limit', report['warnings'])
    def test_image_exif_orientation_normalized(self):
        from PIL import Image
        path = self.root / 'input.jpg'
        img = Image.new('RGB', (80, 40)); exif = img.getexif(); exif[274] = 6
        img.save(path, exif=exif)
        report = self.parse(path)
        self.assertEqual(report['status'], 'completed')
        self.assertEqual(report['pages'][0]['rendered_size'], [40, 80])
        self.assertEqual(report['pages'][0]['exif_orientation'], 6)
    def test_multiframe_page_limit(self):
        from PIL import Image
        path = self.root / 'input.tiff'
        Image.new('RGB', (10, 10)).save(path, save_all=True, append_images=[Image.new('RGB', (10, 10))])
        self.assertEqual(self.parse(path, limits=MaterialLimits(max_pages=1))['error'], 'page_count_limit')
    def test_pdf_maps_source_pages(self):
        path = self.root / 'input.pdf'; make_pdf(path)
        report = self.parse(path)
        self.assertEqual(report['status'], 'completed')
        self.assertEqual(report['pages'][1]['source_location'], {'page': 2})
        self.assertTrue((self.root / 'output' / report['pages'][0]['rendered_file']).exists())
    def test_bad_or_legacy_inputs_fail_honestly(self):
        path = self.root / 'input.doc'; path.write_bytes(b'legacy')
        report = self.parse(path)
        self.assertEqual(report['status'], 'failed')
        self.assertEqual(report['error'], 'legacy_doc_requires_controlled_conversion')
    def test_field_instruction_blocks_native_render(self):
        path = self.root / 'input.docx'
        make_docx(path, body=BODY + '<w:p><w:fldSimple w:instr="INCLUDETEXT remote"/></w:p>')
        report = self.parse(path, render_docx=True)
        self.assertIn('docx_render_unsafe_features', report['warnings'])
        self.assertEqual(report['visual_status'], 'not_run')
    def test_transparent_image_white_background(self):
        from PIL import Image
        path = self.root / 'input.png'
        Image.new('RGBA', (5, 5), (255, 0, 0, 0)).save(path)
        report = self.parse(path)
        with Image.open(self.root / 'output' / report['pages'][0]['rendered_file']) as image:
            self.assertEqual(image.getpixel((0, 0)), (255, 255, 255))
    def test_multiframe_total_pixel_budget_is_partial(self):
        from PIL import Image
        path = self.root / 'input.tiff'
        Image.new('RGB', (10, 10)).save(path, save_all=True, append_images=[Image.new('RGB', (10, 10))])
        report = self.parse(path, limits=MaterialLimits(max_total_pixels=100))
        self.assertEqual(report['status'], 'partial')
        self.assertEqual(report['coverage']['pages_completed'], 1)
        self.assertEqual(report['pages'][1]['status'], 'resource_limit')
    def test_fresh_directory_required(self):
        path = self.root / 'input.docx'; make_docx(path)
        self.parse(path)
        with self.assertRaises(FileExistsError): self.parse(path)
    def test_timeout_no_success(self):
        path = self.root / 'input.docx'; make_docx(path)
        self.assertEqual(self.parse(path, limits=MaterialLimits(timeout_seconds=.00001))['error'], 'timeout')
    def test_file_size_limit_and_invalid_limits(self):
        path = self.root / 'input.docx'; make_docx(path)
        self.assertEqual(self.parse(path, limits=MaterialLimits(max_bytes=1))['error'], 'file_bytes_limit')
        with self.assertRaises(ValueError): parse_material(path, self.root/'invalid', MaterialLimits(max_pages=True))

if __name__ == '__main__': unittest.main()
