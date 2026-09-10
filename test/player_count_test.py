import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
spec = importlib.util.spec_from_file_location('player_count', Path(__file__).resolve().parents[1] / 'scripts/player-count.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class PlayerCountTest(unittest.TestCase):
    def line(self, count):
        return f'2026-09-10T02:50:39.097404693Z Sep 10 02:50:39 supervisord: valheim-server 09/10/2026 02:50:39: Session "Test" with join code 123456 and IP 203.0.113.1:2456 is active with {count} player(s)'

    def test_latest_count_including_zero(self):
        result = module.crossplay_count(self.line(3)+'\n'+self.line(0))
        self.assertEqual(result['players'], 0)
        self.assertEqual(result['reportedAt'], '2026-09-10T02:50:39.097404+00:00')

    def test_restart_invalidates_old_count(self):
        logs = self.line(3)+'\nsupervisord: valheim-server Console: Valheim 1.0.7'
        self.assertIsNone(module.crossplay_count(logs))
        self.assertEqual(module.crossplay_count(logs+'\n'+self.line(1))['players'], 1)

    def test_invalid_or_unrelated_output(self):
        self.assertIsNone(module.crossplay_count(''))
        self.assertIsNone(module.crossplay_count(self.line(999)))
        self.assertIsNone(module.crossplay_count(self.line(1).replace('2026-09-10T02:50:39.097404693Z', 'invalid')))
        self.assertIsNone(module.crossplay_count('Chat: '+self.line(3)))

    def test_docker_process_list_requires_pid_column(self):
        def fake_run(*args):
            if args[:2] == ('docker', 'top'):
                self.assertEqual(args, ('docker', 'top', 'valheim', '-eo', 'pid,comm'))
                return 'PID COMMAND\n42 valheim_server.\n'
            if args[-1] == 'CROSSPLAY':
                return 'false'
            return '0'
        with patch.object(module, 'run', side_effect=fake_run):
            self.assertEqual(module.player_count()['players'], 0)
