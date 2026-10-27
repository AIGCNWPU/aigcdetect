"""Freeze deterministic stratified manifests before inference; never tune thresholds."""
import argparse
import csv
import hashlib
import json
import random
import re
from pathlib import Path

from smoke_ocr import sha256


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--datasets', type=Path, required=True)
    p.add_argument('--output-dir', type=Path, required=True)
    args = p.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    if (args.output_dir / 'protocol.json').exists():
        raise ValueError('Frozen evaluation already exists; do not resample after viewing results')
    rng = random.Random(20261021)
    seen = set()
    prior = Path('tmp/image-workspace/reports/mirror-smoke-manifest.json')
    excluded = {r['path'] for r in json.loads(prior.read_text())} if prior.exists() else set()
    mirror, counts = [], []
    groups = [(p.name, p) for p in sorted((args.datasets / 'GenImage_eval_all8').iterdir()) if p.is_dir()]
    groups.append(('Chameleon', args.datasets / 'Chameleon/test'))
    for name, folder in groups:
        for label in (0, 1):
            files = sorted(p for p in (folder / ('0_real' if label == 0 else '1_fake')).rglob('*')
                           if p.suffix.lower() in {'.jpg', '.jpeg', '.png', '.webp', '.bmp'})
            rng.shuffle(files)
            selected = []
            for path in files:
                if str(path) in excluded:
                    continue
                checksum = sha256(path)
                if checksum in seen:
                    continue
                seen.add(checksum)
                selected.append({'sample_id': f'{name}-{label}-{checksum[:16]}', 'path': str(path),
                    'label': label, 'dataset': name, 'expected_sha256': checksum,
                    'label_source': 'local_directory_convention', 'purpose': 'stratified_baseline',
                    'training_overlap': 'not_fully_audited'})
                if len(selected) == 50:
                    break
            if len(selected) != 50:
                raise ValueError(f'Insufficient unique images: {name}/{label}')
            mirror.extend(selected)
            counts.append({'dataset': name, 'label': label, 'n': len(selected)})
    root = args.datasets / 'RealText-V1-research'
    with (root / 'metadata.csv').open(encoding='utf-8') as f:
        rows = [r for r in csv.DictReader(f) if (root / r['image_file']).is_file()
                and re.search(r'收据|发票|票据|receipt|invoice', r['report_text'], re.I)
                and r['sample_id'] not in {'00c2d4658f6e4aaab784c60f7ea84ddf', 'ffce349d6325459cbbb6815dde59affd'}]
    docs = []
    doc_seen = set()
    for kind, label in [('white', 0), ('black', 1)]:
        choices = sorted((r for r in rows if r['type'] == kind), key=lambda r: r['sample_id'])
        rng.shuffle(choices)
        n = 0
        for row in choices:
            path = root / row['image_file']
            checksum = sha256(path)
            if checksum in doc_seen:
                continue
            doc_seen.add(checksum)
            docs.append({'sample_id': row['sample_id'], 'path': str(path), 'label': label,
                         'expected_sha256': checksum, 'dataset': 'RealText-V1-published-train',
                         'split': row['split'], 'training_overlap': True,
                         'label_source': 'published_metadata_type', 'purpose': 'training_related_diagnostic'})
            n += 1
            if n == 30:
                break
        if n != 30:
            raise ValueError('Not enough document samples for frozen design')
    rng.shuffle(mirror)
    rng.shuffle(docs)
    outputs = {'mirror-manifest.json': mirror, 'document-manifest.json': docs}
    for name, content in outputs.items():
        (args.output_dir / name).write_text(json.dumps(content, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    protocol = {'version': 'scale-evaluation/0.1', 'seed': 20261021, 'threshold': 0.5,
                'threshold_selected_before_inference': True, 'mirror_samples': len(mirror),
                'strata': counts, 'document_samples': len(docs),
                'mirror_training_overlap': 'unknown_not_claimed_independent',
                'document_training_overlap': True, 'document_independent_accuracy_claim_allowed': False,
                'document_scope': 'metadata-keyword-selected_receipts_language_not_assured',
                'dedup': 'SHA256_within_each_cohort', 'excluded_prior_smoke': True,
                'metrics': ['confusion_matrix', 'FPR_FNR_recall', 'Wilson95', 'ROC_AUC_AP_MIRROR',
                            'per_dataset', 'latency', 'parse_failure_and_truncation'],
                'unavailable_metrics': ['document_pixel_IoU_missing_masks', 'OCR_CER_missing_transcripts'],
                'manifests': {k: sha256(args.output_dir / k) for k in outputs}}
    (args.output_dir / 'protocol.json').write_text(json.dumps(protocol, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'mirror': len(mirror), 'documents': len(docs), 'output': str(args.output_dir)}))


if __name__ == '__main__':
    main()
