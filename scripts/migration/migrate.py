#!/usr/bin/env python3
"""Prepare, rsync and verify this workstation's complete project handover."""
import argparse
from contextlib import contextmanager
import fnmatch
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import tempfile

REPO = Path(__file__).resolve().parents[2]
BASE = Path('/data/lvjiawen/baselines')
ENVS = ('image-download', 'mirror-runtime', 'docshield-runtime', 'ocr-runtime', 'seed-runtime')
EXCLUDES = ('__pycache__/', '*.pyc', '*.part', '.rsync-partial/', 'node_modules/', '.cache/', '.asset-downloads/')
REPO_EXCLUDES = ('/.env.image-documents.local', '/tmp/server-migration/')
HOST = 'wangruohan@10.69.50.194'
ROOT = '/sdb/data_public/lvjiawen/aigc_platform'


def run(args, **kw):
    return subprocess.run([str(a) for a in args], check=True, **kw)


def asset(source, target, excludes=()):
    return dict(source=str(source), target=target, excludes=list(excludes))


def assets(with_secrets=True):
    result = [asset(REPO, 'project', REPO_EXCLUDES)]
    for name in ('mirror', 'docshield-9b', 'ocr', 'seed'):
        result.append(asset(BASE / name / 'weights', 'weights/' + name))
    for name in ('mirror', 'seed'):
        result.append(asset(BASE / name / 'code', 'third_party/' + name))
    for name in ('hf-info.json', 'metadata-verification.json'):
        result.append(asset(BASE / 'seed' / name, 'metadata/seed/' + name))
    for name in ('RealText-V1-research', 'CORD-v2-research'):
        result.append(asset('/data/aigc/datasets/' + name, 'datasets/documents/' + name))
    result.extend([
        asset('/home/lvjiawen/.agents/skills', 'skills/user'),
        asset('/home/lvjiawen/.codex/skills', 'skills/codex'),
        asset(BASE / 'envs/wheelhouse', 'runtime/wheelhouse'),
        asset('/home/lvjiawen/project/aigc-platform-plan-20261021.rar',
              'planning/aigc-platform-plan-20261021.rar'),
    ])
    for p in sorted(Path('/home/lvjiawen/.codex/plugins/cache/openai-curated-remote').glob('*/*/skills')):
        result.append(asset(p, 'skills/plugins/' + p.parent.parent.name + '/' + p.parent.name + '/skills'))
    if with_secrets:
        result.append(asset(REPO / '.env.image-documents.local', 'project/.env.image-documents.local'))
    return result


def excluded(relative, patterns, directory=False):
    """Mirror our simple rsync exclusions for a local byte count / link audit."""
    text = relative.as_posix()
    for pattern in patterns:
        if pattern.startswith('/'):
            prefix = pattern.strip('/')
            if text == prefix or text.startswith(prefix + '/'):
                return True
        elif pattern.endswith('/'):
            if pattern[:-1] in relative.parts:
                return True
        elif any(fnmatch.fnmatch(part, pattern) for part in relative.parts):
            return True
    return False


def audit_source(entry):
    root = Path(entry['source'])
    if not root.exists() or root.is_symlink():
        raise ValueError('Missing or symlink asset root: ' + str(root))
    if root.is_file():
        return root.stat().st_size, 1
    total = count = 0
    for parent, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if not excluded((Path(parent) / d).relative_to(root), EXCLUDES + tuple(entry['excludes']), True)]
        for name in dirs + files:
            p = Path(parent) / name
            if excluded(p.relative_to(root), EXCLUDES + tuple(entry['excludes'])):
                continue
            if p.is_symlink():
                # Keep portable relative internal links; never leave dependencies outside the bundle.
                if os.path.isabs(os.readlink(p)) or not p.resolve().is_relative_to(root.resolve()) or not p.exists():
                    raise ValueError('Non-portable symlink, explicitly map this asset first: ' + str(p))
            elif p.is_file():
                total += p.stat().st_size
                count += 1
    return total, count


