import json
import os
from pathlib import Path
import runpy
import subprocess
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'set-password.py'

class PasswordTests(unittest.TestCase):
    def run_script(self, answers, runner):
        with patch('sys.argv', [str(SCRIPT)]), patch('getpass.getpass', side_effect=answers), patch('subprocess.run', side_effect=runner):
            runpy.run_path(str(SCRIPT), run_name='__main__')

    def test_private_file_is_removed_after_success(self):
        paths = []
        def runner(argv, **kwargs):
            path = Path(argv[-1].removeprefix('file://'))
            paths.append(path)
            self.assertEqual(os.stat(path).st_mode & 0o777, 0o600)
            self.assertEqual(json.loads(path.read_text())['Value'], 'example-password')
            self.assertNotIn('example-password', ' '.join(argv))
        self.run_script(['example-password'] * 2, runner)
        self.assertEqual(len(paths), 1)
        self.assertFalse(paths[0].exists())

    def test_private_file_is_removed_after_aws_failure(self):
        paths = []
        def runner(argv, **kwargs):
            paths.append(Path(argv[-1].removeprefix('file://')))
            raise subprocess.CalledProcessError(1, argv)
        with self.assertRaises(subprocess.CalledProcessError):
            self.run_script(['example-password'] * 2, runner)
        self.assertFalse(paths[0].exists())

    def test_bad_password_never_calls_aws(self):
        for answers in [['tiny'], ['has\nnewline'], ['example-password', 'mismatch']]:
            with self.assertRaises(SystemExit):
                self.run_script(answers, lambda *args, **kwargs: self.fail('AWS must not be called'))

if __name__ == '__main__':
    unittest.main()
