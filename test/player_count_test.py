import importlib.util
from pathlib import Path
import unittest
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
