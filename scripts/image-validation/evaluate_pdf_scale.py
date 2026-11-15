"""Controlled 64-page stress/correctness run; no authenticity accuracy claim."""
import argparse,json,time,sys
from pathlib import Path
from test_pdf_adapter import make_pdf
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'src/modules/image/documents/python'))
from pdf_adapter import prepare_pdf,transform_point,write_report

def main():
    p=argparse.ArgumentParser();p.add_argument('--output-dir',type=Path,required=True);a=p.parse_args();out=a.output_dir;out.mkdir(parents=True,exist_ok=True)
    if (out/'results.json').exists():raise FileExistsError('Preserve existing test run')
    rows=[]
    for rotation in (0,90,180,270):
        for crop in (False,True):
            for hidden in (False,True):
                name=f'r{rotation}-c{int(crop)}-h{int(hidden)}';pdf=out/f'{name}.pdf';make_pdf(pdf,pages=4,rotation=rotation,crop=crop,hidden=hidden)
                start=time.perf_counter();r=prepare_pdf(pdf,out/name)
                errors=[];mapped=0
                for page in r['pages']:
                    if page['status']!='succeeded':continue
                    for char in page['text_layer']['characters']:
                        for pixel,gt in zip(char['rendered_polygon'],char['pdf_polygon']):
                            actual=transform_point(page['pixel_to_pdf'],pixel);errors.append(max(abs(a-b) for a,b in zip(actual,gt)));mapped+=1
                rows.append({'case':name,'status':r['status'],'pages':r['page_count'],'seconds':time.perf_counter()-start,'mapped_corners':mapped,'max_roundtrip_error_pdf_units':max(errors,default=None),'hidden_text_remains_untrusted':all(p.get('text_layer',{}).get('trust')=='unverified_text_layer_not_visual_truth' for p in r['pages'])})
    result={'kind':'controlled_pdf_engineering_validation','case_count':len(rows),'page_count':sum(r['pages'] for r in rows),'passed':sum(r['status']=='succeeded' and r['max_roundtrip_error_pdf_units']<=.51 and r['hidden_text_remains_untrusted'] for r in rows),'not_measured':['real_invoice_accuracy','text_image_consistency','digital_signatures','Chinese_OCR_accuracy'],'cases':rows}
    write_report(out/'results.json',result);print(json.dumps({k:v for k,v in result.items() if k!='cases'}))
if __name__=='__main__':main()
