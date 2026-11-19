"""Seeded 40-pair official CocoGlide subset, byte-preserved images and masks."""
import importlib.util,json,zipfile,random,re,concurrent.futures
from pathlib import Path
p=Path(__file__).with_name('download-forensics-testsets.py');s=importlib.util.spec_from_file_location('downloads',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
ROOT=Path(__file__).resolve().parents[4];base=ROOT/'datasets/provenance-20261105/cocoglide';base.mkdir(parents=True,exist_ok=True)
u='https://www.grip.unina.it/download/prog/TruFor/CocoGlide.zip';size=123161479
z=zipfile.ZipFile(m.RemoteFile(u,size));names=z.namelist()
(base/'README.txt').write_bytes(z.read('README.txt'));(base/'table.csv').write_bytes(z.read('table.csv'));(base/'licenses.json').write_bytes(z.read('licenses.json'))
def identity(name):return re.search(r'_(\d+)(?:_up|_mask)?\.png$',name).group(1)
groups={k:{identity(n):n for n in names if n.startswith(k+'/') and n.endswith('.png')} for k in ['fake','real','mask']}
ids=random.Random(20261105).sample(sorted(set.intersection(*(set(v) for v in groups.values()))),40)
def get_group(k):
 archive=zipfile.ZipFile(m.RemoteFile(u,size));result=[]
 for ident in ids:
  member=groups[k][ident];dest=base/member
  data=archive.read(member);entry=m.store(data,dest);entry.update(id=ident,kind=k,archiveMember=member);result.append(entry)
 print(k,'downloaded',len(result),flush=True);return result
with concurrent.futures.ThreadPoolExecutor(3) as pool:rows=sum(list(pool.map(get_group,groups)),[])
(base/'manifest.json').write_text(json.dumps(rows,indent=2));(base/'provenance.json').write_text(json.dumps({'url':u,'archiveBytes':size,'seed':20261105,'pairs':40,'sampling':'sample sorted shared COCO ids; original bytes; no resizing','members':len(rows)},indent=2))
print('saved',len(rows),flush=True)
