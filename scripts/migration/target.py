#!/usr/bin/env python3
"""Target-local initialization, environment rebuild, and explicit JSON path relocation."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess

ENVS = ('image-download', 'mirror-runtime', 'docshield-runtime', 'ocr-runtime', 'seed-runtime')


def inside(root, path):
    p = Path(path).absolute()
    if not p.resolve().is_relative_to(root.resolve()):
        raise ValueError('Path must remain inside migration root: ' + str(p))
    return p


def remap(value, mappings):
    if isinstance(value, str):
        for old, new in sorted(mappings.items(), key=lambda p: -len(p[0])):
            if value == old or value.startswith(old + '/'):
                return new + value[len(old):]
        return value
    if isinstance(value, list):
        return [remap(v, mappings) for v in value]
    if isinstance(value, dict):
        return {k: remap(v, mappings) for k, v in value.items()}
    return value


def init(root):
    os.umask(0o077)
    for name in ('runtime/envs', 'runtime/cache', 'runtime/tmp', 'runtime/replay', 'datasets/documents', 'compat/baselines'):
        inside(root, root / name).mkdir(parents=True, exist_ok=True)
    links = {'envs': root / 'runtime/envs'}
    for name in ('mirror', 'docshield-9b', 'ocr', 'seed'):
        parent = root / 'compat/baselines' / name
        inside(root, parent).mkdir(exist_ok=True)
        links[name + '/weights'] = root / 'weights' / name
    for name in ('mirror', 'seed'):
        links[name + '/code'] = root / 'third_party' / name
    for name, dest in links.items():
        link = root / 'compat/baselines' / name
        if link.is_symlink() and link.resolve() == dest.resolve():
            continue
        if link.exists() or link.is_symlink():
            raise ValueError('Refusing to overwrite compatibility path: ' + str(link))
        link.symlink_to(os.path.relpath(dest, link.parent), target_is_directory=True)
    for name, relative in {
        'CrossCred': 'dataset-search-20261022/crosscred',
        'FCTM-samples': 'dataset-search-20261022/fctm-samples',
        'chinese-validation-v1': 'chinese-validation-v1',
        'pdf-evaluation': 'evaluation-20261021',
    }.items():
        dest = root / 'project/tmp/image-workspace' / relative
        link = root / 'datasets/documents' / name
        if not dest.exists():
            continue
        if link.is_symlink() and link.resolve() == dest.resolve():
            continue
        if link.exists() or link.is_symlink():
            raise ValueError('Refusing to overwrite dataset alias: ' + str(link))
        link.symlink_to(os.path.relpath(dest, link.parent), target_is_directory=True)
    # Keep repository's six canonical skills unchanged. Other user skills stay in
    # skills/user until the explicit skills action after transfer checksum verification.
    secret = root / 'project/.env.image-documents.local'
    if secret.exists():
        inside(root, secret).chmod(0o600)
    script = '''# Source this file in bash; all writable caches remain inside this bundle.
export AIGC_PLATFORM_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
export HF_HOME="$AIGC_PLATFORM_ROOT/runtime/cache/huggingface"
export XDG_CACHE_HOME="$AIGC_PLATFORM_ROOT/runtime/cache"
export PADDLE_HOME="$AIGC_PLATFORM_ROOT/runtime/cache/paddle"
export PADDLE_PDX_CACHE_HOME="$AIGC_PLATFORM_ROOT/runtime/cache/paddlex"
export PIP_CACHE_DIR="$AIGC_PLATFORM_ROOT/runtime/cache/pip"
export npm_config_cache="$AIGC_PLATFORM_ROOT/runtime/cache/npm"
export UV_CACHE_DIR="$AIGC_PLATFORM_ROOT/runtime/cache/uv"
export UV_PYTHON_INSTALL_DIR="$AIGC_PLATFORM_ROOT/runtime/tools/python"
export TORCH_HOME="$AIGC_PLATFORM_ROOT/runtime/cache/torch"
export TRITON_CACHE_DIR="$AIGC_PLATFORM_ROOT/runtime/cache/triton"
export CUDA_CACHE_PATH="$AIGC_PLATFORM_ROOT/runtime/cache/cuda"
export MPLCONFIGDIR="$AIGC_PLATFORM_ROOT/runtime/cache/matplotlib"
export TMPDIR="$AIGC_PLATFORM_ROOT/runtime/tmp"
# Let each isolated wheel environment resolve its own CUDA runtime. Preserve
# unrelated library directories; an inherited system CUDA can shadow nvJitLink.
IFS=: read -r -a aigc_library_entries <<< "${LD_LIBRARY_PATH-}"
aigc_library_path=""
for aigc_library_entry in "${aigc_library_entries[@]}"; do
    case "$aigc_library_entry" in
        ""|/usr/local/cuda*/lib|/usr/local/cuda*/lib64) ;;
        *) aigc_library_path="${aigc_library_path:+$aigc_library_path:}$aigc_library_entry" ;;
    esac
done
export LD_LIBRARY_PATH="$aigc_library_path"
unset aigc_library_entries aigc_library_entry aigc_library_path
if [ -d "$AIGC_PLATFORM_ROOT/runtime/tools/openspec/node_modules/.bin" ]; then
    export PATH="$AIGC_PLATFORM_ROOT/runtime/tools/openspec/node_modules/.bin:$PATH"
fi
for aigc_python_bin in "$UV_PYTHON_INSTALL_DIR"/cpython-3.10.*-linux-x86_64-gnu/bin; do
    if [ -x "$aigc_python_bin/python3.10" ]; then
        export PATH="$aigc_python_bin:$PATH"
        break
    fi
done
unset aigc_python_bin
export MIRROR_WEIGHTS="$AIGC_PLATFORM_ROOT/weights/mirror"
export DOCSHIELD_WEIGHTS="$AIGC_PLATFORM_ROOT/weights/docshield-9b"
export OCR_WEIGHTS="$AIGC_PLATFORM_ROOT/weights/ocr"
export SEED_WEIGHTS="$AIGC_PLATFORM_ROOT/weights/seed"
export HF_ENDPOINT="https://hf-mirror.com"
'''
    (root / 'runtime/activate.sh').write_text(script)
    print('Initialized target-local caches, paths and compatibility links. No model/API executed.')


def bootstrap(root, name, python, offline):
    env = root / 'runtime/envs' / name
    inside(root, env)
    version = subprocess.check_output([python, '-c', 'import sys;print("%s.%s" % sys.version_info[:2])'], text=True).strip()
    if version != '3.10':
        raise ValueError('Snapshots and local torch wheels require Python 3.10; received ' + version)
    if not env.exists():
        subprocess.run([python, '-m', 'venv', str(env)], check=True)
    if not (env / 'pyvenv.cfg').exists():
        raise ValueError('Not a migration venv: ' + str(env))
    proc_env = os.environ.copy()
    proc_env.update(PIP_CACHE_DIR=str(root / 'runtime/cache/pip'), TMPDIR=str(root / 'runtime/tmp'),
                    XDG_CACHE_HOME=str(root / 'runtime/cache'), HF_HOME=str(root / 'runtime/cache/huggingface'),
                    PADDLE_HOME=str(root / 'runtime/cache/paddle'), PADDLE_PDX_CACHE_HOME=str(root / 'runtime/cache/paddlex'),
                    PIP_DISABLE_PIP_VERSION_CHECK='1')
    # Select compatible wheels using the target interpreter's pip, including
    # Python/platform tags and PEP 440 CUDA local versions. Install only pinned
    # local matches first; the full resolver and pip check below remain required.
    select_local = '''import json, sys
from pathlib import Path
from pip._vendor.packaging.requirements import Requirement
from pip._vendor.packaging.tags import sys_tags
from pip._vendor.packaging.utils import canonicalize_name, parse_wheel_filename
tags = set(sys_tags())
wheels = []
for path in Path(sys.argv[1]).glob('*.whl'):
    name, version, _, wheel_tags = parse_wheel_filename(path.name)
    if wheel_tags & tags:
        wheels.append((name, version))
matches = []
for line in Path(sys.argv[2]).read_text().splitlines():
    if not line.strip() or line.lstrip().startswith('#'):
        continue
    req = Requirement(line)
    if req.url or (req.marker and not req.marker.evaluate()):
        continue
    if any(name == canonicalize_name(req.name) and version in req.specifier for name, version in wheels):
        matches.append(line)
print(json.dumps(matches))
'''
    local = json.loads(subprocess.check_output([str(env / 'bin/python'), '-c', select_local,
        str(root / 'runtime/wheelhouse'), str(root / 'migration/environments' / (name + '.txt'))],
        text=True, env=proc_env))
    if local:
        print('Installing', len(local), 'snapshot requirements from compatible local wheels', flush=True)
        subprocess.run([str(env / 'bin/python'), '-m', 'pip', 'install', '--no-index', '--no-deps',
                        '--find-links', str(root / 'runtime/wheelhouse'), *local], check=True, env=proc_env)
    opts = ['--find-links', str(root / 'runtime/wheelhouse')]
    opts += ['--no-index'] if offline else ['--extra-index-url', 'https://download.pytorch.org/whl/cu124']
    subprocess.run([str(env / 'bin/python'), '-m', 'pip', 'install', *opts,
                    '-r', str(root / 'migration/environments' / (name + '.txt'))], check=True, env=proc_env)
    if name == 'ocr-runtime':
        # PaddleX extras can reinstall GUI OpenCV alongside the frozen headless
        # package. They share cv2 files, so removal must be followed by restoring
        # the exact headless wheel before applying the package-name compatibility.
        gui = json.loads(subprocess.check_output([str(env / 'bin/python'), '-c',
            'import importlib.metadata as m,json; '
            'print(json.dumps([d.metadata["Name"] for d in m.distributions() '
            'if d.metadata["Name"].lower().replace("_","-") '
            'in ("opencv-python","opencv-contrib-python")]))'], text=True, env=proc_env))
        if gui:
            subprocess.run([str(env / 'bin/python'), '-m', 'pip', 'uninstall', '-y', *gui],
                           check=True, env=proc_env)
            subprocess.run([str(env / 'bin/python'), '-m', 'pip', 'install', *opts,
                            '--force-reinstall', '--no-deps', 'opencv-contrib-python-headless==4.10.0.84'],
                           check=True, env=proc_env)
        subprocess.run([str(env / 'bin/python'), str(root / 'project/scripts/image-validation/prepare_headless_paddlex.py'),
                        '--report', str(root / 'runtime/ocr-headless-compatibility.json')], check=True, env=proc_env)
    subprocess.run([str(env / 'bin/python'), '-m', 'pip', 'check'], check=True, env=proc_env)
    print('Environment installed:', name, '(GPU inference still requires verification)')


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('action', choices=('init', 'skills', 'bootstrap', 'remap'))
    p.add_argument('--root', type=Path, required=True)
    p.add_argument('--env', choices=ENVS)
    p.add_argument('--python', default='python3.10')
    p.add_argument('--offline', action='store_true')
    p.add_argument('--input', type=Path)
    p.add_argument('--output', type=Path)
    a = p.parse_args()
    root = a.root.absolute()
    if not (root / '.migration-owner.json').is_file():
        p.error('Missing migration owner marker; wrong target root')
    if a.action == 'init':
        init(root)
    elif a.action == 'bootstrap':
        if not a.env:
            p.error('--env required; rebuild environments individually')
        bootstrap(root, a.env, a.python, a.offline)
    elif a.action == 'skills':
        dest = inside(root, root / 'project/.agents/skills')
        for source in sorted((root / 'skills/user').glob('openspec-*')):
            link = dest / source.name
            if link.exists() or link.is_symlink():
                continue
            inside(root, source)
            link.symlink_to(os.path.relpath(source, dest), target_is_directory=True)
        print('Added only missing OpenSpec skills; repository skill versions retained.')
    else:
        if not a.input or not a.output:
            p.error('--input and --output required')
        src, dest = inside(root, a.input), inside(root, a.output)
        if dest.exists():
            p.error('Output exists; historic evidence will not be overwritten')
        mapping = json.loads((root / 'migration/path-map.json').read_text())
        data = json.loads(src.read_text())
        dest.parent.mkdir(parents=True, exist_ok=True)
        with dest.open('x') as f:
            json.dump(remap(data, mapping), f, ensure_ascii=False, indent=2)
        print('Created replay copy:', dest)
        print('Original SHA256:', hashlib.sha256(src.read_bytes()).hexdigest())
        print('Historical report hashes remain historical. Re-run inference for new evidence chains.')


if __name__ == '__main__':
    main()
