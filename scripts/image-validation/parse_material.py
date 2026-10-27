"""Prepare a real material locally; JSON output never implies a detection verdict."""
import argparse
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'src/modules/image/documents/python'))
from material_parser import MaterialLimits, parse_material


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', required=True, type=Path)
    parser.add_argument('--output-dir', required=True, type=Path)
    parser.add_argument('--material-id')
    parser.add_argument('--render-docx', action='store_true', help='Opt in to vetted DOCX local LibreOffice rendering')
    parser.add_argument('--max-pages', type=int, default=50)
    parser.add_argument('--timeout', type=float, default=120)
    parser.add_argument('--dpi', type=int, default=144)
    args = parser.parse_args()
    report = parse_material(args.input, args.output_dir,
        MaterialLimits(max_pages=args.max_pages, timeout_seconds=args.timeout, dpi=args.dpi),
        material_id=args.material_id, render_docx=args.render_docx)
    print(json.dumps({'status': report['status'], 'manifest': str(args.output_dir.resolve() / 'material.json')}))
    return 1 if report['status'] == 'failed' else 0


if __name__ == '__main__':
    raise SystemExit(main())