def git_output(*args):
    return run(['git', '-C', REPO, *args], stdout=subprocess.PIPE).stdout.decode().strip()


def prepare(stage, entries, target_root, snapshots=True):
    os.umask(0o077)
    if not (REPO / '.git').is_dir() or (REPO / '.git/objects/info/alternates').exists():
        raise ValueError('Expected standalone Git repository, without external object alternates')
    stage.mkdir(parents=True, exist_ok=True)
    stage.chmod(0o700)
    total = 0
    for e in entries:
        size, count = audit_source(e)
        e.update(bytes=size, files=count)
        total += size
    if any(e['target'].endswith('.env.image-documents.local') for e in entries):
        secret = REPO / '.env.image-documents.local'
        if secret.stat().st_mode & 0o077:
            raise ValueError('Secret file must already have mode 0600; contents were not read')
    state = dict(branch=git_output('branch', '--show-current'), head=git_output('rev-parse', 'HEAD'),
                 status=git_output('status', '--short'), refs=git_output('show-ref'),
                 source_repo=str(REPO), target_root=target_root, assets=entries, bytes=total)
    (stage / 'inventory.json').write_text(json.dumps(state, ensure_ascii=False, indent=2) + '\n')
    # Preserve historic outputs. These mappings are only applied to new replay copies.
    mappings = {str(REPO): target_root + '/project'}
    for e in entries:
        mappings[e['source']] = target_root + '/' + e['target']
    mappings['/home/lvjiawen/work/baselines'] = target_root + '/compat/baselines'
    mappings[str(BASE)] = target_root + '/compat/baselines'
    (stage / 'path-map.json').write_text(json.dumps(mappings, ensure_ascii=False, indent=2) + '\n')
    if snapshots:
        env_dir = stage / 'environments'
        env_dir.mkdir(exist_ok=True)
        code = ('import importlib.metadata as m,json,sys,platform; '
                'print(json.dumps(dict(python=sys.version,platform=platform.platform(),'
                'packages=sorted([dict(name=d.metadata["Name"],version=d.version) '
                'for d in m.distributions()],key=lambda x:x["name"].lower()))))')
        for name in ENVS:
            print('Exporting installed packages:', name, flush=True)
            data = json.loads(run([BASE / 'envs' / name / 'bin/python', '-c', code],
                                  stdout=subprocess.PIPE, timeout=180).stdout)
            # SEED's overlay exposes two transformers distributions; use the first visible one.
            visible = {}
            for p in data['packages']:
                visible.setdefault(re.sub(r'[-_.]+', '-', p['name']).lower(), p)
            if name == 'seed-runtime':
                visible['transformers'] = dict(name='transformers', version='4.56.1')
            lines = []
            for key, p in sorted(visible.items()):
                if not re.fullmatch(r'[A-Za-z0-9_.-]+', p['name']) or not re.fullmatch(r'[A-Za-z0-9_.+!-]+', p['version']):
                    raise ValueError('Unsafe package name/version in snapshot')
                if key not in ('pip', 'setuptools', 'wheel'):
                    lines.append(p['name'] + '==' + p['version'])
            (env_dir / (name + '.json')).write_text(json.dumps(data, indent=2))
            (env_dir / (name + '.txt')).write_text('\n'.join(lines) + '\n')
    for cmd in (['node', '--version'], ['rsync', '--version'], ['openspec', '--version']):
        if shutil.which(cmd[0]):
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
            (stage / (cmd[0] + '-version.txt')).write_text(r.stdout + r.stderr)
    print(f'Payload: {total / 1024**3:.2f} GiB; {len(entries)} mapped assets. No 2.1 raw datasets.')
    return state


def ssh_base(args, master=False):
    base = ['ssh', '-p', str(args.port), '-o', 'StrictHostKeyChecking=ask',
            '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=15',
            '-o', 'ServerAliveCountMax=3', '-o', 'ForwardAgent=no',
            '-o', 'ForwardX11=no', '-o', 'ClearAllForwardings=yes']
    if args.identity:
        base += ['-i', str(Path(args.identity).expanduser())]
    control = getattr(args, 'control_path', None)
    if control:
        base += ['-S', control, '-o', 'ControlMaster=' + ('yes' if master else 'no'),
                 '-o', 'ControlPersist=no']
        if not master:
            # If the master dies, fail instead of prompting once per asset.
            base += ['-o', 'BatchMode=yes']
    return base


