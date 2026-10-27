"""Bounded PDF page preparation for the image evidence pipeline; no HTTP server."""
import argparse
from dataclasses import asdict, dataclass
import hashlib
import json
import math
import multiprocessing
from pathlib import Path


@dataclass(frozen=True)
class PdfLimits:
    max_bytes: int = 50 * 1024 * 1024
    max_pages: int = 50
    max_page_pixels: int = 20_000_000
    max_total_pixels: int = 100_000_000
    max_text_chars: int = 20_000
    dpi: int = 144
    timeout_seconds: float = 120
    memory_bytes: int = 2 * 1024 ** 3


def checksum(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda: f.read(1024*1024), b''):
            h.update(block)
    return h.hexdigest()


def write_report(path, data):
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False)+'\n', encoding='utf-8')
    temp.replace(path)


def transform_point(matrix, point):
    x,y=point
    return [matrix[0]*x+matrix[2]*y+matrix[4], matrix[1]*x+matrix[3]*y+matrix[5]]


def _worker(path, output, settings, password, initial):
    # Native parsing/rendering lives in one bounded child, never concurrent threads.
    import resource
    resource.setrlimit(resource.RLIMIT_AS, (settings['memory_bytes'], settings['memory_bytes']))
    import pypdfium2 as pdfium
    report=initial
    report['renderer']={'pypdfium2':str(pdfium.PYPDFIUM_INFO),'pdfium':str(pdfium.PDFIUM_INFO)}
    destination=Path(output)/'manifest.json'
    try:
        doc=pdfium.PdfDocument(path,password=password)
    except pdfium.PdfiumError as error:
        report.update(status='password_required' if error.err_code==pdfium.raw.FPDF_ERR_PASSWORD else 'failed',
                      error='pdf_open_failed',password_recorded=False)
        write_report(destination,report)
        return
    try:
        count=len(doc)
        report['page_count']=count
        if count>settings['max_pages'] or count==0:
            report.update(status='resource_limit' if count else 'failed',unprocessed_page_count=count,
                          error='page_count_limit' if count else 'empty_pdf')
            write_report(destination,report)
            return
        report['pages']=[{'page':i+1,'status':'not_run'} for i in range(count)]
        total=0
        for i in range(count):
            item=report['pages'][i]
            item['status']='running'
            write_report(destination,report)
            page=bitmap=textpage=None
            try:
                page=doc[i]
                size=page.get_size()
                if any(not math.isfinite(x) or x<=0 for x in size):raise ValueError('Invalid page size')
                scale=settings['dpi']/72
                w,h=[math.ceil(x*scale) for x in size]
                pixels=w*h
                item.update(pdf_size=list(size),native_rotation=page.get_rotation(),
                            media_box=list(page.get_mediabox()),crop_box=list(page.get_cropbox()))
                if pixels>settings['max_page_pixels'] or total+pixels>settings['max_total_pixels']:
                    item.update(status='resource_limit',error='render_pixel_budget')
                    continue
                total+=pixels
                bitmap=page.render(scale=scale,may_draw_forms=False,draw_annots=True)
                converter=bitmap.get_posconv(page)
                origin=converter.to_page(0,0)
                x_axis=converter.to_page(bitmap.width,0)
                y_axis=converter.to_page(0,bitmap.height)
                matrix=[(x_axis[0]-origin[0])/bitmap.width,(x_axis[1]-origin[1])/bitmap.width,
                        (y_axis[0]-origin[0])/bitmap.height,(y_axis[1]-origin[1])/bitmap.height,*origin]
                image_path=Path(output)/f'page-{i+1:04d}.png'
                bitmap.to_pil().save(image_path)
                item.update(rendered_file=image_path.name,rendered_sha256=checksum(image_path),
                            rendered_size=[bitmap.width,bitmap.height],pixel_to_pdf=matrix,
                            coordinate_space='rendered_page_pixels',pdf_coordinate_space='pdfium_page_canvas',
                            requires_ocr=True,text_image_consistency='not_checked')
                textpage=page.get_textpage()
                chars=textpage.count_chars()
                cap=min(chars,settings['max_text_chars'])
                text=textpage.get_text_bounded() if chars<=cap else textpage.get_text_range(0,cap)
                boxes=[]
                for c in range(cap):
                    glyph=textpage.get_text_range(c,1)
                    if not glyph.strip():continue
                    left,bottom,right,top=textpage.get_charbox(c)
                    corners=[[left,bottom],[right,bottom],[right,top],[left,top]]
                    mapped=[list(converter.to_bitmap(*point)) for point in corners]
                    boxes.append({'index':c,'text':glyph,'pdf_polygon':corners,'rendered_polygon':mapped,
                                  'within_render':all(0<=x<=bitmap.width and 0<=y<=bitmap.height for x,y in mapped)})
                item.update(status='succeeded',text_layer={'text':text,'character_count':chars,
                    'coverage':'partial' if cap<chars else 'complete','characters':boxes,
                    'trust':'unverified_text_layer_not_visual_truth'},input_kind='text_or_mixed' if text.strip() else 'scan_or_blank')
            except Exception as error:
                item.update(status='failed',error=type(error).__name__)
            finally:
                if textpage is not None:textpage.close()
                if bitmap is not None:bitmap.close()
                if page is not None:page.close()
                write_report(destination,report)
        report['status']='succeeded' if all(p['status']=='succeeded' for p in report['pages']) else 'partial'
        report['processed_pages']=sum(p['status']=='succeeded' for p in report['pages'])
        report['unprocessed_page_count']=count-report['processed_pages']
        report['rendered_pixels']=total
        write_report(destination,report)
    finally:
        doc.close()


