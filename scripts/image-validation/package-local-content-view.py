"""Copy a completed local evaluation and simulation into a new inspection folder."""
import argparse
import hashlib
import json
from pathlib import Path
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--run',type=Path,required=True)
p.add_argument('--output',type=Path,required=True)
p.add_argument('--integration',type=Path)
a=p.parse_args()
source=a.run.resolve();target=a.output.resolve()
report=json.loads((source/'report.json').read_text())
assert report['totals']['files']==20, 'Complete 20-image evaluation required'
assert (source/'simulated-handoff'/'report.json').is_file(), 'Simulation contract output required'
target.mkdir(mode=0o700,exist_ok=False)
records=[]
def copy(src,dst):
 dst.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
 content=src.read_bytes()
 with dst.open('xb') as f:f.write(content)
 dst.chmod(0o600)
 digest=hashlib.sha256(content).hexdigest()
 assert hashlib.sha256(dst.read_bytes()).hexdigest()==digest
 records.append({'source':str(src),'copy':str(dst.relative_to(target)),'sha256':digest})
for f in sorted(source.rglob('*')):
 if f.is_file():copy(f,target/f.relative_to(source))
if a.integration:
 for name in ['result.json','local-invoice-desktop.png','local-invoice-mobile.png']:
  copy(a.integration/name,target/'integration'/name)
readme=target/'查看说明.md'
readme.write_text('# 新版本地核验结果\n\n[打开20张材料的本地结果页面](index.html) · [模拟语义衔接](simulated-handoff/README.md)\n\n本目录是新实验的副本，不替换上一级旧inspection-details。先看每组“本地逐项检查”及对应双方字段。\n\n模拟语义是固定离线替身，不是API或本地大模型推理；本轮外部API调用0次。\n\n[integration/result.json](integration/result.json)是两张真实发票经网页上传、重新OCR、本地计算和跨份候选的独立验证，截图也在integration中。\n',encoding='utf-8');readme.chmod(0o600)
(target/'copy-checksums.json').write_text(json.dumps(records,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
(target/'copy-checksums.json').chmod(0o600)
print(json.dumps({'output':str(target),'verifiedCopies':len(records),'files':report['totals']['files']},ensure_ascii=False))
