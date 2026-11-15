"""Build a metadata-only research index; never promote research into executable rules."""
import argparse
import json
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--ledger-dir', required=True)
parser.add_argument('--output', required=True)
a = parser.parse_args()
rows = []
for part in ('north', 'east', 'west'):
    ledger = json.loads((Path(a.ledger_dir) / f'{part}-sources.json').read_text())
    for s in ledger['sources']:
        row = {
            'id': f"{part}:{s['id']}", 'province': s['province'],
            'kind': {'government': '政府', 'university': '高校'}.get(s['kind'], s['kind']),
            'title': s['title'], 'url': s['url'],
            'documentDate': s.get('document_date', s.get('issuedDate')),
            'publicationDate': s.get('publication_date'),
            'pagePublicationDate': s.get('page_publication_date'),
            'bodyRead': s['body_read'],
            'verification': s.get('verification', s.get('read_extent', s.get('status'))),
            'scope': s.get('scope_notes', s.get('scope')),
            'validity': s.get('validity', s.get('effective_status')),
            'checkedAt': '2026-10-26', 'autoApplicable': False,
            'chapter': f'national-review-{part}-20261026.md',
        }
        rows.append(row)
assert len({r['id'] for r in rows}) == len(rows)
result = {'schemaVersion': 'national-review-research/1.0', 'checkedAt': '2026-10-26',
          'status': 'research_candidates_not_executable_rules',
          'datePolicy': 'Prioritize 2023 onward. Null dates, old underlying rules, expired annual projects and partial sources cannot become current automatic rules.',
          'summary': {'sources': len(rows), 'bodyRead': sum(r['bodyRead'] for r in rows)},
          'sources': rows}
Path(a.output).write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(result['summary']))
