"""Pinned FLAME v0.1.0 image-localization service; images remain in memory."""
import argparse
import base64
import gc
import hashlib
import inspect
import json
import os
from pathlib import Path
import subprocess
import sys
import time
from http.server import ThreadingHTTPServer
from http_service import State, make_handler

SOURCE_COMMIT='5d3d42f32934d64a898fd4fd05a815a9a3e32ebf'
SAM_COMMIT='2b90b9f5ceec907a1c18123530e92e794ad901a4'
ASSETS={
 'flame/model_params.json':'e46391983ca732313d1dc306e14ef3799c67a5bdf899a54a5fac8fef7e87ed42',
 'flame/flame_g2_ladmulti_sam2.pth':'9b6c67e3c35f647a3c9207275b1f1406c36780a2a3e0ee6b0f696d82161991bb',
 'sam2/sam2.1_hiera_base_plus.pt':'a2345aede8715ab1d5d31b4a509fb160c5a4af1970f199d9054ccfb746c004c5',
}

def digest(path):
    sha=hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda:f.read(8*1024**2),b''):sha.update(block)
    return sha.hexdigest()

class FlameEngine:
    def __init__(self,config):
        root=Path(config['assets_root']).resolve()
        source=root/'upstream/flame';sam_source=root/'upstream/sam2'
        for repo,expected in [(source,SOURCE_COMMIT),(sam_source,SAM_COMMIT)]:
            revision=subprocess.check_output(['git','-C',str(repo),'rev-parse','HEAD'],text=True).strip()
            if revision!=expected:raise RuntimeError('Model source revision mismatch')
            if subprocess.check_output(['git','-C',str(repo),'diff','--name-only'],text=True).strip():raise RuntimeError('Model source has tracked edits')
        for relative,expected in ASSETS.items():
            if digest(root/'models'/relative)!=expected:raise RuntimeError('Checkpoint integrity mismatch')
        os.environ.update(CUDA_VISIBLE_DEVICES=config['gpu_uuid'],HF_HUB_OFFLINE='1',TRANSFORMERS_OFFLINE='1')
        sys.dont_write_bytecode=True
        import numpy as np
        import torch
        import torchvision.transforms.functional as TF
        from PIL import Image
        from hydra import initialize_config_dir
        from hydra.core.global_hydra import GlobalHydra
        torch.set_num_threads(4);torch.manual_seed(3407)
        fraction=float(config.get('memory_fraction',.12))
        if not 0<fraction<=.15:raise RuntimeError('GPU budget must not exceed15%')
        torch.cuda.set_per_process_memory_fraction(fraction,0)
        if torch.cuda.mem_get_info(0)[0]<4*1024**3:raise RuntimeError('At least4 GiB free GPU memory required')
        torch.backends.cudnn.benchmark=False;torch.backends.cudnn.deterministic=True;torch.backends.cuda.matmul.allow_tf32=False
        repo=source/'FLAME';sys.path.insert(0,str(repo))
        from model.forgerylocalizer import ForgeryLocalizer
        cfg=json.loads((root/'models/flame/model_params.json').read_text())
        model_config=cfg['model_config'];signature=inspect.signature(ForgeryLocalizer.__init__).parameters
        kwargs={k:v for k,v in model_config.items() if k in signature}
        kwargs['adapter_active_scales']=model_config.get('adapter_scales')
        kwargs['use_detection_probe']=cfg['data_config'].get('authentic_ratio',0)>0
        self.size=cfg['training_config']['img_size']
        if self.size!=512:raise RuntimeError('Unexpected model resolution')
        kwargs.update(sam_config=cfg['sam_config']['sam_config_file'],sam_checkpoint=str(root/'models/sam2/sam2.1_hiera_base_plus.pt'),output_resolution=(self.size,self.size))
        GlobalHydra.instance().clear();initialize_config_dir(config_dir=str(repo/'sam2configs'),version_base=None)
        model=ForgeryLocalizer(**kwargs)
        checkpoint=torch.load(root/'models/flame/flame_g2_ladmulti_sam2.pth',map_location='cpu',weights_only=True)
        state=checkpoint['model'];loaded=model.load_state_dict(state,strict=False)
        trainable={k for k,p in model.named_parameters() if p.requires_grad}
        if loaded.unexpected_keys or trainable.intersection(loaded.missing_keys):raise RuntimeError('Incomplete trainable model state')
        if any(not k.startswith(('encoder.','decoder.','sam_prompt_encoder.')) for k in loaded.missing_keys):raise RuntimeError('Missing non-SAM parameters')
        current=model.state_dict()
        if any(k not in current or not torch.equal(current[k].cpu(),v.cpu().to(current[k].dtype)) for k,v in state.items()):raise RuntimeError('Loaded tensor mismatch')
        self.model=model.cuda().eval();self.model.requires_grad_(False)
        self.torch,self.np,self.TF,self.Image=torch,np,TF,Image
        self.info={'provider':'FLAME','model':'FLAME-v0.1.0-LADMulti-SAM2','source_commit':SOURCE_COMMIT,'checkpoint_sha256':ASSETS,'mask_threshold':.5,'model_resolution':[512,512],'localization_supported':True,'gpu_memory_fraction':fraction,'precision':'publisher CUDA autocast FP16','preprocessing':'EXIF orientation, RGB; whole image resized512x512 bilinear, RGB[0,1]','missing_trainable':[],'tensor_equality':True}
        del checkpoint,state,current
        gc.collect()
    def infer(self,image,metadata):
        torch=self.torch;started=time.monotonic()
        tensor=self.TF.to_tensor(image.resize((self.size,self.size),self.Image.Resampling.BILINEAR)).unsqueeze(0).cuda()
        with torch.inference_mode(),torch.autocast('cuda',dtype=torch.float16):logits,_=self.model(tensor,[],output_extras=True)
        if not torch.isfinite(logits).all():raise RuntimeError('Nonfinite localization output')
        probability=torch.sigmoid(logits).float().squeeze().cpu().numpy()
        if probability.shape!=(self.size,self.size):raise RuntimeError('Unexpected output geometry')
        mask=probability>=.5
        packed=self.np.packbits(mask.reshape(-1),bitorder='big').tobytes()
        return {'status':'succeeded','provider':'FLAME','model':self.info['model'],'source_commit':SOURCE_COMMIT,'checkpoint_sha256':ASSETS['flame/flame_g2_ladmulti_sam2.pth'],'input':metadata,'mask':{'encoding':'bitpack-msb','width':self.size,'height':self.size,'data':base64.b64encode(packed).decode()},'mask_threshold':.5,'inference_seconds':round(time.monotonic()-started,4),'localization_supported':True}

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--config',type=Path,required=True);args=parser.parse_args();cfg=json.loads(args.config.read_text())
    if cfg.get('host','127.0.0.1')!='127.0.0.1':raise RuntimeError('Service must bind loopback')
    token_file=Path(cfg['token_file'])
    if token_file.stat().st_mode&0o077:raise RuntimeError('Service token must be private')
    token=token_file.read_text().strip()
    if len(token)<32:raise RuntimeError('Invalid service token')
    engine=FlameEngine(cfg)
    server=ThreadingHTTPServer(('127.0.0.1',int(cfg.get('port',18083))),make_handler(State(engine,token)))
    print(json.dumps({'event':'ready','model':engine.info}),flush=True);server.serve_forever()
if __name__=='__main__':main()
