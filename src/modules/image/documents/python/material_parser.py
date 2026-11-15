"""Bounded local image/PDF/DOCX preparation. No model verdicts or external calls."""
from dataclasses import asdict, dataclass
import json
import math
import multiprocessing
import os
from pathlib import Path, PurePosixPath
import shutil
import signal
import subprocess
import warnings
import zipfile
from xml.etree import ElementTree as ET

from pdf_adapter import PdfLimits, checksum, prepare_pdf, write_report

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'


@dataclass(frozen=True)
class MaterialLimits:
    max_bytes: int = 50 * 1024 * 1024
    max_pages: int = 50
    max_page_pixels: int = 20_000_000
    max_total_pixels: int = 100_000_000
    max_zip_entries: int = 2000
    max_uncompressed_bytes: int = 100 * 1024 * 1024
    max_xml_bytes: int = 10 * 1024 * 1024
    max_text_chars: int = 200_000
    max_blocks: int = 20_000
    dpi: int = 144
    timeout_seconds: float = 120
    memory_bytes: int = 2 * 1024 ** 3


class ParseRejected(Exception):
    pass


def _xml(data):
    # Reject declarations even in UTF-16; no DTD/entity resolver is ever enabled.
    probe = data.replace(b'\x00', b'').upper()
    if b'<!DOCTYPE' in probe or b'<!ENTITY' in probe:
        raise ParseRejected('xml_dtd_or_entity_forbidden')
    return ET.fromstring(data)


def _pdf(path, output, limits, report):
    settings = {k: v for k, v in asdict(limits).items() if k in PdfLimits.__dataclass_fields__}
    result = prepare_pdf(path, output / 'pages', PdfLimits(**settings))
    report['pdf_manifest'] = 'pages/manifest.json'
    report['page_count'] = result.get('page_count')
    for page in result['pages']:
        item = dict(page)
        item['status'] = 'completed' if page['status'] == 'succeeded' else page['status']
        item['source_location'] = {'page': page['page']}
        if item.get('rendered_file'):
            item['rendered_file'] = 'pages/' + item['rendered_file']
        report['pages'].append(item)
    report['status'] = {'succeeded': 'completed', 'partial': 'partial'}.get(result['status'], 'failed')
    report['error'] = result.get('error')
    report['coverage'] = {'pages_total': result.get('page_count'), 'pages_completed': result.get('processed_pages', 0),
                          'text': 'unverified_pdf_text_layer', 'visual': 'ready' if result.get('processed_pages', 0) else 'not_run'}
    if any(p.get('text_layer', {}).get('coverage') == 'partial' for p in result['pages']):
        report['status'] = 'partial'
        report['warnings'].append('pdf_text_truncated')


def _image(path, output, limits, report):
    from PIL import Image, ImageOps
    Image.MAX_IMAGE_PIXELS = limits.max_page_pixels
    warnings.simplefilter('error', Image.DecompressionBombWarning)
    with Image.open(path) as source:
        count = getattr(source, 'n_frames', 1)
        report['page_count'] = count
        if count > limits.max_pages:
            raise ParseRejected('page_count_limit')
        total = 0
        for i in range(count):
            source.seek(i)
            width, height = source.size
            if width * height > limits.max_page_pixels or total + width * height > limits.max_total_pixels:
                report['pages'].append({'page': i + 1, 'status': 'resource_limit', 'error': 'render_pixel_budget'})
                continue
            total += width * height
            orientation = source.getexif().get(274, 1)
            normalized = ImageOps.exif_transpose(source).convert('RGBA')
            background = Image.new('RGBA', normalized.size, (255, 255, 255, 255))
            rendered = Image.alpha_composite(background, normalized).convert('RGB')
            dest = output / f'page-{i+1:04d}.png'
            rendered.save(dest)
            report['pages'].append({'page': i + 1, 'status': 'completed', 'rendered_file': dest.name,
                'rendered_sha256': checksum(dest), 'rendered_size': list(rendered.size), 'original_size': [width, height],
                'exif_orientation': orientation, 'orientation_applied': True, 'alpha_background': 'white', 'coordinate_space': 'exif_normalized_pixels',
                'source_location': {'frame': i + 1}, 'requires_ocr': True})
    completed = sum(p['status'] == 'completed' for p in report['pages'])
    report['status'] = 'completed' if completed == count else ('partial' if completed else 'failed')
    report['coverage'] = {'pages_total': count, 'pages_completed': completed, 'text': 'requires_ocr',
                          'visual': 'ready' if completed else 'not_run'}


