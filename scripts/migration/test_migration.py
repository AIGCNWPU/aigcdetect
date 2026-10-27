"""Local-only migration regression tests; never connect to SSH or read real keys."""
import json
import io
import os
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import migrate
import target


class MigrationTests(unittest.TestCase):
    def test_path_map_longest_prefix_and_boundary(self):
        mapping = {'/old': '/new', '/old/model': '/weights'}
        self.assertEqual(target.remap({'x': ['/old/model/a', '/old/a', '/older/a', 'text /old/a']}, mapping),
                         {'x': ['/weights/a', '/new/a', '/older/a', 'text /old/a']})

    def test_exclusions_keep_git_untracked_and_reports(self):
        patterns = migrate.EXCLUDES + migrate.REPO_EXCLUDES
        for name in ['tmp/server-migration/payload/a', '.env.image-documents.local', 'a.pth.part', 'node_modules/x']:
            self.assertTrue(migrate.excluded(Path(name), patterns), name)
        for name in ['.git/HEAD', '.agents/skills/x/SKILL.md', 'tmp/image-workspace/reports/x.json', 'untracked.py']:
            self.assertFalse(migrate.excluded(Path(name), patterns), name)

    def test_external_and_absolute_symlinks_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d); (p / 'link').symlink_to('/etc/passwd')
            with self.assertRaises(ValueError):
                migrate.audit_source(migrate.asset(p, 'project'))

    def test_rsync_real_local_copy_preserves_git_secret_and_untracked(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d); src = p / 'source'; src.mkdir(); dst = p / 'target'; dst.mkdir()
            (src / '.git').mkdir(); (src / '.git/HEAD').write_text('ref: refs/heads/ljw/image-general\n')
            (src / 'untracked.py').write_text('print(1)\n')
            (src / 'model.part').write_text('incomplete')
            secret = src / '.env.image-documents.local'; secret.write_text('FAKE_TEST_KEY=example\n'); secret.chmod(0o600)
            args = SimpleNamespace(root=str(dst), host='test@host', port=29316, identity=None, bwlimit=0)
            e = migrate.asset(src, 'project', migrate.REPO_EXCLUDES)
            def local_command(entry, verify=False):
                cmd = migrate.rsync_command(entry, args, verify=verify)
                i = cmd.index('-e'); del cmd[i:i+2]
                cmd[-1] = cmd[-1].split(':', 1)[1]
                return cmd
            subprocess.run(local_command(e), check=True, stdout=subprocess.DEVNULL)
            self.assertEqual((dst / 'project/.git/HEAD').read_text(), (src / '.git/HEAD').read_text())
            self.assertTrue((dst / 'project/untracked.py').exists())
            self.assertFalse((dst / 'project/model.part').exists())
            self.assertFalse((dst / 'project/.env.image-documents.local').exists())
            sec = migrate.asset(secret, 'project/.env.image-documents.local')
            subprocess.run(local_command(sec), check=True, stdout=subprocess.DEVNULL)
            self.assertEqual((dst / 'project/.env.image-documents.local').stat().st_mode & 0o777, 0o600)
            self.assertFalse(subprocess.check_output(local_command(e, True)).strip())
            (dst / 'project/untracked.py').write_text('corrupt')
            self.assertIn(b'untracked.py', subprocess.check_output(local_command(e, True)))
            (dst / 'project/target-only').write_text('keep')
            subprocess.run(local_command(e), check=True, stdout=subprocess.DEVNULL)
            self.assertTrue((dst / 'project/target-only').exists())

    def test_target_paths_stay_inside_and_init_is_repeatable(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            for n in ('project', 'weights/mirror', 'weights/ocr', 'weights/seed', 'weights/docshield-9b', 'third_party/mirror', 'third_party/seed'):
                (root / n).mkdir(parents=True, exist_ok=True)
            target.init(root); target.init(root)
            for link in root.rglob('*'):
                if link.is_symlink():
                    self.assertTrue(link.resolve().is_relative_to(root))
                    self.assertFalse(os.path.isabs(os.readlink(link)))
            with self.assertRaises(ValueError):
                target.inside(root, root / '../outside')

    def test_activation_isolates_system_cuda_and_routes_project_caches(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            target.init(root)
            command = ('export LD_LIBRARY_PATH=/keep/lib:/usr/local/cuda-12.2/lib64::/usr/local/cuda/lib; '
                       'source "$1"; printf "%s\\n" "$LD_LIBRARY_PATH" "$CUDA_CACHE_PATH" "$npm_config_cache"')
            result = subprocess.run(['bash', '-c', command, 'activation-test', str(root / 'runtime/activate.sh')],
                                    check=True, capture_output=True, text=True)
            self.assertEqual(result.stdout.splitlines(), [
                '/keep/lib', str(root / 'runtime/cache/cuda'), str(root / 'runtime/cache/npm')])

    def test_ssh_session_reuses_private_socket_and_cleans_up_on_failure(self):
        args = SimpleNamespace(port=29316, identity=None, host='test@host')
        with patch.object(migrate, 'run') as start, patch.object(migrate.subprocess, 'run') as stop:
            with self.assertRaisesRegex(RuntimeError, 'simulated transfer failure'):
                with migrate.ssh_session(args):
                    socket = Path(args.control_path)
                    self.assertEqual(socket.parent.stat().st_mode & 0o777, 0o700)
                    master = start.call_args.args[0]
                    self.assertIn('ControlMaster=yes', master)
                    self.assertNotIn('BatchMode=yes', master)
                    for _ in range(3):
                        worker = migrate.ssh_base(args)
                        self.assertEqual(worker[worker.index('-S') + 1], str(socket))
                        self.assertIn('BatchMode=yes', worker)
                        self.assertIn('ControlMaster=no', worker)
                        self.assertIn('ServerAliveInterval=15', worker)
                    raise RuntimeError('simulated transfer failure')
            start.assert_called_once()
            self.assertIn('exit', stop.call_args.args[0])
            self.assertFalse(socket.parent.exists())
            self.assertFalse(hasattr(args, 'control_path'))

    def test_failed_master_never_starts_transfer_or_retries_password(self):
        args = SimpleNamespace(port=29316, identity=None, host='test@host')
        with patch.object(migrate, 'run', side_effect=subprocess.CalledProcessError(255, ['ssh'])) as start:
            with patch.object(migrate.subprocess, 'run') as stop:
                with self.assertRaises(subprocess.CalledProcessError):
                    with migrate.ssh_session(args):
                        self.fail('Should not transfer after failed login')
            start.assert_called_once()
            stop.assert_called_once()
            self.assertFalse(hasattr(args, 'control_path'))

    def test_verify_collects_all_asset_differences(self):
        args = SimpleNamespace(action='verify', root='/target', host='test@host', port=29316,
                               identity=None, bwlimit=0)
        entries = [migrate.asset('/missing/source1', 'weights/mirror'),
                   migrate.asset('/missing/source2', 'weights/seed')]
        results = [SimpleNamespace(stdout='<f+++++++++ missing.pth\n'),
                   SimpleNamespace(stdout='<f+++++++++ missing.safetensors\n')]
        with patch.object(migrate, 'run', side_effect=results) as calls:
            with self.assertRaisesRegex(SystemExit, 'weights/mirror, weights/seed'):
                migrate.execute(args, entries, {})
            self.assertEqual(calls.call_count, 2)
            for call in calls.call_args_list:
                self.assertIn('-rcln', call.args[0])
                self.assertNotIn('--delete', call.args[0])

    def test_cli_failure_hides_command_and_reports_resumability(self):
        error = subprocess.CalledProcessError(255, ['rsync', 'DO_NOT_PRINT_ARGUMENT'])
        with patch.object(migrate, 'main', side_effect=error), patch('sys.stderr', new_callable=io.StringIO) as stderr:
            self.assertEqual(migrate.cli(), 255)
            self.assertIn('partial files are retained', stderr.getvalue())
            self.assertNotIn('DO_NOT_PRINT_ARGUMENT', stderr.getvalue())
            self.assertNotIn('Traceback', stderr.getvalue())
        with patch.object(migrate, 'main', side_effect=KeyboardInterrupt), patch('sys.stderr', new_callable=io.StringIO):
            self.assertEqual(migrate.cli(), 130)

    def test_no_raw_general_dataset_sources(self):
        entries = migrate.assets(False)
        sources = [x['source'] for x in entries]
        self.assertFalse(any('GenImage' in s or 'Chameleon' in s for s in sources))
        self.assertTrue(any('RealText-V1' in s for s in sources))
        self.assertTrue(any('CORD-v2' in s for s in sources))


if __name__ == '__main__':
    unittest.main()
