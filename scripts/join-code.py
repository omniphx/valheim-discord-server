#!/usr/bin/env python3
"""Read the current crossplay join code without exposing raw game logs."""
import json
import re
import subprocess

SESSION = re.compile(r'^\S+ \w{3}\s+\d+ \d{2}:\d{2}:\d{2} supervisord: valheim-server \d{2}/\d{2}/\d{4} \d{2}:\d{2}:\d{2}: Session "[^"\n]+" with join code ([0-9]{6}) and IP \S+ is active with \d+ player\(s\)\s*$')


def session_code(logs):
    code = None
    for line in logs.splitlines():
        if 'supervisord: valheim-server ' in line and 'Console: Valheim ' in line:
            code = None
        match = SESSION.fullmatch(line)
        if match:
            code = match.group(1)
    return {'joinCode': code} if code else None


def run(*args):
    return subprocess.run(args, capture_output=True, text=True, timeout=4, check=True).stdout


def join_code():
    try:
        # Docker requires a PID column. etimes limits logs to this game process,
        # excluding a prior session after an in-container restart or update.
        processes = run('docker', 'top', 'valheim', '-eo', 'pid,etimes,comm')
        ages = [int(fields[1]) for line in processes.splitlines()[1:]
                if len(fields := line.split()) == 3 and fields[2].startswith('valheim_server')]
        if len(ages) != 1:
            return None
        if run('docker', 'exec', 'valheim', 'printenv', 'CROSSPLAY').strip().lower() != 'true':
            return None
        logs = subprocess.run(['docker', 'logs', '--timestamps', '--since', f'{ages[0]}s', '--tail', '10000', 'valheim'], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=4, check=True).stdout
        return session_code(logs)
    except (subprocess.SubprocessError, OSError, ValueError):
        return None


if __name__ == '__main__':
    print(json.dumps(join_code()))