def _docx(path, output, limits, report, render_docx):
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        if len(entries) > limits.max_zip_entries:
            raise ParseRejected('zip_entry_limit')
        names = [e.filename for e in entries]
        if len(set(names)) != len(names):
            raise ParseRejected('zip_duplicate_entry')
        if sum(e.file_size for e in entries) > limits.max_uncompressed_bytes:
            raise ParseRejected('zip_uncompressed_limit')
        for entry in entries:
            name = PurePosixPath(entry.filename)
            if name.is_absolute() or '..' in name.parts or '\\' in entry.filename or entry.flag_bits & 1:
                raise ParseRejected('zip_unsafe_entry')
            if (entry.external_attr >> 16) & 0o170000 == 0o120000:
                raise ParseRejected('zip_symlink_forbidden')
            if any(x in entry.filename.lower() for x in ('vbaproject', 'embeddings/', 'activex/')):
                raise ParseRejected('active_content_forbidden')
        if 'word/document.xml' not in names or '[Content_Types].xml' not in names:
            raise ParseRejected('not_docx_package')
        xml_parts = {}
        for entry in entries:
            if entry.filename.endswith(('.xml', '.rels')):
                if entry.file_size > limits.max_xml_bytes:
                    raise ParseRejected('xml_size_limit')
                xml_parts[entry.filename] = _xml(archive.read(entry))
        external_count = sum(1 for name, tree in xml_parts.items() if name.endswith('.rels')
                             for node in tree if node.get('TargetMode', '').lower() == 'external'
                             or ':' in node.get('Target', '') or node.get('Target', '').startswith(('/', '\\'))
                             or '%' in node.get('Target', '') or '..' in PurePosixPath(node.get('Target', '')).parts)
        report['external_relationships_ignored'] = external_count
        root = xml_parts['word/document.xml']
        if root.tag != W + 'document':
            raise ParseRejected('invalid_docx_document_root')
        body = root.find(W + 'body')
        if body is None:
            raise ParseRejected('docx_body_missing')
        unsafe_render = external_count > 0
        forbidden = {'instrText', 'fldSimple', 'fldChar', 'altChunk', 'object', 'control'}
        unsafe_render |= any(node.tag.split('}')[-1] in forbidden for tree in xml_parts.values() for node in tree.iter())
        if any('macroenabled' in str(node.attrib).lower() for node in xml_parts['[Content_Types].xml'].iter()):
            raise ParseRejected('active_content_forbidden')
        chars = 0
        truncated = False
        def block(node, kind, location):
            nonlocal chars, truncated
            if len(report['blocks']) >= limits.max_blocks or chars >= limits.max_text_chars:
                truncated = True
                return
            def paragraph_text(part):
                return ''.join((n.text or '') if n.tag == W + 't' else '\t' if n.tag == W + 'tab' else '\n'
                               for n in part.iter() if n.tag in (W + 't', W + 'tab', W + 'br'))
            text = '\n'.join(paragraph_text(p) for p in node.iter(W + 'p')) if kind == 'table_cell' else paragraph_text(node)
            remaining = limits.max_text_chars - chars
            if len(text) > remaining:
                text = text[:remaining]
                truncated = True
            chars += len(text)
            report['blocks'].append({'id': f'block-{len(report["blocks"])+1}', 'kind': kind, 'text': text,
                'source': 'docx_xml', 'source_location': location, 'trust': 'unverified_structured_text'})
        para = table = 0
        for node in body:
            if node.tag == W + 'p':
                para += 1
                block(node, 'paragraph', {'part': 'word/document.xml', 'paragraph': para})
            elif node.tag == W + 'tbl':
                table += 1
                for row_index, row in enumerate(node.findall(W + 'tr'), 1):
                    for cell_index, cell in enumerate(row.findall(W + 'tc'), 1):
                        block(cell, 'table_cell', {'part': 'word/document.xml', 'table': table,
                            'row': row_index, 'cell': cell_index,
                            'grid_span': cell.find(W+'tcPr/'+W+'gridSpan').get(W+'val', '1') if cell.find(W+'tcPr/'+W+'gridSpan') is not None else '1'})
            elif node.tag != W + 'sectPr':
                report['warnings'].append('unsupported_body_structure:' + node.tag.split('}')[-1])
        extra_parts = [name for name in names if name.startswith(('word/header', 'word/footer', 'word/footnotes', 'word/endnotes', 'word/comments')) and name.endswith('.xml')]
        if extra_parts:
            report['warnings'].append('body_text_only_other_parts_not_extracted')
        report['text_omitted_parts'] = extra_parts
        report['coverage'] = {'pages_total': None, 'pages_completed': 0, 'text': 'partial' if truncated or extra_parts else 'body_complete',
                              'visual': 'not_run', 'pagination': 'unavailable'}
        report['status'] = 'partial'
        if truncated:
            report['warnings'].append('text_or_block_limit')
        report['warnings'].append('docx_xml_text_is_not_visual_truth')
    converter = shutil.which('libreoffice') or shutil.which('soffice')
    if not render_docx or not converter or unsafe_render:
        report['warnings'].append('docx_render_disabled' if not render_docx else 'docx_render_unsafe_features' if unsafe_render else 'docx_renderer_unavailable')
        return
    profile = output / 'libreoffice-profile'
    profile.mkdir()
    (profile / 'user').mkdir()
    # Isolated fresh profile: never use the account's profile/configuration or links.
    (profile / 'user/registrymodifications.xcu').write_text('''<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item><item oor:path="/org.openoffice.Office.Writer/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>2</value></prop></item></oor:items>''', encoding='utf-8')
    converted = output / 'converted'
    converted.mkdir()
    process = subprocess.run([converter, '-env:UserInstallation=' + profile.as_uri(), '--headless', '--nologo', '--nodefault',
        '--norestore', '--convert-to', 'pdf:writer_pdf_Export', '--outdir', str(converted), str(path)],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=limits.timeout_seconds, env={**os.environ, 'TMPDIR': str(output), 'MAX_CONCURRENCY': '1', 'OMP_NUM_THREADS': '1', 'SAL_DISABLE_OPENCL': 'true'})
    (output / 'converter.log').write_bytes(process.stdout[:32768] + process.stderr[:32768])
    generated = converted / (path.stem + '.pdf')
    if process.returncode or not generated.exists():
        report['conversion_exit_code'] = process.returncode
        report['warnings'].append('docx_conversion_failed')
        return
    report['renderer'] = 'libreoffice_local_isolated_profile'
    report['derived_pdf_sha256'] = checksum(generated)
    report['derived_pdf'] = 'converted/' + generated.name
    _pdf(generated, output, limits, report)
    for page in report['pages']:
        page['source_location'] = {'page': page['page'], 'derived_from': 'docx_local_render'}
    report['coverage']['text'] = 'partial' if truncated or extra_parts else 'body_complete'
    report['coverage']['block_to_page_mapping'] = 'not_available'
    report['warnings'].append('docx_fonts_and_layout_may_differ_from_original_editor')
    if truncated or extra_parts or any(w.startswith('unsupported_body_structure:') for w in report['warnings']):
        report['status'] = 'partial'


