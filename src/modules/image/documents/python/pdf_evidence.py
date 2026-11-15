"""Bind rendered-page OCR back to immutable PDF pages; never trust text layer as OCR."""
import copy
import math
from pdf_adapter import transform_point


def bind_pdf_ocr(manifest, ocr):
    pages=manifest.get('pages',[])
    by_hash={}
    # Different pages may render identically, so bind by declared sample/page id as well as hash.
    expected={f"pdf-page-{p['page']}":p for p in pages if p['status']=='succeeded'}
    for sample in ocr.get('samples',[]):
        key=sample.get('sample_id')
        if key not in expected or key in by_hash:raise ValueError('Unexpected or duplicate PDF OCR page')
        page=expected[key]
        if sample.get('input_sha256')!=page['rendered_sha256']:raise ValueError('Rendered source hash mismatch')
        by_hash[key]=sample
    result={'schema':'pdf-ocr-evidence/0.1','file_sha256':manifest['file_sha256'],
            'preparation_status':manifest['status'],'page_count':manifest['page_count'],
            'text_image_consistency':'not_checked','digital_signature_verified':False,'pages':[]}
    for page in pages:
        item={'page':page['page'],'preparation_status':page['status'],'ocr_status':'not_run','regions':[]}
        sample=by_hash.get(f"pdf-page-{page['page']}")
        if sample:
            item['ocr_status']=sample['status']
            if sample['status']=='succeeded':
                if sample['oriented_size']!=page['rendered_size'] or sample.get('exif_orientation',1)!=1:raise ValueError('Unexpected rendered coordinate transformation')
                w,h=page['rendered_size'];ids=set()
                for region in sample['regions']:
                    poly=region['polygon'];conf=region['recognition_confidence']
                    if region['region_id'] in ids:raise ValueError('Duplicate OCR region')
                    ids.add(region['region_id'])
                    if len(poly)!=4 or any(len(p)!=2 or any(not isinstance(v,(int,float)) or not math.isfinite(v) or v<0 or v>(w if i==0 else h) for i,v in enumerate(p)) for p in poly):raise ValueError('Invalid rendered polygon')
                    if not math.isfinite(conf) or not 0<=conf<=1:raise ValueError('Invalid recognition confidence')
                    if region['source']['input_sha256']!=page['rendered_sha256']:raise ValueError('Region source mismatch')
                    bound=copy.deepcopy(region)
                    bound['region_id']=f"page-{page['page']}:{region['region_id']}"
                    bound['pdf_source']={'file_sha256':manifest['file_sha256'],'page':page['page'],
                        'rendered_sha256':page['rendered_sha256'],'pixel_to_pdf':page['pixel_to_pdf'],
                        'polygon':[transform_point(page['pixel_to_pdf'],p) for p in poly],
                        'coordinate_space':'pdfium_page_canvas'}
                    item['regions'].append(bound)
        result['pages'].append(item)
    result['processed_pages']=sum(p['ocr_status']=='succeeded' for p in result['pages'])
    result['status']='succeeded' if manifest['status']=='succeeded' and result['processed_pages']==manifest['page_count'] else 'partial'
    if not result['processed_pages']:result['status']='failed'
    return result
