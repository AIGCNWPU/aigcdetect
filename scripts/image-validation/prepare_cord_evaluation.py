"""Freeze full official CORD test split before OCR, without changing labels."""
import argparse,json
from pathlib import Path
from smoke_ocr import sha256

def main():
    p=argparse.ArgumentParser();p.add_argument('--parquet',type=Path,required=True);p.add_argument('--output-dir',type=Path,required=True);a=p.parse_args()
    import pyarrow.parquet as pq
    if sha256(a.parquet)!='51c65f1788faff392abe2a0b55b023eb23e9be551c509138eaa3a832514224e7':raise ValueError('Publisher hash mismatch')
    a.output_dir.mkdir(parents=True,exist_ok=True)
    if (a.output_dir/'manifest.json').exists():raise FileExistsError('Frozen evaluation already exists')
    rows=pq.read_table(a.parquet).to_pylist(); manifest=[];truth=[]
    assert len(rows)==100
    for i,row in enumerate(rows):
        target=a.output_dir/f'test-{i:03d}.png';target.write_bytes(row['image']['bytes'])
        manifest.append({'sample_id':f'cord-test-{i:03d}','path':str(target.resolve()),'expected_sha256':sha256(target),'dataset':'CORD-v2-official-test'})
        truth.append({'sample_id':manifest[-1]['sample_id'],'annotation':json.loads(row['ground_truth'])})
    protocol={'dataset_revision':'7f0115a4b758a71d6473b8d085751692da2fef98','license':'CC-BY-4.0','n':100,'split':'test','selection':'all_rows_original_order','training_overlap':'unknown','language_scope':'primarily_Indonesian_not_Chinese',
      'metric':'annotated_word_retrievability_with_spatial_overlap','minimum_intersection_over_gt_word_bbox':0.5,'text_normalization':'NFC_whitespace_removed_case_and_punctuation_preserved','matching':'substring_with_alphanumeric_boundaries_in_a_spatially_matching_OCR_region','failed_images':'all_annotated_words_count_as_missed','not_measured':['unannotated_text_precision','semantic_field_extraction_accuracy','Chinese_accuracy','tamper_localization','CER']}
    for name,data in [('manifest',manifest),('ground-truth',truth),('protocol',protocol)]:
        (a.output_dir/f'{name}.json').write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'n':len(rows),'manifest_sha256':sha256(a.output_dir/'manifest.json')}))
if __name__=='__main__':main()
