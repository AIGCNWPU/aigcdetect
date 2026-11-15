"""Pair existing frozen SEED/DocShield results and local rectangle audit; no inference."""
import argparse,csv,hashlib,html,json,re
from pathlib import Path
from evaluate_results import prediction,summarize

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--workspace',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args();w=a.workspace
 sources={'seed':w/'seed-evaluation-20261021/run-upstream4561/results.json','docshield':w/'evaluation-20261021/docshield-results.json','localization':w/'seed-localization-review-20261022/audit.json'}
 runs={k:json.loads(v.read_text()) for k,v in sources.items()};old=runs['docshield']['samples'];seed={x['sample_id']:x for x in runs['seed']['samples']};loc={x['sample_id']:x for x in runs['localization']['samples']};pairs=[];seed_same=[]
 for row in old:
  s=seed[row['sample_id']];assert row['input_sha256']==s['input_sha256'] and row['label']==s['label']
  seed_same.append(dict(s,generated_score=s['detector_score']))
  boxes=[json.loads(b) for b in re.findall(r'\[GROUNDING\]\s*:\s*(\[[^\]]+\])',row['raw_output'])];ww,hh=row['oriented_size']
  invalid=sum(not (0<=b[0]<b[2]<=ww and 0<=b[1]<b[3]<=hh) for b in boxes)
  l=loc.get(row['sample_id']);pairs.append({'sample_id':row['sample_id'],'label':row['label'],'input_sha256':row['input_sha256'],'seed':prediction(seed_same[-1],'mirror'),'docshield':prediction(row,'docshield'),'docshield_truncated':row.get('token_limit_reached',False),'docshield_raw_box_count':len(boxes),'docshield_boxes_invalid_if_original_pixels':invalid,'seed_region_count':s['region_count'],'localization_number':l['number'] if l else None,'reference_count':len(l['references']) if l else None,'seed_reference_matches_iou05':len(l['matches']['0.5']) if l else None,'seed_reference_disjoint_boxes':len(l['predictions_with_no_reference_overlap']) if l else None})
 fn=[r for r in pairs if r['label']==1 and r['docshield']==0]
 summary={'same_input_count':len(pairs),'seed':summarize(seed_same,'mirror'),'docshield':summarize(old,'docshield'),'seed_localization':runs['localization']['summary'],'seed_on_9b_false_negatives':{'images':len(fn),'images_with_reference_match':sum(r['seed_reference_matches_iou05']>0 for r in fn),'reference_matches':sum(r['seed_reference_matches_iou05'] for r in fn),'references':sum(r['reference_count'] for r in fn)},'additional_seed_false_positives':sum(r['label']==0 and r['docshield']==0 and r['seed']==1 for r in pairs),'docshield_tampered_images_without_boxes':sum(r['label']==1 and r['docshield_raw_box_count']==0 for r in pairs)}
 report={'date':'2026-10-22','new_inference':False,'source_sha256':{k:hashlib.sha256(v.read_bytes()).hexdigest() for k,v in sources.items()},'summary':summary,'pairs':pairs,'limitations':['Training-related research samples, not independent benchmark','Publisher rectangles are unverified and may be incomplete','DocShield coordinate space uncalibrated: no localization precision/IoU ranking','No paired DocShield CORD run: CORD SEED results not used for head-to-head ranking','Native SEED tiling and DocShield whole-image resizing differ; compares current configured pipelines']}
 a.output.mkdir(parents=True,exist_ok=False);(a.output/'comparison.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
 with (a.output/'comparison.csv').open('w') as f:
  writer=csv.DictWriter(f,fieldnames=list(pairs[0]));writer.writeheader();writer.writerows(pairs)
 esc=html.escape
 page='''<!doctype html><meta charset="utf-8"><title>SEED 与 DocShield-9B 同样本对照</title><style>body{font:16px/1.7 system-ui;max-width:1200px;margin:35px auto;padding:20px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccd;padding:8px}pre{white-space:pre-wrap;overflow-wrap:anywhere}details{margin:18px 0}</style><h1>SEED 与 DocShield-9B：当前配置同样本对照</h1><p>2026-10-22。复核既有固定输出，逐项核对输入哈希；不重跑、不调阈值。</p><p><strong>对“接受高误报，优先找出可疑修改区域”的目标，当前配置下 SEED 更适合作主定位器。9B 的正常图误报更少，但大量漏检，坐标尚不可直接作为可靠定位。</strong></p><table><tr><th>同一批60张（30正常/30篡改）</th><th>SEED</th><th>DocShield-9B</th></tr><tr><td>篡改标签图检出</td><td>30/30</td><td>12/30</td></tr><tr><td>篡改标签图漏检</td><td>0</td><td>16，另2张输出截断</td></tr><tr><td>正常标签图误报</td><td>13/30（43.3%）</td><td>2/30（6.7%）</td></tr><tr><td>全部输入正确判断占比</td><td>47/60（78.3%）</td><td>40/60（66.7%；含2张无有效结论）</td></tr><tr><td>仅有效输出准确率</td><td>47/60（78.3%）</td><td>40/58（69.0%）</td></tr></table><p>9B漏检的16张，SEED每张至少有一个框与参考较好重合，合计62/80个参考区域达到IoU≥0.5。SEED补回16张漏检与2张截断，但比9B增加11张正常图误报；两者共有2张误报。若用9B的真假判断强行过滤SEED告警，会重新丢掉这些漏检图。</p><p>SEED的30张定位复核：162个参考框中116个达到IoU≥0.5；11张全部参考匹配，其中5张无多余框；260个预测框中125个不与任何参考框相交。不能把30/30报警当作30/30定位正确。</p><p>9B在30张篡改图中16张根本没有输出区域框；其余14张（含2张截断）共输出52个框，24个按原图像素解释无效。由于坐标空间未校准，没有猜测缩放比例，也没有给9B编造定位准确率，无法严谨地声称SEED的定位IoU一定更高。</p><p>解释能力：9B能输出自然语言，但存在无依据历史值。例如第4张声称支付方式从CREDIT改成CASH，第27张声称Tea被改成Coffee，现有输入并不能证明这些修改历史；第23张虽能指出0.828相关算术矛盾，但给出的坐标尚未校准。因此语言解释可作复核线索，不能代替可靠框选。SEED本身不生成文字理由。</p><p>边界：训练相关研究样本；发布方参考框并非独立真值。SEED分块处理与9B整图缩放不同，本结论比较当前接入配置，并非模型理论能力排名。2026-10-22更正：SEED在100张CORD发布图全部报警，但图片含可见模糊/遮盖，没有鉴伪真值，不能计为100%误报；也没有同批9B结果，不用于两模型对照。</p><p><a href="comparison.json">完整对照JSON</a> · <a href="comparison.csv">同60张逐图CSV</a> · <a href="../seed-localization-review-20261022/index.html">SEED逐图定位复核</a></p><h2>30张篡改标签图逐项对照</h2><table><tr><th>复核编号</th><th>9B判断</th><th>9B原始框/按原图无效框</th><th>SEED参考匹配/参考数</th><th>SEED参考外框</th></tr>'''
 labels={None:'无有效结论（截断）',0:'真实（漏检）',1:'伪造'}
 for r in pairs:
  if r['label']!=1:continue
  n=r['localization_number'];page+=f'<tr><td><a href="../seed-localization-review-20261022/index.html#sample-{n}">{n:02d} {r["sample_id"][:8]}</a></td><td>{labels[r["docshield"]]}</td><td>{r["docshield_raw_box_count"]}/{r["docshield_boxes_invalid_if_original_pixels"]}</td><td>{r["seed_reference_matches_iou05"]}/{r["reference_count"]}</td><td>{r["seed_reference_disjoint_boxes"]}</td></tr>'
 page+='</table><h2>9B原始输出（未经核实）</h2>'
 for r in old:
  if r['label']==1:page+='<details><summary>'+esc(r['sample_id'])+'</summary><pre>'+esc(r['raw_output'])+'</pre></details>'
 (a.output/'index.html').write_text(page);print(json.dumps({'paired':len(pairs),'9b_false_negative_localization':summary['seed_on_9b_false_negatives'],'additional_seed_false_positives':summary['additional_seed_false_positives']},ensure_ascii=False))
if __name__=='__main__':main()