def _worker(path, output, limits, report, render_docx):
    import resource
    os.setsid()
    resource.setrlimit(resource.RLIMIT_AS, (limits.memory_bytes, limits.memory_bytes))
    resource.setrlimit(resource.RLIMIT_FSIZE, (limits.max_uncompressed_bytes, limits.max_uncompressed_bytes))
    try:
        if report['kind'] == 'pdf':
            _pdf(path, output, limits, report)
        elif report['kind'] == 'docx':
            _docx(path, output, limits, report, render_docx)
        elif report['kind'] == 'image':
            _image(path, output, limits, report)
        else:
            raise ParseRejected('legacy_doc_requires_controlled_conversion' if path.suffix.lower() == '.doc' else 'unsupported_format')
        if checksum(path) != report['file_sha256']:
            for page in report['pages']:
                page['status'] = 'failed'
                page['error'] = 'source_changed_during_parse'
            report['blocks'] = []
            raise ParseRejected('source_changed_during_parse')
    except Exception as error:
        report['status'] = 'partial' if report['blocks'] or any(p['status'] == 'completed' for p in report['pages']) else 'failed'
        report['error'] = str(error) if isinstance(error, ParseRejected) else type(error).__name__
    report['visual_status'] = 'ready' if any(p['status'] == 'completed' for p in report['pages']) else 'not_run'
    report['coverage']['pages_completed'] = sum(p['status'] == 'completed' for p in report['pages'])
    write_report(output / 'material.json', report)


