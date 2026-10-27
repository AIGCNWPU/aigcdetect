"""Associate actual SEED mask pixels with local OCR; keep all raw values local."""
import math

def associate(detector,ocr,mask):
    import cv2,numpy as np
    if detector.get('status')!='succeeded' or ocr.get('status')!='succeeded':raise ValueError('Successful detector and OCR required')
    if detector['input_sha256']!=ocr['input_sha256'] or detector['oriented_size']!=ocr['oriented_size']:raise ValueError('Evidence source/coordinates differ')
    w,h=detector['oriented_size']
    if mask.shape!=(h,w):raise ValueError('Mask coordinate mismatch')
    _,labels=cv2.connectedComponents((mask>0).astype(np.uint8),8)
    valid={r['region_id'] for r in detector['regions']};links=[]
    for region in ocr['regions']:
        poly=np.asarray(region['polygon'],dtype=float)
        if poly.shape!=(4,2) or not np.isfinite(poly).all() or (poly<0).any() or (poly[:,0]>w).any() or (poly[:,1]>h).any():raise ValueError('Invalid OCR polygon')
        x1,y1=np.floor(poly.min(0)).astype(int);x2,y2=np.ceil(poly.max(0)).astype(int)
        x2=min(x2+1,w);y2=min(y2+1,h)
        if x2<=x1 or y2<=y1:raise ValueError('Empty OCR polygon')
        roi=np.zeros((y2-y1,x2-x1),np.uint8);cv2.fillPoly(roi,[np.rint(poly-[x1,y1]).astype(np.int32)],1)
        selected=labels[y1:y2,x1:x2][roi>0];ids,counts=np.unique(selected,return_counts=True)
        for i,count in zip(ids,counts):
            if not i:continue
            key=f'seed-{int(i)}'
            if key not in valid:raise ValueError('Mask components do not match detector region ids')
            links.append({'seed_region_id':key,'ocr_region_id':region['region_id'],'overlap_pixels':int(count),
               'fraction_of_ocr_polygon':float(count/len(selected)),'observed_text':region['observed_text'],
               'recognition_confidence':region['recognition_confidence'],'polygon':region['polygon'],
               'interpretation':'spatial_association_only_not_proof_of_tampering'})
    return {'schema':'seed-ocr-links/0.1','input_sha256':detector['input_sha256'],'links':links,'raw_text_scope':'local_only','overall_authenticity':None}