@contextmanager
def ssh_session(args):
    """One interactive authentication per invocation, with an owned private socket."""
    # A short path avoids the Unix socket path length limit. No credentials are stored.
    with tempfile.TemporaryDirectory(prefix='aigc-ssh-', dir='/tmp') as directory:
        args.control_path = str(Path(directory) / 'control')
        try:
            print('Opening shared SSH connection (authenticate once for this command).', flush=True)
            run([*ssh_base(args, master=True), '-f', '-N', args.host])
            yield
        finally:
            try:
                # Only close this invocation's master, never another terminal's session.
                subprocess.run([*ssh_base(args), '-O', 'exit', args.host],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                               timeout=10, check=False)
            except (OSError, subprocess.TimeoutExpired):
                pass
            finally:
                del args.control_path


def rsync_command(entry, args, verify=False, dry=False):
    source = Path(entry['source'])
    dest = args.root + '/' + entry['target']
    flags = ['-a', '--no-owner', '--no-group', '--protect-args', '--partial-dir=.rsync-partial']
    if verify:
        flags = ['-rcln', '--protect-args', '--out-format=%i %n', '--exclude=.rsync-partial/']
    elif dry:
        flags += ['--dry-run', '--itemize-changes']
    else:
        flags += ['--info=progress2', '--human-readable']
    if args.bwlimit:
        flags += ['--bwlimit=' + str(args.bwlimit)]
    if entry['target'].endswith('.env.image-documents.local') and not verify:
        flags += ['--chmod=F600']
    for p in EXCLUDES + tuple(entry['excludes']):
        flags += ['--exclude=' + p]
    # No --delete; source directories merge at their explicitly mapped destination.
    if source.is_dir():
        dest += '/'
    return ['rsync', *flags, '-e', shlex.join(ssh_base(args)), '--',
            str(source) + ('/' if source.is_dir() else ''), args.host + ':' + dest]


