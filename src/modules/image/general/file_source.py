"""Read provenance declarations from original image metadata, without network access.

Unsigned metadata is evidence of a declaration, never verified provider identity.
Do not search pixel data or arbitrary prompt text for provider names.
"""
import json
import xml.etree.ElementTree as ET

FIELDS = ('Label', 'ContentProducer', 'ProduceID', 'ReservedCode1',
          'ContentPropagator', 'PropagateID', 'ReservedCode2')
LIMIT = 1024 * 1024
TC260 = 'http://www.tc260.org.cn/ns/AIGC/1.0/'


def metadata_sources(im):
    for key, value in im.info.items():
        if key.lower() in {'aigc', 'xmp', 'xml:com.adobe.xmp', 'comment', 'description'}:
            yield key, value
    # Some JPEG generators use COM or APP1 XMP instead of PNG text fields.
    for key, value in getattr(im, 'applist', []):
        if key == 'COM':
            yield 'JPEG COM', value
        elif key == 'APP1' and value.startswith(b'http://ns.adobe.com/xap/1.0/\x00'):
            yield 'JPEG XMP', value.split(b'\x00', 1)[1]
    exif = im.getexif()
    if 270 in exif:
        yield 'EXIF ImageDescription', exif[270]
    try:
        comment = exif.get_ifd(34665).get(37510)
        if comment is not None:
            if isinstance(comment, bytes) and comment.startswith(b'ASCII\x00\x00\x00'):
                comment = comment[8:]
            elif isinstance(comment, bytes) and comment.startswith(b'UNICODE\x00'):
                raw = comment[8:]
                comment = raw.decode('utf-16' if raw.startswith((b'\xff\xfe', b'\xfe\xff')) else 'utf-16-be', errors='replace')
            yield 'EXIF UserComment', comment
    except (KeyError, ValueError, TypeError):
        pass


def read_declarations(im):
    records, seen, issues = [], set(), []

    def add(value, location):
        if isinstance(value, str):
            try:
                value = json.loads(value)
            except (ValueError, RecursionError):
                issues.append('invalid_aigc_json')
                return
        if not isinstance(value, dict):
            return
        if 'AIGC' in value:
            value = value['AIGC']
            if isinstance(value, str):
                try:
                    value = json.loads(value)
                except (ValueError, RecursionError):
                    issues.append('invalid_aigc_json')
                    return
        if not isinstance(value, dict) or not any(k in value for k in FIELDS):
            return
        fields = {k: str(value[k])[:512] for k in FIELDS
                  if k in value and isinstance(value[k], (str, int)) and not isinstance(value[k], bool)}
        if not fields:
            return
        signature = json.dumps(fields, sort_keys=True)
        if signature in seen:
            return
        seen.add(signature)
        records.append({'location': location, 'fields': fields,
                        'verification': 'unsigned_declaration',
                        'labelMeaning': {'1': 'declared_ai', '2': 'possibly_ai', '3': 'suspected_ai'}.get(fields.get('Label'), 'unknown')})

    for location, value in metadata_sources(im):
        if not isinstance(value, (str, bytes)):
            continue
        if len(value) > LIMIT:
            issues.append('metadata_size_limit')
            continue
        if isinstance(value, bytes):
            value = value.decode('utf-8', errors='replace')
        value = value.strip('\x00 \r\n\t\ufeff')
        if location.lower() == 'aigc':
            add(value, location)
        elif value.startswith('{'):
            try:
                obj = json.loads(value)
                # A JSON prompt containing a provider name is not a provenance declaration.
                if isinstance(obj, dict) and 'AIGC' in obj:
                    add(obj, location)
            except (ValueError, RecursionError):
                pass
        if '<' in value and ('xmp' in location.lower() or TC260 in value):
            if '<!DOCTYPE' in value.upper() or '<!ENTITY' in value.upper():
                issues.append('unsafe_xmp')
                continue
            try:
                xml = ET.fromstring(value)
                for element in xml.iter():
                    if element.tag == '{' + TC260 + '}AIGC':
                        add(element.text or '', location)
                    for key, val in element.attrib.items():
                        if key == '{' + TC260 + '}AIGC':
                            add(val, location)
            except (ET.ParseError, RecursionError):
                issues.append('invalid_xmp')
    # Report disagreements instead of silently choosing the last metadata block.
    producers = {r['fields']['ContentProducer'] for r in records if r['fields'].get('ContentProducer')}
    return {'status': 'found' if records else 'not_found', 'records': records[:16],
            'conflictingProducers': len(producers) > 1, 'issues': sorted(set(issues)),
            'network': 'disabled', 'sourceVerdict': None,
            'scope': 'AIGC JSON and TC260 XMP in PNG/JPEG/WebP metadata',
            'watermarkStatus': 'not_checked',
            'summary': '文件包含来源声明，尚未验证声明者身份。' if records else
                       '未读取到支持的来源声明；不代表图片真实或不是 AI 生成。'}


