"""Download pinned TruFor inference source and hash-verified official final weights."""
import urllib.request,json,pathlib,hashlib,concurrent.futures,time,zipfile,shutil
ROOT=pathlib.Path(__file__).resolve().parents[4];base=ROOT/'runtime/research/provenance-trufor-20261105';base.mkdir(parents=True,exist_ok=True);rev='ae54475df6f41a491d7615100feb19263dec13f7'
tree_path=base/'trufor-tree.json'
if not tree_path.exists():
 tree_path.write_bytes(urllib.request.urlopen(f'https://api.github.com/repos/grip-unina/TruFor/git/trees/{rev}?recursive=1',timeout=30).read())
tree=json.loads(tree_path.read_text());out=ROOT/'third_party/trufor';out.mkdir(exist_ok=True)
files=[x for x in tree['tree'] if x['type']=='blob' and x.get('size',0)<4000000]
def download(x):
 p=out/x['path'];p.parent.mkdir(parents=True,exist_ok=True)
 if p.exists() and p.stat().st_size==x['size'] and hashlib.sha1(b'blob '+str(x['size']).encode()+b'\x00'+p.read_bytes()).hexdigest()==x['sha']:return
 for attempt in range(4):
  try:
   b=urllib.request.urlopen(f'https://raw.githubusercontent.com/grip-unina/TruFor/{rev}/'+urllib.parse.quote(x['path']),timeout=45).read()
   assert hashlib.sha1(b'blob '+str(len(b)).encode()+b'\x00'+b).hexdigest()==x['sha']
   p.write_bytes(b);return
  except Exception:
   if attempt==3:raise
   time.sleep(1)
source_pool=concurrent.futures.ThreadPoolExecutor(10)
source_jobs=[source_pool.submit(download,x) for x in files]
(out/'UPSTREAM.json').write_text(json.dumps({'repository':'grip-unina/TruFor','commit':rev,'downloadedFiles':len(files),'excludedTrainingAssets':[x['path'] for x in tree['tree'] if x['type']=='blob' and x.get('size',0)>=4000000]},indent=2))
print('source downloads scheduled',len(files),flush=True)
url='https://www.grip.unina.it/download/prog/TruFor/TruFor_weights.zip';size=260878690;chunk=8*1024*1024;parts=base/'weight-parts';parts.mkdir(exist_ok=True)
def part(start):
 end=min(size,start+chunk)-1;p=parts/str(start)
 if p.exists() and p.stat().st_size==end-start+1:return
 for attempt in range(4):
  try:
   with urllib.request.urlopen(urllib.request.Request(url,headers={'Range':f'bytes={start}-{end}'}),timeout=90) as r:
    assert r.status==206 and r.headers['Content-Range']==f'bytes {start}-{end}/{size}'
    b=r.read();assert len(b)==end-start+1;p.write_bytes(b)
   print('part',start,flush=True);return
  except Exception:
   if attempt==3:raise
with concurrent.futures.ThreadPoolExecutor(32) as pool:list(pool.map(part,range(0,size,chunk)))
dest=base/'TruFor_weights.zip'
with dest.open('wb') as f:
 for start in range(0,size,chunk):f.write((parts/str(start)).read_bytes())
assert hashlib.md5(dest.read_bytes()).hexdigest()=='7bee48f3476c75616c3c5721ab256ff8'
weights=ROOT/'weights/trufor';weights.mkdir(exist_ok=True)
with zipfile.ZipFile(dest) as z:
 print(z.namelist(),flush=True)
 for n in z.namelist():
  if n.endswith('.pth.tar'):
   with z.open(n) as r,(weights/'trufor.pth.tar').open('wb') as f:shutil.copyfileobj(r,f)
p=weights/'trufor.pth.tar';(weights/'provenance.json').write_text(json.dumps({'url':url,'archiveMD5':'7bee48f3476c75616c3c5721ab256ff8','sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size},indent=2));print('weights ready',flush=True)

for job in source_jobs: job.result()
source_pool.shutdown()
print('all source ready',flush=True)
