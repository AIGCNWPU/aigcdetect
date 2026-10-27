"""Summarize SEED/9B on identical inputs and build a local, self-contained review."""
import argparse,json,html,sys
from pathlib import Path
from evaluate_results import summarize,prediction
from smoke_ocr import sha256

def cord_observations(samples):
    decisions=[prediction(s,'mirror') for s in samples]
    valid=[x for x in decisions if x is not None]
    return {'n':len(samples),'valid_predictions':len(valid),'flagged':sum(x==1 for x in valid),
        'flag_rate':sum(x==1 for x in valid)/len(valid) if valid else None,
        'forensic_labels_available':False,'fpr':None,'accuracy':None,
        'reason':'Published CORD images include visible blur/occlusion; legacy label=0 was an evaluation assumption, not forensic ground truth.',
        'visual_spotcheck_ids':['cord-test-000','cord-test-001','cord-test-002'],
        'interpretation':'response_to_published_receipts_with_visible_edits_not_verified_forgery_detection'}

def main():
    p=argparse.ArgumentParser();p.add_argument('--run',type=Path,required=True);p.add_argument('--manifest',type=Path,required=True);p.add_argument('--docshield',type=Path,required=True);p.add_argument('--explanations',type=Path);a=p.parse_args()
    r=json.loads((a.run/'results.json').read_text());m=json.loads(a.manifest.read_text());old=json.loads(a.docshield.read_text())['samples'];old={s['sample_id']:s for s in old}
    if r['manifest_sha256']!=sha256(a.manifest):raise ValueError('Manifest mismatch')
    expected={s['sample_id']:s for s in m};rows=r['samples']
    if len({s['sample_id'] for s in rows})!=len(rows):raise ValueError('Duplicate results')
    for s in rows:
        if s['sample_id'] not in expected or s['input_sha256']!=expected[s['sample_id']]['expected_sha256']:raise ValueError('Source mismatch')
    indexed={s['sample_id']:s for s in rows};samples=[dict(indexed.get(x['sample_id'],dict(x,status='not_run')),generated_score=indexed.get(x['sample_id'],{}).get('detector_score')) for x in m]
    real=[s for s in samples if s['sample_id'] in old];cord=[s for s in samples if s['sample_id'] not in old]
    transitions=[]
    for s in real:
        prior=old[s['sample_id']]
        if prior['input_sha256']!=s.get('input_sha256'):raise ValueError('Comparison source mismatch')
        transitions.append({'sample_id':s['sample_id'],'label':s['label'],'docshield':prediction(prior,'docshield'),'seed':prediction(s,'mirror')})
    report={'complete':len(rows)==len(m),'n':len(m),'versions':r['versions'],'realtext':summarize(real,'mirror'),'cord_observational':cord_observations(cord),
        'docshield_same60':summarize(list(old.values()),'docshield'),'paired_transitions':transitions,
        'localization':{'mask_and_source_boxes_saved':True,'pixel_iou':None,'reason':'No_gt_tamper_masks_for_these_images'},
        'limitations':['RealText_family_training_overlap_not_excluded','CORD_published_images_include_visible_edits_not_valid_pristine_negative_control','native_tiling_max_score_is_not_calibrated_probability','no_Chinese_independent_accuracy_claim']}
    (a.run/'metrics.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    from PIL import Image,ImageOps
    explanations={}
    if a.explanations:
        explanations={x['sample_id']:x['api'] for x in json.loads(a.explanations.read_text())['samples']}
    cards=[]
    for i,s in enumerate(rows):
        if s['status']!='succeeded':cards.append(f'<section><h3>{html.escape(s["sample_id"])}</h3><p>处理失败：{html.escape(s.get("error",""))}</p></section>');continue
        original=a.run/f'{i:03d}-original.jpg'
        if not original.exists():
            with Image.open(s['path']) as source:
                im=ImageOps.exif_transpose(source).convert('RGB');im.thumbnail((900,1200));im.save(original)
        prior=old.get(s['sample_id']);prior_text=str(prediction(prior,'docshield')) if prior else '未运行'
        label_display=s['label'] if prior else '未提供鉴伪真值（旧 label=0 不适用）'
        cards.append(f'<section data-score="{s["detector_score"]}"><h3>{html.escape(s["sample_id"])}</h3><p>数据标签 {label_display}；SEED {s["detector_score"]:.5f}；9B {prior_text}；区域 {s["region_count"]}；掩码面积 {s["pixel_fraction"]:.2%}</p><div><figure><img loading="lazy" src="{original.name}"><figcaption>原图预览</figcaption></figure><figure><img loading="lazy" src="{html.escape(s["overlay_file"])}"><figcaption>SEED 掩码与区域（非真值）</figcaption></figure></div><a href="{html.escape(s["mask_file"])}">全尺寸二值掩码</a></section>')
    for sid,api in explanations.items():
        if api.get('status')=='succeeded':
            cards.append('<section><h3>DeepSeek 脱敏摘要解释：'+html.escape(sid)+'</h3><p>未查看原图，生成解释不构成新增鉴伪证据。</p><pre style="white-space:pre-wrap">'+html.escape(json.dumps(api['explanation'],ensure_ascii=False,indent=2))+'</pre></section>')
    page='<!doctype html><meta charset="utf-8"><title>SEED 本地评审</title><style>body{font:16px sans-serif;max-width:1400px;margin:24px auto;background:#f5f7fa}section{padding:16px;background:white;margin:20px 0}section div{display:flex;gap:12px}figure{width:48%;margin:0}img{max-width:100%;max-height:900px}p{line-height:1.6}</style><h1>SEED / DocShield 同样本评审</h1><p>仅本地研究。0=正常，1=篡改；2026-10-22 更正：CORD 发布图存在模糊/遮盖，不能作为未经编辑负例；100/100 是报警率，撤回此前的误报率解释。红色为预测，不是人工真值。无真实 mask，不能计算定位精度。所有原始数据及报告不得当脱敏材料发布。</p>'+''.join(cards)
    (a.run/'index.html').write_text(page)
    print(json.dumps({'complete':report['complete'],'realtext':report['realtext']['confusion'],'cord':report['cord_observational']}))
if __name__=='__main__':main()