def prepare_pdf(path, output, limits=None, password=None):
    limits=limits or PdfLimits()
    settings=asdict(limits)
    if any(not isinstance(v,(int,float)) or not math.isfinite(v) or v<=0 for v in settings.values()):
        raise ValueError('All PDF resource limits must be finite positive values')
    if any(type(v) is not int for k,v in settings.items() if k != 'timeout_seconds'):
        raise ValueError('PDF count, size and DPI limits must be integers')
    path=Path(path).resolve(); output=Path(output).resolve()
    output.mkdir(parents=True,exist_ok=True)
    manifest=output/'manifest.json'
    if manifest.exists():raise FileExistsError('Use a fresh preparation directory; preserve previous evidence')
    report={'schema':'pdf-pages/0.1','status':'running','pages':[],
        'limits':settings,'limit_scope':'local_development_defaults_not_product_policy',
        'source_file':path.name,'file_sha256':None,'page_count':None,
        'javascript_executed':False,'interactive_forms_initialized':False,
        'attachments_extracted':False,'digital_signature_verified':False,
        'source_metadata_copied':False,'password_recorded':False}
    if path.stat().st_size>limits.max_bytes:
        report.update(status='resource_limit',error='file_bytes_limit')
        write_report(manifest,report);return report
    report['file_sha256']=checksum(path)
    write_report(manifest,report)
    child=multiprocessing.get_context('spawn').Process(target=_worker,args=(str(path),str(output),settings,password,report))
    child.start();child.join(limits.timeout_seconds)
    if child.is_alive():
        child.terminate();child.join(5)
        if child.is_alive():child.kill();child.join()
        failure='timeout'
    else:failure='worker_failed' if child.exitcode else None
    report=json.loads(manifest.read_text(encoding='utf-8'))
    if failure:
        report.update(status='partial' if any(p['status']=='succeeded' for p in report['pages']) else 'failed',error=failure)
        for item in report['pages']:
            if item['status']=='running':item.update(status='failed',error=failure)
        report['processed_pages']=sum(p['status']=='succeeded' for p in report['pages'])
        if report['page_count'] is not None:report['unprocessed_page_count']=report['page_count']-report['processed_pages']
        write_report(manifest,report)
    return report


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input',type=Path,required=True)
    parser.add_argument('--output-dir',type=Path,required=True)
    parser.add_argument('--max-pages',type=int,default=50)
    parser.add_argument('--dpi',type=int,default=144)
    args=parser.parse_args()
    report=prepare_pdf(args.input,args.output_dir,PdfLimits(max_pages=args.max_pages,dpi=args.dpi))
    print(json.dumps({'status':report['status'],'pages':report['page_count']}))
    return 0 if report['status']=='succeeded' else 1


if __name__=='__main__':raise SystemExit(main())
