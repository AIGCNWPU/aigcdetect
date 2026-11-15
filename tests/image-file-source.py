"""Metadata extraction tests using real PNG/JPEG/WebP encoders, no provider claims."""
import io
import json
from pathlib import Path
import sys
import unittest
from PIL import Image, PngImagePlugin

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src/modules/image/general'))
from file_source import read_declarations, TC260, provider_checks


class FileSourceTests(unittest.TestCase):
    def encoded(self, fmt, **kwargs):
        stream = io.BytesIO()
        Image.new('RGB', (32, 24), 'blue').save(stream, format=fmt, **kwargs)
        stream.seek(0)
        return Image.open(stream)

    def test_png_declaration_and_propagator_are_distinct(self):
        meta = PngImagePlugin.PngInfo()
        meta.add_text('AIGC', json.dumps({'Label': '1', 'ContentProducer': 'test-generator', 'ContentPropagator': 'test-share-service'}))
        result = read_declarations(self.encoded('PNG', pnginfo=meta))
        self.assertEqual(result['records'][0]['fields']['ContentProducer'], 'test-generator')
        self.assertEqual(result['records'][0]['verification'], 'unsigned_declaration')
        self.assertIsNone(result['sourceVerdict'])

    def test_xmp_in_jpeg_and_webp(self):
        xmp = ('<x:xmpmeta xmlns:x="adobe:ns:meta/" xmlns:t="' + TC260 + '"><t:AIGC>' +
               json.dumps({'Label': '2', 'ContentProducer': 'fixture'}) + '</t:AIGC></x:xmpmeta>').encode()
        for fmt in ('JPEG', 'WEBP'):
            with self.subTest(fmt=fmt):
                r = read_declarations(self.encoded(fmt, xmp=xmp))
                self.assertEqual(len(r['records']), 1)
                self.assertEqual(r['records'][0]['labelMeaning'], 'possibly_ai')

    def test_exif_wrapped_json(self):
        exif = Image.Exif()
        exif[270] = json.dumps({'AIGC': {'Label': '3', 'ContentProducer': 'fixture'}})
        r = read_declarations(self.encoded('JPEG', exif=exif))
        self.assertEqual(r['records'][0]['labelMeaning'], 'suspected_ai')

    def test_prompt_and_filename_are_not_source_evidence(self):
        meta = PngImagePlugin.PngInfo()
        meta.add_text('prompt', 'made by Doubao OpenAI Qwen Gemini')
        meta.add_text('Description', '{"ContentProducer":"OpenAI"}')
        r = read_declarations(self.encoded('PNG', pnginfo=meta))
        self.assertEqual(r['status'], 'not_found')
        self.assertEqual(r['watermarkStatus'], 'not_checked')

    def test_conflict_and_malformed_data(self):
        meta = PngImagePlugin.PngInfo()
        meta.add_text('AIGC', '{"ContentProducer":"a"}')
        meta.add_text('Description', '{"AIGC":{"ContentProducer":"b"}}')
        r = read_declarations(self.encoded('PNG', pnginfo=meta))
        self.assertTrue(r['conflictingProducers'])
        meta = PngImagePlugin.PngInfo()
        meta.add_text('AIGC', '{invalid')
        r = read_declarations(self.encoded('PNG', pnginfo=meta))
        self.assertIn('invalid_aigc_json', r['issues'])

    def test_entity_expansion_rejected(self):
        meta = PngImagePlugin.PngInfo()
        meta.add_text('XML:com.adobe.xmp', '<!DOCTYPE a [<!ENTITY b "test">]><a>&b;</a>')
        r = read_declarations(self.encoded('PNG', pnginfo=meta))
        self.assertIn('unsafe_xmp', r['issues'])

    def test_unicode_exif_comment(self):
        exif = Image.Exif()
        payload = json.dumps({'AIGC': {'Label': '1', 'ContentProducer': '豆包'}}, ensure_ascii=False)
        exif[34665] = {37510: b'UNICODE\x00' + payload.encode('utf-16-be')}
        result = read_declarations(self.encoded('JPEG', exif=exif))
        self.assertEqual(result['records'][0]['fields']['ContentProducer'], '豆包')

    def test_provider_roles_and_unknown_codes(self):
        for producer, expected in [('豆包', 'doubao'), ('Qwen', 'qwen'), ('ChatGPT', 'openai')]:
            meta = PngImagePlugin.PngInfo()
            meta.add_text('AIGC', json.dumps({'Label': '1', 'ContentProducer': producer, 'ContentPropagator': '千问'}))
            result = provider_checks(read_declarations(self.encoded('PNG', pnginfo=meta)), {'status': 'absent'})
            check = next(x for x in result['checks'] if x['provider'] == expected)
            self.assertEqual(check['declarations'][0]['role'], 'producer')
            self.assertFalse(check['sourceConfirmed'])
        result = provider_checks({'records': [{'fields': {'ContentProducer': '123456789', 'ContentPropagator': '豆包'}}]}, {})
        self.assertEqual(result['unmappedProducers'], ['123456789'])
        self.assertEqual(result['checks'][0]['declarations'][0]['role'], 'propagator')
        self.assertFalse(result['checks'][0]['sourceConfirmed'])

    def test_openai_invalid_credential_is_not_confirmed(self):
        for state in ['invalid', 'valid', 'trusted']:
            result = provider_checks({'records': []}, {'signer': 'OpenAI', 'status': state})
            check = result['checks'][2]
            self.assertEqual(check['c2pa']['validationState'], state)
            self.assertFalse(check['sourceConfirmed'])
            self.assertFalse(check['c2pa']['generationConfirmed'])
        result = provider_checks({'records': []}, {'signer': 'Fake OpenAI', 'status': 'trusted'})
        self.assertEqual(result['checks'][2]['status'], 'not_found')

    def test_metadata_removal_is_absence_not_authenticity(self):
        meta = PngImagePlugin.PngInfo()
        meta.add_text('AIGC', '{"Label":"1","ContentProducer":"fixture"}')
        im = self.encoded('PNG', pnginfo=meta)
        out = io.BytesIO()
        Image.frombytes('RGB', im.size, im.tobytes()).save(out, format='PNG')
        out.seek(0)
        r = read_declarations(Image.open(out))
        self.assertEqual(r['status'], 'not_found')
        self.assertIsNone(r['sourceVerdict'])


if __name__ == '__main__':
    unittest.main()
