#!/usr/bin/env python3
"""Store a game password without putting it in argv, shell history, or Terraform state."""
import argparse
import getpass
import json
import subprocess
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--profile', default='personal')
parser.add_argument('--region', default='us-east-2')
parser.add_argument('--name', default='/valheim/server-password')
args = parser.parse_args()
password = getpass.getpass('Valheim password (at least 5 characters): ')
if len(password) < 5 or '\n' in password or '\r' in password:
    raise SystemExit('Password must be at least five characters with no newlines.')
if password != getpass.getpass('Confirm password: '):
    raise SystemExit('Passwords did not match.')
# A mode-0600 temporary file avoids both argv exposure and CLI stdin rereads.
with tempfile.NamedTemporaryFile(mode='w+', prefix='valheim-password-', suffix='.json') as payload_file:
    json.dump({'Name': args.name, 'Value': password, 'Type': 'SecureString', 'Overwrite': True}, payload_file)
    payload_file.flush()
    subprocess.run(['aws', 'ssm', 'put-parameter', '--profile', args.profile, '--region', args.region,
                    '--cli-input-json', 'file://' + payload_file.name], check=True)
