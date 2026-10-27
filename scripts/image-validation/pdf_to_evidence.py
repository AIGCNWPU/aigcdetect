"""Local PDF -> bounded rendering -> real local OCR -> source-linked evidence."""
import argparse,json,subprocess,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'src/modules/image/documents/python'))
from pdf_adapter import prepare_pdf,write_report
from pdf_evidence import bind_pdf_ocr
from pdf_receipt_rules import fuse_pdf_pages

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--input',type=Path,required=True);p.add_argument('--output-dir',type=Path,required=True);p.add_argument('--weights',type=Path,required=True);a=p.parse_args()
    out=a.output_dir.resolve();manifest=prepare_pdf(a.input,out/'pages')
    rows=[{'sample_id':f"pdf-page-{page['page']}",'path':str(out/'pages'/page['rendered_file']),'expected_sha256':page['rendered_sha256']} for page in manifest['pages'] if page['status']=='succeeded']
    ocr={'samples':[]}
    if rows:
        inputs=out/'ocr-inputs.json';write_report(inputs,rows)
        process=subprocess.run([sys.executable,str(Path(__file__).with_name('smoke_ocr.py')),'--image-manifest',str(inputs),'--weights',str(a.weights),'--output',str(out/'ocr.json')])
        if (out/'ocr.json').exists():ocr=json.loads((out/'ocr.json').read_text())
        ocr['process_exit_code']=process.returncode
    result=bind_pdf_ocr(manifest,ocr);write_report(out/'evidence.json',result)
    write_report(out/'receipt-rules.json',fuse_pdf_pages(manifest,ocr))
    print(json.dumps({'status':result['status'],'processed_pages':result['processed_pages'],'total_pages':result['page_count']}))
    return 0 if result['status']=='succeeded' else 1
if __name__=='__main__':raise SystemExit(main())
