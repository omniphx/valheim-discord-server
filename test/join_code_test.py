import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
import subprocess
spec = importlib.util.spec_from_file_location('join_code', Path(__file__).resolve().parents[1] / 'scripts/join-code.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class JoinCodeTest(unittest.TestCase):
    def line(self, code):
        return f'2026-09-10T03:08:26.111642Z Sep 10 03:08:26 supervisord: valheim-server 09/10/2026 03:08:26: Session "Dirty Marty and the boys" with join code {code} and IP 3.16.135.246:2456 is active with 0 player(s)'

    def test_latest_code_preserves_leading_zero(self):
        self.assertEqual(module.session_code(self.line('123456')+'\n'+self.line('012345')), {'joinCode': '012345'})

    def test_restart_invalidates_previous_code(self):
        logs = self.line('123456')+'\nsupervisord: valheim-server Console: Valheim 1.0.7'
        self.assertIsNone(module.session_code(logs))
        self.assertEqual(module.session_code(logs+'\n'+self.line('654321')), {'joinCode': '654321'})

    def test_invalid_and_chat_output_ignored(self):
        for logs in ['', self.line('12345'), self.line('abcdef'), 'Chat: '+self.line('123456')]:
            self.assertIsNone(module.session_code(logs))

    def test_probe_uses_only_current_process_logs(self):
        def fake_run(*args):
            if args[:2] == ('docker', 'top'):
                self.assertEqual(args, ('docker', 'top', 'valheim', '-eo', 'pid,etimes,comm'))
                return 'PID ELAPSED COMMAND\n42 100 valheim_server.\n'
            return 'true'
        with patch.object(module, 'run', side_effect=fake_run), patch.object(module.subprocess, 'run') as log:
            log.return_value.stdout = self.line('123456')
            self.assertEqual(module.join_code(), {'joinCode': '123456'})
            self.assertIn('100s', log.call_args.args[0])

    def test_stopped_game_and_docker_failure_return_unavailable(self):
        with patch.object(module, 'run', return_value='PID ELAPSED COMMAND\n'):
            self.assertIsNone(module.join_code())
        with patch.object(module, 'run', side_effect=subprocess.TimeoutExpired('docker', 4)):
            self.assertIsNone(module.join_code())
