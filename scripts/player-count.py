#!/usr/bin/env python3
"""Read player count without exposing game logs, player identities, or secrets."""
from datetime import datetime, timezone
import json
import re
import subprocess

SESSION = re.compile(r'supervisord: valheim-server \d{2}/\d{2}/\d{4} \d{2}:\d{2}:\d{2}: Session "[^"]+" with join code .* is active with (\d+) player\(s\)\s*$')


def crossplay_count(logs):
    result = None
    for line in logs.splitlines():
        # A game restart inside the same container invalidates its previous count.
        if 'supervisord: valheim-server ' in line and 'Console: Valheim ' in line:
            result = None
        match = SESSION.search(line)
        if not match:
            continue
        try:
            timestamp = re.sub(r'(\.\d{6})\d+', r'\1', line.split()[0])
            reported = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
            if reported.tzinfo is None:
                continue
            count = int(match.group(1))
            if not 0 <= count <= 100:
                continue
        except (ValueError, IndexError):
            continue
        result = {'players': count, 'reportedAt': reported.isoformat(), 'source': 'crossplay'}
    return result


def run(*args):
    return subprocess.run(args, capture_output=True, text=True, timeout=4, check=True).stdout


def player_count():
    try:
        # Never return an old session count while the game process is stopped.
        processes = run('docker', 'top', 'valheim', '-eo', 'comm')
        if not any(line.strip().startswith('valheim_server') for line in processes.splitlines()[1:]):
            return None
        crossplay = run('docker', 'exec', 'valheim', 'printenv', 'CROSSPLAY').strip().lower() == 'true'
        if crossplay:
            logs = subprocess.run(['docker', 'logs', '--timestamps', '--since', '24h', '--tail', '10000', 'valheim'], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=4, check=True).stdout
            return crossplay_count(logs)
        # The image includes python-a2s; Steam mode can query its local game port.
        count = json.loads(run('docker', 'exec', 'valheim', 'python3', '-c', 'import a2s,json; print(json.dumps(a2s.info(("127.0.0.1",2457),timeout=2).player_count))'))
        if type(count) is int and 0 <= count <= 100:
            return {'players': count, 'reportedAt': datetime.now(timezone.utc).isoformat(), 'source': 'steam'}
    except (subprocess.SubprocessError, OSError, ValueError):
        pass
    return None


if __name__ == '__main__':
    print(json.dumps(player_count()))
