"""Audit published RealText files against its metadata, without inventing labels."""
import argparse
import csv
import json
from collections import Counter
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--metadata", type=Path, required=True,
                        help="Official HF repo API snapshot")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    published = json.loads(args.metadata.read_text(encoding="utf-8"))
    if published.get("id") != "vankey/RealText-V1":
        raise ValueError("Wrong dataset metadata")
    names = {item["rfilename"] for item in published["siblings"]}
    with (args.root / "metadata.csv").open(newline="", encoding="utf-8") as stream:
        rows = list(csv.DictReader(stream))
    missing = {}
    for key in ("image_file", "mask_file", "report_file"):
        missing[key] = {
            "not_published": sum(bool(row[key]) and row[key] not in names for row in rows),
            "not_local": sum(bool(row[key]) and not (args.root / row[key]).is_file()
                             for row in rows),
        }
    available = [row for row in rows if row["image_file"] in names
                 and (args.root / row["image_file"]).is_file()]
    report = {
        "repo": published["id"], "revision": published["sha"],
        "license": "CC-BY-NC-4.0", "usage": "internal_research_only_no_platform_distribution",
        "metadata_rows": len(rows), "published_files": len(names),
        "declared_splits": dict(Counter(row["split"] for row in rows)),
        "declared_labels": dict(Counter(row["type"] or "unlabelled" for row in rows)),
        "missing_references": missing, "available_images": len(available),
        "available_splits": dict(Counter(row["split"] for row in available)),
        "available_labels": dict(Counter(row["type"] or "unlabelled" for row in available)),
        "limitations": [
            "DocShield training source: no independent generalization claim",
            "Chinese report language does not establish Chinese text in the image",
            "Missing masks cannot be reconstructed as ground truth from generated reports",
            "Absent/unlabelled test files cannot support supervised test metrics",
        ],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
