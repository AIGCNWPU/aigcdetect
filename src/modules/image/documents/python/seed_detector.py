"""Local SEED adapter: frozen full checkpoint, native 512px tiling, source-space masks."""
import hashlib,json,os,sys,types
from pathlib import Path

SOURCE_REVISION='0a60bf9144216c5545a53e7d2b80476c006a538f'
WEIGHTS_SHA256='7ed896311181b1e24d3bcb696c1542a7942df5cd89729e2b9de90112327102d9'

def digest(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda:f.read(8*1024*1024),b''):h.update(block)
    return h.hexdigest()

def starts(length,window=512):
    if length<=0 or window<=0:raise ValueError('Positive image/window dimensions required')
    if length<=window:return [0]
    positions=list(range(0,length-window+1,window))
    if positions[-1]!=length-window:positions.append(length-window)
    return positions

def components(probability,threshold=.5):
    import cv2,numpy as np
    if probability.ndim!=2 or not np.isfinite(probability).all() or (probability<0).any() or (probability>1).any():raise ValueError('Invalid probability map')
    mask=(probability>=threshold).astype(np.uint8)
    count,labels,stats,_=cv2.connectedComponentsWithStats(mask,8)
    regions=[]
    for i in range(1,count):
        x,y,w,h,area=map(int,stats[i]);values=probability[labels==i]
        regions.append({'region_id':f'seed-{i}','box':[x,y,x+w,y+h],'area_pixels':area,
            'mask_score_mean':float(values.mean()),'mask_score_max':float(values.max()),
            'coordinate_space':'exif_oriented_image_pixels','interpretation':'suspected_visual_tampering_not_proven_forgery'})
    return mask,regions

class SeedDetector:
    def __init__(self,source,weights,gpu='3'):
        os.environ['CUDA_VISIBLE_DEVICES']=str(gpu)
        os.environ['HF_HUB_OFFLINE']='1';os.environ['TRANSFORMERS_OFFLINE']='1'
        import subprocess
        source=Path(source).resolve();weights=Path(weights).resolve()
        if subprocess.check_output(['git','-C',str(source),'rev-parse','HEAD'],text=True).strip()!=SOURCE_REVISION:raise ValueError('Unpinned SEED source')
        if subprocess.check_output(['git','-C',str(source),'status','--porcelain'],text=True).strip():raise ValueError('Upstream source must remain unmodified')
        if digest(weights/'model.safetensors')!=WEIGHTS_SHA256:raise ValueError('SEED publisher checksum mismatch')
        config=json.loads((weights/'config.json').read_text())
        if config!={'model_type':'SEED','backbone':'facebook/dinov3-vitl16-pretrain-lvd1689m','img_size':[512,512],'num_classes':1,'num_q':1,'num_blocks':4,'finetune_mode':'lora','lora_rank':1,'moeffort_target_keywords':['attention','mlp']}:raise ValueError('Unexpected detector config')
        import torch
        from transformers import DINOv3ViTConfig,DINOv3ViTModel
        from safetensors.torch import load_file
        from unittest.mock import patch
        torch.set_num_threads(4)
        # Only inference cfg values are supplied; upstream training cfg imports
        # unnecessary augmentations and selects six GPUs. No training entry runs.
        cfg=types.ModuleType('cfg')
        for k,v in dict(hf_cache_root=str(weights),hf_hub_cache=str(weights),hf_transformers_cache=str(weights),realtextv2_img_size=512,num_q=1,finetune_mode='lora',lora_rank=1,moeffort_target_keywords=('attention','mlp')).items():setattr(cfg,k,v)
        sys.modules['cfg']=cfg;sys.path.insert(0,str(source))
        from model.eomt_sep_query import EoMT
        # The public SEED checkpoint includes the whole backbone. Initialize only
        # architecture here, then strictly replace EVERY persistent parameter.
        # No separate gated Meta checkpoint, no random-weight inference fallback.
        backbone_config=DINOv3ViTConfig(hidden_size=1024,intermediate_size=4096,num_hidden_layers=24,
            num_attention_heads=16,num_register_tokens=4,patch_size=16,hidden_act='gelu',use_gated_mlp=False,
            layer_norm_eps=1e-5,rope_theta=100.,pos_embed_rescale=2.,layerscale_value=1.)
        def initialize(*args,**kwargs):return DINOv3ViTModel(backbone_config)
        with patch('model.eomt_sep_query.AutoModel.from_pretrained',side_effect=initialize):
            self.model=EoMT(img_size=(512,512),num_q=1,num_blocks=4,finetune_mode='lora',lora_rank=1)
        loaded=self.model.load_state_dict(load_file(str(weights/'model.safetensors')),strict=True)
        self.model.eval().to('cuda:0')
        self.load_record={'strict':True,'missing':loaded.missing_keys,'unexpected':loaded.unexpected_keys,
            'backbone_initialization':'architecture_only_then_strict_complete_SEED_state','backbone_config':backbone_config.to_dict()}

    def predict(self,image,batch_size=4,max_pixels=20_000_000):
        import numpy as np,torch
        import torch.nn.functional as F
        w,h=image.size
        if w*h>max_pixels:raise ValueError('Development page pixel budget exceeded')
        probability=np.zeros((h,w),dtype=np.float32);pending=[];meta=[];tiles=[]
        def flush():
            if not pending:return
            x=torch.from_numpy(np.stack(pending)).permute(0,3,1,2).contiguous().float().to('cuda:0')
            with torch.inference_mode(),torch.autocast('cuda',dtype=torch.float16):
                masks,classes,_,image_logits=self.model(x)
                mask_logits=F.interpolate(masks[-1],size=(512,512),mode='bilinear',align_corners=False)
                q=classes[-1].softmax(-1)[...,0].argmax(1)
                selected=mask_logits.sigmoid()[torch.arange(len(pending),device=x.device),q]
                scores=image_logits.softmax(1)[:,1]
            selected=selected.float().cpu().numpy();scores=scores.float().cpu().numpy()
            for values,score,(left,top,pw,ph,pl,pt) in zip(selected,scores,meta):
                tiles.append({'box':[left,top,left+pw,top+ph],'score':float(score)})
                # Match upstream image-head gate; retain tile scores separately.
                if score>=.5:
                    np.maximum(probability[top:top+ph,left:left+pw],values[pt:pt+ph,pl:pl+pw],out=probability[top:top+ph,left:left+pw])
            pending.clear();meta.clear()
        for top in starts(h):
            for left in starts(w):
                patch=np.asarray(image.crop((left,top,min(left+512,w),min(top+512,h))).convert('RGB'))
                ph,pw=patch.shape[:2];pt=(512-ph)//2;pl=(512-pw)//2
                padded=np.full((512,512,3),255,dtype=np.uint8);padded[pt:pt+ph,pl:pl+pw]=patch
                pending.append(padded);meta.append((left,top,pw,ph,pl,pt))
                if len(pending)==batch_size:flush()
        flush();mask,regions=components(probability)
        return {'detector_score':max(t['score'] for t in tiles),'tiles':tiles,'regions':regions,
            'pixel_fraction':float(mask.mean()),'region_count':len(regions)},probability,mask