# Deliberately exact product aliases: corporate names, opaque provider codes and
# generic "Alibaba"/"ByteDance" labels cannot identify a specific consumer app.
PROVIDERS = {
    'doubao': ('豆包', {'豆包', 'doubao', 'doubao.com', 'www.doubao.com'}),
    'qwen': ('千问 / Qwen', {'千问', '通义千问', 'qwen', 'qianwen.com', 'www.qianwen.com', 'chat.qwen.ai'}),
    'openai': ('OpenAI / ChatGPT', {'openai', 'chatgpt', 'chatgpt.com', 'openai.com'}),
}


def provider_checks(declarations, credentials):
    """Separate unsigned provider declarations from C2PA validation results.

    Even an OpenAI issuer does not alone prove ChatGPT use or AI generation.
    No proprietary watermark check, registry lookup or network request is made.
    """
    checks = []
    for provider, (name, aliases) in PROVIDERS.items():
        matches = []
        for record in declarations.get('records', []):
            fields = record.get('fields', {})
            for field, role in [('ContentProducer', 'producer'), ('ContentPropagator', 'propagator')]:
                value = fields.get(field, '')
                if value.strip().casefold() in aliases:
                    matches.append({'role': role, 'value': value, 'location': record.get('location'),
                                    'verification': 'unsigned_declaration'})
        c2pa = None
        issuer = credentials.get('signer') or ''
        if provider == 'openai' and issuer.strip().casefold() in {'openai', 'openai, inc.', 'openai inc.'}:
            c2pa = {'issuer': issuer, 'validationState': credentials.get('status'),
                    'scope': 'active_manifest', 'generationConfirmed': False}
        checks.append({'provider': provider, 'name': name,
                       'status': 'evidence_found' if matches or c2pa else
                                 ('unavailable' if declarations.get('status') == 'failed' else 'not_found'),
                       'declarations': matches, 'c2pa': c2pa,
                       'sourceConfirmed': False, 'loginRequired': False,
                       'watermarkStatus': 'not_checked'})
    return {'checks': checks, 'network': 'disabled',
            'unmappedProducers': sorted({r['fields']['ContentProducer'] for r in declarations.get('records', [])
                if r.get('fields', {}).get('ContentProducer') and not any(
                    r['fields']['ContentProducer'].strip().casefold() in a for _, a in PROVIDERS.values())}),
            'identityPolicy': 'Exact product aliases only; unsigned declarations are not authenticated identities',
            'openaiOnlineCheck': 'not_configured'}


def apply_source_evidence(result):
    """An explicit AI declaration supplements the model; never invent a score."""
    records = result.get('diagnostics', {}).get('sourceDeclarations', {}).get('records', [])
    declared = any(str(record.get('fields', {}).get('Label', '')) == '1' for record in records)
    model_verdict = result.get('modelVerdict', result.get('verdict'))
    result['modelVerdict'] = model_verdict
    result['decisionBasis'] = 'file_declaration' if declared else 'model'
    if declared:
        result['verdict'] = 'likely_ai'
        result['summary'] = 'AI 生成（文件标识）：文件内部已记录 AI 生成声明。'
    return result
