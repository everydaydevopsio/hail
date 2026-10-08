"""Runs only inside the filesystem allowlist. Never prints credentials."""
import datetime as dt
import json
import os
from pathlib import Path
import stat
import subprocess
import sys


def session(path):
    p = Path(path)
    info = p.stat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise RuntimeError('Session must be an owned private file')
    value = json.loads(p.read_text())
    expiry = dt.datetime.fromisoformat(value['expiration'].replace('Z', '+00:00'))
    if expiry.timestamp() < dt.datetime.now(dt.timezone.utc).timestamp() + 900:
        raise RuntimeError('Refresh session before starting this phase')
    if not all(isinstance(value.get(k), str) and value[k] for k in ('accessKeyId', 'secretAccessKey', 'sessionToken')):
        raise RuntimeError('Invalid session fields')
    return value


def main():
    role, mode, *command = sys.argv[1:]
    if role not in ('none', 'reader', 'sender', 'provisioner') or not command:
        raise RuntimeError('Invalid isolated phase')
    env = dict(os.environ)
    if role != 'none':
        manifest = json.loads(Path('/hail/manifest.json').read_text())
        value = session('/tmp/session.json')
        env.update(AWS_ACCESS_KEY_ID=value['accessKeyId'], AWS_SECRET_ACCESS_KEY=value['secretAccessKey'], AWS_SESSION_TOKEN=value['sessionToken'])
        identity = json.loads(subprocess.check_output(['aws', 'sts', 'get-caller-identity', '--output', 'json'], env=env, timeout=30))
        prefix = f"arn:aws:sts::{manifest['accountId']}:assumed-role/{manifest['runId']}-{role}/"
        if identity['Account'] != manifest['accountId'] or not identity['Arn'].startswith(prefix):
            raise RuntimeError('Restricted identity mismatch')
        if role == 'provisioner':
            env['CLOUDFLARE_API_TOKEN'] = Path('/tmp/cloudflare-token').read_text()
        if mode == 'live':
            if role != 'reader':
                raise RuntimeError('Live phase requires the reader identity')
            session('/tmp/sender.json')
            env.update(HAIL_LIVE='1', HAIL_CONFIG='/hail/hail-direct.config.json', HAIL_FROM=manifest['sender'], HAIL_SEND_REGION=manifest['region'],
                HAIL_EXPECTED_ACCOUNT=manifest['accountId'], HAIL_READER_ROLE_ARN=f"arn:aws:iam::{manifest['accountId']}:role/{manifest['runId']}-reader",
                HAIL_SENDER_ROLE_ARN=f"arn:aws:iam::{manifest['accountId']}:role/{manifest['runId']}-sender", HAIL_READER_SESSION_FILE='/tmp/session.json',
                HAIL_SENDER_SESSION_FILE='/tmp/sender.json', HAIL_LIVE_RUN_DIR='/hail')
    os.execvpe(command[0], command, env)


if __name__ == '__main__':
    main()
