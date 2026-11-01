"""CO-SPY ProGAN checkpoint service, using the already verified upstream assets."""
import argparse
import hashlib
from http.server import ThreadingHTTPServer
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import time
from http_service import State,make_handler

COMMIT='310d048387edaf11f236ed1c7180d0e1e823250f'
CLIP_REVISION='32bd64288804d66eefd0ccbe215aa642df71cc41'
CLIP_SHA='a2bf730a0c7debf160f7a6b50b3aaf3703e7e88ac73de7a314903141db026dcb'
WEIGHT_SHA={
    'artifact_weights.pth':'76b4c13d37ee6a03d43986a3b9c76775e4cf5543c2b104bbde58ba7553929c26',
    'fusion_weights.pth':'791ce1beecb95899c856056a55526f0e1054db8ddaebb3983af5ff43ea8cdb83',
    'semantic_weights.pth':'d4076d7e0522bfb4c5921ea85b63ba22b2d4d96a3d6d0d676fc247d502a30b7a',
}
def digest(path):
    sha=hashlib.sha256()
    with Path(path).open('rb') as file:
        for block in iter(lambda:file.read(8*1024*1024),b''):sha.update(block)
    return sha.hexdigest()

class CoSpyEngine:
    def __init__(self,config):
        source=Path(config['source_dir']).resolve();weights=Path(config['weights_dir']).resolve();clip=Path(config['clip_dir']).resolve()
        revision=subprocess.check_output(['git','-C',str(source),'rev-parse','HEAD'],text=True).strip()
        if revision!=COMMIT:raise RuntimeError('CO-SPY source revision mismatch')
        for name,expected in WEIGHT_SHA.items():
            if digest(weights/name)!=expected:raise RuntimeError('CO-SPY checkpoint integrity mismatch')
        if digest(clip/'model.safetensors')!=CLIP_SHA:raise RuntimeError('CLIP checkpoint integrity mismatch')
        os.environ.update(CUDA_VISIBLE_DEVICES=config['gpu_uuid'],HF_HUB_OFFLINE='1',TRANSFORMERS_OFFLINE='1',PYTHONDONTWRITEBYTECODE='1')
        sys.dont_write_bytecode=True;sys.path.insert(0,str(source))
        import torch
        from transformers import CLIPModel
        torch.set_num_threads(4);torch.manual_seed(3407)
        fraction=float(config.get('memory_fraction',.15))
        if not 0<fraction<=.25:raise RuntimeError('GPU budget must be between0 and25%')
        torch.cuda.set_per_process_memory_fraction(fraction,0)
        if torch.cuda.mem_get_info(0)[0]<3*1024**3:raise RuntimeError('At least3 GiB free GPU memory is required')
        torch.backends.cudnn.benchmark=False;torch.backends.cudnn.deterministic=True;torch.backends.cuda.matmul.allow_tf32=False
        original_pretrained=CLIPModel.from_pretrained
        CLIPModel.from_pretrained=classmethod(lambda cls,name,*args,**kwargs:original_pretrained(str(clip),*args,local_files_only=True,**kwargs))
        from detectors.progan.fusion import CoSpyFusionDetector
        model=CoSpyFusionDetector(str(weights/'semantic_weights.pth'),str(weights/'artifact_weights.pth'))
        loaded=model.art.load_state_dict(torch.load(weights/'artifact_weights.pth',map_location='cpu',weights_only=True),strict=True)
        model.load_weights(str(weights/'fusion_weights.pth'))
        for module,name in [(model.sem,'semantic_weights.pth'),(model,'fusion_weights.pth')]:
            state=torch.load(weights/name,map_location='cpu',weights_only=True)
            if set(state)!={'fc.weight','fc.bias'} or not torch.equal(module.fc.weight.cpu(),state['fc.weight']) or not torch.equal(module.fc.bias.cpu(),state['fc.bias']):raise RuntimeError('CO-SPY classifier weights do not match')
        self.torch=torch;self.model=model.to('cuda:0').eval();self.model.requires_grad_(False);self.transform=model.test_transform
        self.info={'provider':'CO-SPY','model':'CO-SPY-ProGAN','source_commit':revision,'checkpoint_sha256':WEIGHT_SHA,'clip_revision':CLIP_REVISION,'clip_sha256':CLIP_SHA,'preprocessing':'EXIF orientation and alpha normalization; publisher short-side256 resize, center224 crop, branch-specific normalization','full_image_pixel_coverage':False,'localization_supported':False,'score_semantics':'uncalibrated_synthetic_class_sigmoid_not_fraud_probability','precision':'float32','gpu_memory_fraction':fraction,'strict_load':{'artifact_missing':loaded.missing_keys,'artifact_unexpected':loaded.unexpected_keys,'semantic_and_fusion_verified':True}}
    def infer(self,image,metadata):
        torch=self.torch;tensor=self.transform(image).unsqueeze(0).to('cuda:0');torch.cuda.synchronize();started=time.monotonic()
        with torch.inference_mode():logit=self.model(tensor).float().flatten()[0];score=float(torch.sigmoid(logit).item());raw_logit=float(logit.item())
        torch.cuda.synchronize()
        if not math.isfinite(score) or not math.isfinite(raw_logit):raise RuntimeError('Non-finite model output')
        return {'status':'succeeded','provider':'CO-SPY','model':self.info['model'],'source_commit':COMMIT,'input':metadata,'generated_score':score,'raw_logit':raw_logit,'predicted_class':'generated' if score>=.5 else 'real','score_semantics':self.info['score_semantics'],'scope':'publisher_resized_center_view','full_image_pixel_coverage':False,'localization_supported':False,'inference_seconds':round(time.monotonic()-started,4)}

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--config',type=Path,required=True);args=parser.parse_args();config=json.loads(args.config.read_text())
    if config.get('host','127.0.0.1')!='127.0.0.1':raise RuntimeError('Service must bind loopback')
    token_path=Path(config['token_file'])
    if token_path.stat().st_mode&0o077:raise RuntimeError('Token file must be private')
    token=token_path.read_text().strip()
    if len(token)<32:raise RuntimeError('Invalid private service token')
    engine=CoSpyEngine(config);server=ThreadingHTTPServer(('127.0.0.1',int(config.get('port',18082))),make_handler(State(engine,token)))
    print(json.dumps({'event':'ready','address':server.server_address,'model':engine.info}),flush=True);server.serve_forever()

if __name__=='__main__':main()