def parse_material(path, output, limits=None, material_id=None, render_docx=False):
    limits = limits or MaterialLimits()
    for key, value in asdict(limits).items():
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0 or (key != 'timeout_seconds' and type(value) is not int):
            raise ValueError('Resource limits must be positive finite values; counts must be integers')
    path, output = Path(path).resolve(), Path(output).resolve()
    output.mkdir(parents=True, exist_ok=False)
    suffix = path.suffix.lower()
    kind = 'pdf' if suffix == '.pdf' else 'docx' if suffix == '.docx' else 'image' if suffix in ('.png', '.jpg', '.jpeg', '.tif', '.tiff', '.webp', '.bmp', '.gif') else 'unsupported'
    report = {'schema': 'material-parse/0.1', 'material_id': material_id, 'file_version': None, 'file_sha256': None,
        'source_file': path.name, 'kind': kind, 'status': 'failed', 'pages': [], 'page_count': None, 'blocks': [],
        'coverage': {}, 'visual_status': 'not_run', 'warnings': [], 'error': None, 'limits': asdict(limits),
        'macros_executed': False, 'external_relationships_fetched': False, 'model_inference_performed': False}
    try:
        if not path.is_file():
            raise ParseRejected('input_not_file')
        if path.stat().st_size > limits.max_bytes:
            raise ParseRejected('file_bytes_limit')
        report['file_sha256'] = checksum(path)
        report['file_version'] = 'sha256:' + report['file_sha256']
        report['material_id'] = material_id or 'material-' + report['file_sha256'][:16]
    except (OSError, ParseRejected) as error:
        report['error'] = str(error) if isinstance(error, ParseRejected) else type(error).__name__
        write_report(output / 'material.json', report)
        return report
    write_report(output / 'material.json', report)
    child = multiprocessing.get_context('spawn').Process(target=_worker, args=(path, output, limits, report, render_docx))
    child.start()
    child.join(limits.timeout_seconds)
    if child.is_alive():
        try:
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            child.kill()
        child.join()
        report['error'] = 'timeout'
    elif child.exitcode:
        report['error'] = 'worker_failed'
    else:
        return json.loads((output / 'material.json').read_text(encoding='utf-8'))
    write_report(output / 'material.json', report)
    return report
