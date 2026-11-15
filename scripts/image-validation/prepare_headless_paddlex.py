"""Apply the narrow OpenCV package-name compatibility fix in an isolated env."""
import argparse
import hashlib
import importlib.metadata
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    if importlib.metadata.version("paddlex") != "3.7.2":
        raise RuntimeError("Review the compatibility patch for this PaddleX version")
    if importlib.metadata.version("opencv-contrib-python-headless") != "4.10.0.84":
        raise RuntimeError("Expected OpenCV headless 4.10.0.84")
    distribution = importlib.metadata.distribution("paddlex")
    path = Path(distribution.locate_file("paddlex/utils/deps.py"))
    original = path.read_text()
    before = '''    except importlib.metadata.PackageNotFoundError:
        return None


@lru_cache()
def is_dep_available'''
    after = '''    except importlib.metadata.PackageNotFoundError:
        # image-validation: recognize the API-compatible headless distribution.
        if dep == "opencv-contrib-python":
            try:
                return importlib.metadata.version("opencv-contrib-python-headless")
            except importlib.metadata.PackageNotFoundError:
                pass
        return None


@lru_cache()
def is_dep_available'''
    if after in original:
        print("Compatibility patch already applied")
        return
    if original.count(before) != 1:
        raise RuntimeError("Unexpected upstream source; refusing to patch")
    patched = original.replace(before, after)
    path.write_text(patched)
    report = {"package": "paddlex", "version": "3.7.2", "path": str(path),
              "purpose": "recognize_same_version_headless_opencv",
              "before_sha256": hashlib.sha256(original.encode()).hexdigest(),
              "after_sha256": hashlib.sha256(patched.encode()).hexdigest()}
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2) + "\n")
    print("Applied package-name compatibility fix; all dependency checks remain active")


if __name__ == "__main__":
    main()