def remote_prepare(args, entries, size):
    # Remote command is encoded with shlex; never interpolate unchecked shell text.
    marker = json.dumps(dict(source_repo=str(REPO), format=1), sort_keys=True)
    code = r'''
import json,os,pathlib,shutil,sys
root=pathlib.Path(sys.argv[1]); marker=sys.argv[2]; entries=json.loads(sys.argv[3]); size=int(sys.argv[4])
if not shutil.which('rsync'): raise SystemExit('Install rsync on destination first')
for p in [root,*root.parents]:
    if p.is_symlink(): raise SystemExit('Refusing symlink destination')
if root.exists() and any(root.iterdir()):
    f=root/'.migration-owner.json'
    if not f.is_file() or f.read_text()!=marker: raise SystemExit('Target not empty / belongs to another migration')
os.umask(0o077);root.mkdir(parents=True,exist_ok=True);root.chmod(0o700)
existing=0
for parent,dirs,files in os.walk(root):
    dirs[:]=[d for d in dirs if not (pathlib.Path(parent)/d).is_symlink()]
    for name in files:
        f=pathlib.Path(parent)/name
        if f.is_file() and not f.is_symlink(): existing+=f.stat().st_size
if shutil.disk_usage(root).free < max(0,size-existing) + 2*1024**3: raise SystemExit('Insufficient space (remaining payload + 2 GiB reserve)')
for e in entries:
    p=root/e['target']; p=p if e['directory'] else p.parent
    if not p.resolve().is_relative_to(root.resolve()): raise SystemExit('Destination escapes root')
    p.mkdir(parents=True,exist_ok=True)
(root/'.migration-owner.json').write_text(marker)
print('Remote directory private; destination directories ready')
'''
    payload = [dict(target=e['target'], directory=Path(e['source']).is_dir()) for e in entries]
    command = shlex.join(['python3', '-c', code, args.root, marker, json.dumps(payload), str(size)])
    run([*ssh_base(args), args.host, command])


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('action', choices=('plan', 'prepare', 'dry-run', 'transfer', 'verify'))
    p.add_argument('--host', default=HOST)
    p.add_argument('--port', type=int, default=29316)
    p.add_argument('--root', default=ROOT)
    p.add_argument('--identity', help='SSH private key path; key is NOT copied')
    p.add_argument('--bwlimit', type=int, default=0, help='rsync KiB/s, 0 = unlimited')
    p.add_argument('--without-secrets', action='store_true')
    args = p.parse_args()
    if not re.fullmatch(r'[A-Za-z0-9_.-]+@[A-Za-z0-9.-]+', args.host) or not 1 <= args.port <= 65535:
        p.error('Invalid SSH destination')
    if not args.root.startswith('/') or args.root in ('/', '/sdb', '/sdb/data_public') or '..' in Path(args.root).parts:
        p.error('Use an absolute dedicated destination directory')
    args.root = args.root.rstrip('/')
    entries = assets(not args.without_secrets)
    stage = REPO / 'tmp/server-migration/payload'
    if args.action in ('plan', 'prepare', 'transfer'):
        state = prepare(stage, entries, args.root, snapshots=args.action != 'plan')
    else:
        state = json.loads((stage / 'inventory.json').read_text())
        if state['target_root'] != args.root or {e['target'] for e in entries} != {e['target'] for e in state['assets']}:
            p.error('Re-run prepare using the same destination and secret option')
    entries.append(asset(stage, 'migration'))
    if args.action in ('plan', 'prepare'):
        for e in entries:
            print(e['source'], '->', args.root + '/' + e['target'])
        return
    if not shutil.which('rsync'):
        p.error('Install rsync on both servers first')
    with ssh_session(args):
        execute(args, entries, state)


def execute(args, entries, state):
    if args.action == 'transfer':
        remote_prepare(args, entries, state['bytes'])
    # dry-run never creates remote directories. Run prepare locally first; rsync may report
    # missing remote parents until the first transfer has initialized the destination.
    differences = []
    for e in entries:
        print('Verifying' if args.action == 'verify' else 'Syncing', e['target'], flush=True)
        if args.action == 'verify':
            r = run(rsync_command(e, args, verify=True), stdout=subprocess.PIPE, text=True)
            if r.stdout.strip():
                print(r.stdout)
                differences.append(e['target'])
        else:
            run(rsync_command(e, args, dry=args.action == 'dry-run'))
    if differences:
        raise SystemExit('Content differences remain in: ' + ', '.join(differences)
                         + '. Resume transfer and verify again. No files were changed by verify.')
    if args.action == 'transfer':
        command = shlex.join(['python3', args.root + '/project/scripts/migration/target.py', 'init', '--root', args.root])
        run([*ssh_base(args), args.host, command])
        print('Transfer complete. Run verify before bootstrapping target environments.')
    elif args.action == 'verify':
        print('All mapped file contents match (rsync checksum comparison). No files deleted.')


def cli():
    try:
        main()
    except subprocess.CalledProcessError as exc:
        # Do not dump subprocess arguments (remote code, configuration, or future secrets).
        tool = Path(exc.cmd[0]).name
        print(f'{tool} failed (exit {exc.returncode}); migration is NOT complete.', file=sys.stderr)
        if exc.returncode == 255:
            print('SSH connection/authentication failed or the server closed the connection. '
                  'Check the SSH message above; the post-quantum warning alone is not a disconnect reason.',
                  file=sys.stderr)
        print('Transferred files and rsync partial files are retained. After resolving the error, '
              'rerun transfer, then verify only if transfer succeeds. No source files were deleted.',
              file=sys.stderr)
        return exc.returncode if 0 < exc.returncode < 256 else 1
    except KeyboardInterrupt:
        print('Interrupted. Rerun transfer to resume, then verify.', file=sys.stderr)
        return 130
    return 0


if __name__ == '__main__':
    sys.exit(cli())
