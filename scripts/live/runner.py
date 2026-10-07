"""Orchestrate local proof, restricted live phases, and recoverable teardown.

Only bootstrap() and source_aws() use the source profile. Everything else runs
in a filesystem allowlist sandbox without the host credential chain.
"""
import argparse
import datetime as dt
import hashlib
import fcntl
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import signal
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.parse
import urllib.request

REPO = Path(__file__).resolve().parents[2]
ROLES = ('provisioner', 'reader', 'sender', 'indexer')
ROOTS = ('bootstrap', 'modules/receiver', 'examples/cloudflare', 'examples/route53', 'examples/manual')
RECEIVER_TYPES = {'aws_ses_domain_identity_verification', 'cloudflare_dns_record', 'terraform_data',
    'aws_cloudwatch_log_group', 'aws_lambda_event_source_mapping', 'aws_lambda_function',
    'aws_s3_bucket', 'aws_s3_bucket_lifecycle_configuration', 'aws_s3_bucket_policy',
    'aws_s3_bucket_public_access_block', 'aws_s3_bucket_server_side_encryption_configuration',
    'aws_ses_active_receipt_rule_set', 'aws_ses_domain_identity', 'aws_ses_receipt_rule',
    'aws_ses_receipt_rule_set', 'aws_sns_topic', 'aws_sns_topic_policy',
    'aws_sns_topic_subscription', 'aws_sqs_queue', 'aws_sqs_queue_policy'}
CONFIG_KEYS = {'accountId', 'region', 'zoneName', 'zoneId', 'bootstrapProfile', 'sourcePrincipalArn', 'owner'}

class RunError(Exception):
    """Messages are fixed labels; never include subprocess output or credentials."""


def require(condition, message):
    if not condition:
        raise RunError(message)


def write_json(path, value):
    path = Path(path)
    temporary = path.with_suffix(path.suffix + '.tmp')
    with open(temporary, 'w', opener=lambda p, f: os.open(p, f, 0o600)) as out:
        json.dump(value, out, indent=2)
        out.write('\n')
    os.replace(temporary, path)


def read_config(path):
    data = json.loads(Path(path).read_text())
    require(isinstance(data, dict) and set(data) == CONFIG_KEYS, 'Config must contain exactly the documented nonsecret fields')
    require(all(isinstance(v, str) and v and not any(c in v for c in '\r\n\x00') for v in data.values()), 'Invalid config values')
    require(bool(re.fullmatch(r'\d{12}', data['accountId'])), 'Invalid AWS account ID')
    require(bool(re.fullmatch(r'[a-z]{2}-[a-z]+-\d', data['region'])), 'Invalid AWS region')
    require(bool(re.fullmatch(r'[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?', data['zoneName'])) and '.' in data['zoneName'] and '..' not in data['zoneName'], 'Invalid zone name')
    require(bool(re.fullmatch(r'[a-f0-9]{32}', data['zoneId'])), 'Invalid Cloudflare zone ID')
    require(bool(re.fullmatch(r'arn:aws:iam::' + data['accountId'] + r':(?:user|role)/[A-Za-z0-9_+=,.@/-]+', data['sourcePrincipalArn'])), 'An exact approved IAM user or role ARN is required')
    require(len(data['owner']) <= 128, 'Owner tag is too long')
    return data


def cloudflare_token(env):
    token, alias = env.get('CLOUDFLARE_API_TOKEN'), env.get('CLOUDFLARE_API_KEY')
    require(not (token and alias and token != alias), 'Conflicting Cloudflare credentials; set only one variable')
    value = token or alias
    require(bool(value) and not any(c in value for c in '\r\n\x00'), 'Set CLOUDFLARE_API_TOKEN (or bearer-token alias CLOUDFLARE_API_KEY)')
    return value


def private_directory(path):
    info = Path(path).lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid() and not info.st_mode & 0o077, 'Run directory must be owned by this user, mode 0700, and not a symlink')


def clean_env(home, path=None):
    return {'PATH': path or '/usr/local/bin:/usr/bin:/bin', 'HOME': str(home),
            'AWS_CONFIG_FILE': '/dev/null', 'AWS_SHARED_CREDENTIALS_FILE': '/dev/null',
            'AWS_EC2_METADATA_DISABLED': 'true', 'AWS_PAGER': '', 'LC_ALL': 'C.UTF-8'}


def managed_resources(state):
    return [r for r in state.get('resources', []) if r.get('mode') == 'managed']


def check_plan(plan, kind, action, manifest):
    """Reject unexpected mutations before every apply, including destroy."""
    require(not plan.get('errored') and plan.get('applyable', True), 'Terraform plan is not applyable')
    changes = [r for r in plan.get('resource_changes', []) if r.get('mode') == 'managed' and r['change']['actions'] != ['no-op']]
    allowed = {'aws_iam_role', 'aws_iam_policy', 'aws_iam_role_policy_attachment', 'terraform_data'} if kind == 'bootstrap' else RECEIVER_TYPES
    require(bool(changes), 'Expected a nonempty resource plan')
    for resource in changes:
        change = resource['change']
        require(resource['type'] in allowed and change['actions'] == [action], 'Plan contains an unexpected resource type or action')
        value = change['after' if action == 'create' else 'before']
        if resource['type'] in {'aws_iam_role', 'aws_iam_policy'}:
            require(value['name'] in [manifest['runId'] + '-' + role for role in ROLES], 'Plan names an unowned IAM resource')
            if resource['type'] == 'aws_iam_role':
                require(value['permissions_boundary'] == 'arn:aws:iam::' + manifest['accountId'] + ':policy/' + value['name'], 'Run role is missing its exact boundary')
        if resource['type'] == 'aws_iam_role_policy_attachment':
            require(value['role'] in [manifest['runId'] + '-' + role for role in ROLES], 'Unowned role attachment')
            expected = 'arn:aws:iam::' + manifest['accountId'] + ':policy/' + value['role']
            if action == 'create' and change.get('after_unknown', {}).get('policy_arn') is True:
                role = value['role'][len(manifest['runId']) + 1:]
                address = 'aws_iam_policy.' + role
                configured = next((r for r in plan.get('configuration', {}).get('root_module', {}).get('resources', [])
                                   if r['address'] == resource['address']), {})
                references = configured.get('expressions', {}).get('policy_arn', {}).get('references', [])
                policy = next((r for r in changes if r.get('address') == address), {})
                require(set(references) == {address, address + '.arn'}
                        and policy.get('change', {}).get('after', {}).get('name') == value['role'],
                        'Computed attachment must reference its exact run policy')
            else:
                require(value.get('policy_arn') == expected, 'Unexpected attached policy')
        if resource['type'] == 'cloudflare_dns_record':
            require(value['zone_id'] == manifest['config']['zoneId'] and value['name'] in [manifest['domain'], '_amazonses.' + manifest['domain']], 'Plan would modify unrelated DNS')
        if resource['type'] == 'aws_s3_bucket' and value.get('bucket'):
            require(value['bucket'] == manifest['receiver']['bucket'], 'Plan contains an unowned bucket')
        if resource['type'] in {'aws_ses_receipt_rule_set', 'aws_ses_active_receipt_rule_set', 'aws_ses_receipt_rule'}:
            require(value['rule_set_name'] == manifest['runId'] + '-rules', 'Plan would change an unrelated SES rule set')
        if resource['type'] in {'aws_ses_domain_identity', 'aws_ses_domain_identity_verification'}:
            require(value['domain'] == manifest['domain'], 'Plan contains an unrelated SES identity')
        if resource['type'] == 'aws_cloudwatch_log_group':
            require(value['name'] == '/aws/lambda/' + manifest['runId'] + '-indexer', 'Plan contains an unowned log group')
        if resource['type'] == 'aws_lambda_function':
            require(value['function_name'] == manifest['runId'] + '-indexer', 'Plan contains an unowned Lambda function')
            require(value['role'] == f"arn:aws:iam::{manifest['accountId']}:role/{manifest['runId']}-indexer", 'Unexpected Lambda execution role')
        if resource['type'] == 'aws_sqs_queue':
            require(value['name'] in [manifest['runId'] + '-ingestion', manifest['runId'] + '-ingestion-dlq'], 'Plan contains an unowned queue')
        if resource['type'] == 'aws_sns_topic':
            require(value['name'] == manifest['runId'] + '-received', 'Plan contains an unowned SNS topic')
        if resource['type'].startswith('aws_s3_') and value.get('bucket'):
            require(value['bucket'] == manifest['receiver']['bucket'], 'Plan references an unowned S3 bucket')
        if value.get('tags'):
            require(value['tags'].get('RunId') == manifest['runId'], 'Plan is missing run ownership tags')
    return changes


class Runner:
    def __init__(self, config, token, directory, cleanup=False):
        self.config, self.token = config, token
        self.directory = Path(directory).resolve()
        private_directory(self.directory)
        self.lock = open(self.directory / '.runner.lock', 'a')
        try:
            fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RunError('Another runner holds this run directory') from None
        self.log_count = 0
        self.summary = {'schemaVersion': 1, 'result': 'RUNNING', 'phases': [],
            'limits': ['Cloudflare only; Route53/manual DNS not tested',
                       'Synthetic queue recovery uses manual replay, not native SQS redrive',
                       'IAM simulations are separate from live denial canaries',
                       'Parent process retains bootstrap access; tests do not']}
        self.tools = {}
        for name in ['node', 'npm', 'aws', 'terraform', 'bwrap', 'git']:
            executable = shutil.which(name)
            require(executable is not None, 'Missing prerequisite: ' + name)
            self.tools[name] = str(Path(executable).resolve())
        # Only the explicitly allowlisted system runtime is exposed to children.
        for name in ['node', 'npm', 'aws']:
            require(self.tools[name].startswith('/usr/'), 'Install ' + name + ' under /usr or /usr/local for the Linux isolated runner')
        require(sys.version_info >= (3, 12), 'Python 3.12+ is required')
        require(sys.platform == 'linux', 'The full live runner requires Linux and Bubblewrap')
        (self.directory / 'logs').mkdir(exist_ok=True, mode=0o700)
        (self.directory / 'home').mkdir(exist_ok=True, mode=0o700)
        self.sessions = Path(tempfile.mkdtemp(prefix='hail-sessions-'))
        self.manifest = json.loads((self.directory / 'manifest.json').read_text()) if cleanup else None
        if cleanup:
            require(self.manifest['config'] == config, 'Cleanup config must match the saved manifest')
            require(bool(re.fullmatch(r'hail-\d{8}-[a-f0-9]{10}', self.manifest['runId'])), 'Invalid saved run ID')
            require(self.manifest['domain'] == self.manifest['runId'] + '.' + config['zoneName'], 'Manifest domain mismatch')
            require(self.manifest['accountId'] == config['accountId'] and self.manifest['region'] == config['region'], 'Manifest identity mismatch')
            require(self.manifest['receiver']['bucket'] == self.bucket(self.manifest['runId'], self.manifest['domain']), 'Manifest bucket mismatch')
            previous_path = self.directory / 'summary.json'
            if previous_path.exists():
                previous = json.loads(previous_path.read_text())
                write_json(self.directory / ('summary-before-cleanup-' + str(time.time_ns()) + '.json'), previous)
                self.summary['previousResult'] = previous.get('result')
        self.bootstrap_touched = cleanup
        self.receiver_touched = cleanup
        self.summary['cleanup'] = 'NOT_STARTED'
        if cleanup:
            self.summary.update(runId=self.manifest['runId'], domain=self.manifest['domain'], commit=self.manifest['commit'], operation='cleanup-only')

    def bucket(self, run, domain):
        return f"{run}-{self.config['accountId']}-{hashlib.sha256(domain.encode()).hexdigest()[:10]}"

    def save(self):
        if self.manifest:
            write_json(self.directory / 'manifest.json', self.manifest)
        write_json(self.directory / 'summary.json', self.summary)

    def command(self, label, args, *, cwd=None, env=None, timeout=900, ok=(0,), announce=True):
        self.log_count += 1
        name = f'{time.time_ns()}-{self.log_count:03}-{label}.log'
        logfile = self.directory / 'logs' / name
        if announce:
            print(label + '…', flush=True)
        start = time.monotonic()
        with open(logfile, 'xb', opener=lambda p, f: os.open(p, f, 0o600)) as out:
            child = subprocess.Popen(args, cwd=cwd, env=env or clean_env(self.directory / 'home'), stdout=out, stderr=subprocess.STDOUT, start_new_session=True)
            try:
                result = child.wait(timeout=timeout)
            except BaseException:
                os.killpg(child.pid, signal.SIGINT)
                try:
                    child.wait(timeout=30)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid, signal.SIGTERM)
                    try:
                        child.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        os.killpg(child.pid, signal.SIGKILL)
                        child.wait()
                raise
        self.summary['phases'].append({'name': label, 'result': 'PASS' if result in ok else 'FAIL', 'seconds': round(time.monotonic() - start, 1)})
        self.save()
        require(result in ok, label + ' failed; detailed output is in the private logs directory')
        return logfile.read_text(), result

    def source_env(self):
        # Bootstrap-only credential_process helpers may require injected environment.
        # Never pass this environment to installation, application tests, or receiver phases.
        env = dict(os.environ)
        for key in ('CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_API_KEY', 'AWS_ACCESS_KEY_ID',
                    'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_SECURITY_TOKEN',
                    'AWS_DEFAULT_PROFILE', 'AWS_ROLE_ARN', 'AWS_WEB_IDENTITY_TOKEN_FILE',
                    'AWS_CONTAINER_CREDENTIALS_FULL_URI', 'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI'):
            env.pop(key, None)
        env.update(HOME=str(Path.home()), AWS_PROFILE=self.config['bootstrapProfile'],
                   AWS_REGION=self.config['region'], AWS_DEFAULT_REGION=self.config['region'],
                   AWS_EC2_METADATA_DISABLED='true', AWS_PAGER='', LC_ALL='C.UTF-8')
        return env

    def source_aws(self, label, arguments):
        if arguments[:2] == ['sts', 'assume-role']:
            result = subprocess.run([self.tools['aws'], *arguments, '--region', self.config['region'], '--output', 'json'], env=self.source_env(), capture_output=True, text=True, timeout=90)
            require(result.returncode == 0, 'Restricted STS assumption failed')
            return json.loads(result.stdout)
        value, _ = self.command(label, [self.tools['aws'], *arguments, '--region', self.config['region'], '--output', 'json'], env=self.source_env(), timeout=90, announce=False)
        return json.loads(value) if value.strip() else {}

    def source_identity(self):
        identity = self.source_aws('bootstrap-identity', ['sts', 'get-caller-identity'])
        require(identity['Account'] == self.config['accountId'], 'Bootstrap AWS account mismatch')
        principal = self.config['sourcePrincipalArn']
        if ':user/' in principal:
            require(identity['Arn'] == principal, 'Bootstrap principal mismatch')
        else:
            name = principal.rsplit('/', 1)[-1]
            require(identity['Arn'].startswith(f"arn:aws:sts::{identity['Account']}:assumed-role/{name}/"), 'Bootstrap session mismatch')
            role = self.source_aws('bootstrap-principal', ['iam', 'get-role', '--role-name', name])
            require(role['Role']['Arn'] == principal, 'Bootstrap IAM role path mismatch')
        return identity

    def cf(self, suffix):
        req = urllib.request.Request('https://api.cloudflare.com/client/v4/' + suffix, headers={'Authorization': 'Bearer ' + self.token})
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                data = json.load(response)
        except Exception:
            raise RunError('Cloudflare read-only preflight failed') from None
        require(data.get('success') is True, 'Cloudflare preflight returned failure')
        return data['result']

    def sandbox(self, role, args, label, *, cwd='/hail/work', timeout=900, ok=(0,), live=False):
        mounts = ['--die-with-parent', '--unshare-pid', '--unshare-ipc', '--unshare-uts', '--new-session',
                  '--tmpfs', '/', '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--dir', '/etc', '--dir', '/tools']
        for path in ['/usr', '/bin', '/lib', '/lib64']:
            if Path(path).exists():
                mounts += ['--ro-bind', path, path]
        for path in ['/etc/ssl', '/etc/fonts', '/etc/hosts', '/etc/resolv.conf', '/etc/nsswitch.conf', '/etc/passwd', '/etc/group', '/etc/localtime']:
            if Path(path).exists():
                mounts += ['--ro-bind', str(Path(path).resolve()), path]
        mounts += ['--ro-bind', self.tools['terraform'], '/tools/terraform', '--bind', str(self.directory), '/hail',
                   '--ro-bind', str(REPO / 'scripts' / 'live'), '/tools/live', '--chdir', cwd, '--clearenv']
        env = clean_env('/hail/home', '/tools:/usr/local/bin:/usr/bin:/bin')
        env.update(PLAYWRIGHT_BROWSERS_PATH='/hail/browsers', AWS_REGION=self.config['region'], AWS_DEFAULT_REGION=self.config['region'])
        if role:
            mounts += ['--ro-bind', str(self.sessions / (role + '.json')), '/tmp/session.json']
            if live:
                mounts += ['--ro-bind', str(self.sessions / 'sender.json'), '/tmp/sender.json']
            if role == 'provisioner':
                token_path = self.sessions / 'cloudflare-token'
                if not token_path.exists():
                    with open(token_path, 'x', opener=lambda p, f: os.open(p, f, 0o600)) as out:
                        out.write(self.token)
                mounts += ['--ro-bind', str(token_path), '/tmp/cloudflare-token']
        for key, value in env.items():
            mounts += ['--setenv', key, value]
        command = [self.tools['bwrap'], *mounts, '--', '/usr/bin/python3', '/tools/live/child.py', role or 'none', 'live' if live else 'ordinary', *args]
        return self.command(label, command, env={'PATH': '/usr/local/bin:/usr/bin:/bin'}, timeout=timeout, ok=ok)

    def assume(self, roles):
        self.source_identity()
        for role in roles:
            require(role in ('provisioner', 'reader', 'sender'), 'Invalid assumed role')
            arn = f"arn:aws:iam::{self.config['accountId']}:role/{self.manifest['runId']}-{role}"
            for attempt in range(3):
                try:
                    data = self.source_aws('assume-' + role, ['sts', 'assume-role', '--role-arn', arn,
                        '--role-session-name', 'hail-' + role + '-' + secrets.token_hex(4), '--duration-seconds', '3600'])
                    break
                except RunError:
                    if attempt == 2:
                        raise
                    time.sleep(3 * (attempt + 1))
            self.summary.setdefault('sessionRefreshes', []).append({'role': role, 'attempts': attempt + 1})
            require(data['AssumedRoleUser']['Arn'].startswith(f"arn:aws:sts::{self.config['accountId']}:assumed-role/{self.manifest['runId']}-{role}/"), 'Assumed-role identity mismatch')
            creds = data['Credentials']
            write_json(self.sessions / (role + '.json'), {'accessKeyId': creds['AccessKeyId'], 'secretAccessKey': creds['SecretAccessKey'], 'sessionToken': creds['SessionToken'], 'expiration': creds['Expiration']})
            # STS output contains credentials. Remove its private command log immediately.
            for f in (self.directory / 'logs').glob('*-assume-' + role + '.log'):
                f.unlink()

    def bootstrap(self, label, args, source=True):
        return self.command(label, [self.tools['terraform'], '-chdir=' + str(self.directory / 'bootstrap'), *args], env=self.source_env() if source else clean_env(self.directory / 'home'))

    def initialize(self):
        require(not subprocess.check_output([self.tools['git'], '-C', str(REPO), 'status', '--porcelain', '--untracked-files=no']).strip(), 'Commit tracked changes before running live so evidence names an exact revision')
        commit = subprocess.check_output([self.tools['git'], '-C', str(REPO), 'rev-parse', 'HEAD'], text=True).strip()
        run = 'hail-' + dt.datetime.now(dt.timezone.utc).strftime('%Y%m%d') + '-' + secrets.token_hex(5)
        domain = run + '.' + self.config['zoneName']
        require(len(domain) <= 253, 'Generated domain is too long')
        expiry = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=8)).isoformat().replace('+00:00', 'Z')
        self.manifest = {'schemaVersion': 1, 'config': self.config, 'runId': run, 'accountId': self.config['accountId'], 'region': self.config['region'],
            'domain': domain, 'sender': 'sender@' + domain, 'owner': self.config['owner'], 'expiresAt': expiry,
            'retention': 'destroy-after-validation', 'commit': commit, 'receiver': {'bucket': self.bucket(run, domain), 'status': 'planned'}}
        self.summary.update(commit=commit, runId=run, domain=domain)
        self.save()
        archive = self.directory / 'source.tar'
        with archive.open('wb') as out:
            subprocess.run([self.tools['git'], '-C', str(REPO), 'archive', commit], stdout=out, check=True)
        work = self.directory / 'work'
        work.mkdir(mode=0o700)
        with tarfile.open(archive) as tar:
            tar.extractall(work, filter='data')
        archive.unlink()
        require((work / 'scripts/live/child.py').exists(), 'Commit the live runner before executing it')
        self.sandbox(None, ['true'], 'isolation-preflight')
        self.sandbox(None, ['npm', 'ci'], 'dependencies')
        self.sandbox(None, ['npx', '--no-install', 'playwright', 'install', 'chromium', 'firefox', 'webkit'], 'browser-download', timeout=900)
        for script in ['build', 'typecheck', 'test', 'test:python', 'test:e2e', 'test:package']:
            self.sandbox(None, ['npm', 'run', script], 'local-' + script.replace(':', '-'))
        self.sandbox(None, ['terraform', 'fmt', '-check', '-recursive', 'terraform'], 'terraform-format')
        for root in ROOTS:
            for command in [['init', '-backend=false', '-lockfile=readonly'], ['validate'], ['test']]:
                self.sandbox(None, ['terraform', '-chdir=terraform/' + root, *command], 'local-tf-' + root.replace('/', '-') + '-' + command[0])
        self.sandbox(None, ['npm', 'pack', '--pack-destination', '/hail'], 'pack')
        packages = list(self.directory.glob('*.tgz'))
        require(len(packages) == 1, 'Expected exactly one packed artifact')
        self.summary['packageSha256'] = hashlib.sha256(packages[0].read_bytes()).hexdigest()
        consumer = self.directory / 'consumer'
        consumer.mkdir(mode=0o700)
        manifest = json.loads((work / 'package.json').read_text())
        lock = json.loads((work / 'package-lock.json').read_text())
        playwright = lock['packages']['node_modules/@playwright/test']['version']
        sts = manifest['devDependencies']['@aws-sdk/client-sts']
        self.sandbox(None, ['npm', 'install', '--ignore-scripts', '/hail/' + packages[0].name, '@playwright/test@' + playwright, '@aws-sdk/client-sts@' + sts], 'consumer-dependencies', cwd='/hail/consumer')
        self.sandbox(None, ['npm', 'pkg', 'set', 'type=module'], 'consumer-esm', cwd='/hail/consumer')
        self.sandbox(None, ['node', 'scripts/prepare-live-consumer.mjs', '/hail/consumer'], 'consumer-prepare')
        transport = (work / 'tests/live/transport.ts').read_text().replace('../helpers/live-aws.js', './tests/live-aws.js').replace('../../src/index.js', '@everydaydevopsio/hail')
        (consumer / 'transport.ts').write_text(transport)
        shutil.copytree(work / 'terraform/bootstrap', self.directory / 'bootstrap', ignore=shutil.ignore_patterns('.terraform', '*.tfstate*'))
        self.bootstrap('bootstrap-init', ['init', '-backend=false', '-lockfile=readonly'], source=False)

    def provision(self):
        zone = self.cf('zones/' + self.config['zoneId'])
        require(zone['name'] == self.config['zoneName'] and zone['status'] == 'active', 'Cloudflare zone mismatch or inactive zone')
        for name in [self.manifest['domain'], '_amazonses.' + self.manifest['domain']]:
            require(not self.cf('zones/' + self.config['zoneId'] + '/dns_records?' + urllib.parse.urlencode({'name': name})), 'Fresh run domain already has records')
        identity = self.source_identity()
        m = self.manifest
        write_json(self.directory / 'bootstrap/bootstrap.auto.tfvars.json', {'account_id': m['accountId'], 'region': m['region'], 'name': m['runId'], 'domain': m['domain'], 'zone_name': self.config['zoneName'], 'from_address': m['sender'], 'source_principal_arn': self.config['sourcePrincipalArn'], 'source_session_arn': identity['Arn'], 'owner': m['owner'], 'expires_at': m['expiresAt']})
        self.bootstrap('bootstrap-plan', ['plan', '-out=apply.tfplan', '-no-color'])
        text, _ = self.bootstrap('bootstrap-review', ['show', '-json', 'apply.tfplan'], source=False)
        plan = json.loads(text)
        changes = check_plan(plan, 'bootstrap', 'create', m)
        require(len(changes) == 13, 'Unexpected bootstrap resource count')
        for change in changes:
            if change['type'] == 'aws_iam_policy':
                policy = self.directory / 'bootstrap' / (change['name'] + '.policy.json')
                write_json(policy, json.loads(change['change']['after']['policy']))
                result = self.source_aws('analyze-' + change['name'], ['accessanalyzer', 'validate-policy', '--policy-type', 'IDENTITY_POLICY', '--policy-document', 'file://' + str(policy)])
                require(not result.get('findings'), 'IAM Access Analyzer returned findings')
        self.bootstrap_touched = True
        self.bootstrap('bootstrap-apply', ['apply', '-no-color', 'apply.tfplan'])
        self.assume(['provisioner'])
        # CLI refuses to replace an active rule set or existing MX records.
        self.sandbox('provisioner', ['node', 'dist/cli.js', 'init', '--dns', 'cloudflare', '--domain', m['domain'], '--zone-name', self.config['zoneName'], '--zone-id', self.config['zoneId'], '--region', m['region'], '--name', m['runId'], '--activate-new-rule-set', '--out', '/hail/receiver'], 'receiver-preflight')
        root = self.directory / 'receiver'
        shutil.copy(self.directory / 'work/terraform/examples/cloudflare/.terraform.lock.hcl', root / '.terraform.lock.hcl')
        values = json.loads((root / 'terraform.tfvars.json').read_text())
        values.update(external_indexer_role_arn=f"arn:aws:iam::{m['accountId']}:role/{m['runId']}-indexer", external_reader_role_arn=f"arn:aws:iam::{m['accountId']}:role/{m['runId']}-reader", tags={'Project': 'hail', 'Environment': 'test', 'RunId': m['runId'], 'Owner': m['owner'], 'ExpiresAt': m['expiresAt']})
        write_json(root / 'terraform.tfvars.json', values)
        self.sandbox('provisioner', ['terraform', '-chdir=/hail/receiver', 'init', '-backend=false', '-lockfile=readonly'], 'receiver-init')
        self.sandbox('provisioner', ['terraform', '-chdir=/hail/receiver', 'plan', '-out=apply.tfplan', '-no-color'], 'receiver-plan')
        text, _ = self.sandbox(None, ['terraform', '-chdir=/hail/receiver', 'show', '-json', 'apply.tfplan'], 'receiver-review')
        changes = check_plan(json.loads(text), 'receiver', 'create', m)
        require(len(changes) == 22, 'Unexpected receiver resource count')
        self.receiver_touched = True
        self.sandbox('provisioner', ['terraform', '-chdir=/hail/receiver', 'apply', '-no-color', 'apply.tfplan'], 'receiver-apply', timeout=1800)
        self.sandbox('provisioner', ['node', 'dist/cli.js', 'configure', '--terraform-dir', '/hail/receiver', '--out', '/hail/hail.config.json'], 'configure')
        cfg = json.loads((self.directory / 'hail.config.json').read_text())
        require(cfg['bucketName'] == m['receiver']['bucket'], 'Receiver output bucket mismatch')
        cfg.pop('roleArn', None)
        write_json(self.directory / 'hail-direct.config.json', cfg)
        m['receiver']['status'] = 'deployed'
        self.save()

    def wait_for_doctor(self):
        # Fresh DNS can remain negatively cached after init's absence preflight.
        # Retry only DNS readiness, never IAM, receipt-rule, or storage failures.
        end = time.monotonic() + 600
        while True:
            text, code = self.sandbox('reader', ['node', 'dist/cli.js', 'doctor', '--config', '/hail/hail-direct.config.json'],
                                      'doctor', timeout=90, ok=(0, 1))
            report = json.loads(text)
            results = report.get('results', [])
            require({r.get('check') for r in results} == {'dns-mx', 'ses-identity', 'active-receipt-rule', 's3-reader'}, 'Unexpected doctor report')
            failed = [r['check'] for r in results if r.get('ok') is not True]
            if code == 0 and not failed:
                return
            self.summary['phases'][-1]['result'] = 'RETRY' if failed == ['dns-mx'] else 'FAIL'
            self.save()
            require(code == 1 and failed == ['dns-mx'], 'Non-DNS doctor check failed')
            require(time.monotonic() < end, 'DNS readiness timed out after ten minutes')
            time.sleep(10)

    def tests(self):
        self.assume(['reader', 'sender', 'provisioner'])
        self.wait_for_doctor()
        for role in ['reader', 'sender', 'provisioner']:
            self.sandbox(role, ['python3', '/tools/live/checks.py', 'denials', role], 'denials-' + role)
        self.audit()
        self.assume(['reader', 'sender'])
        for label, command, cwd, count in [
            ('source-live', ['npx', '--no-install', 'playwright', 'test'], '/hail/work', 27),
            ('packed-live', ['npx', '--no-install', 'playwright', 'test', '-c', 'tests/live-playwright.config.ts'], '/hail/consumer', 6)]:
            text, _ = self.sandbox('reader', command, label, cwd=cwd, live=True, timeout=1800)
            require(bool(re.search(r'\b' + str(count) + r' passed\b', text)), label + ' did not run the expected case count')
        self.assume(['reader', 'sender'])
        self.sandbox('reader', ['node', '--import', '/hail/work/node_modules/tsx/dist/loader.mjs', '/hail/consumer/transport.ts'], 'transport-live', live=True)
        self.assume(['provisioner'])
        self.sandbox('provisioner', ['python3', '/tools/live/checks.py', 'pipeline'], 'pipeline-fault-recovery', timeout=900)
        self.sandbox('provisioner', ['python3', '/tools/live/checks.py', 'indexer'], 'indexer-denials', timeout=600)
        self.sandbox('provisioner', ['terraform', '-chdir=/hail/receiver', 'plan', '-detailed-exitcode', '-no-color'], 'post-test-no-drift')
        self.summary['sendAttempts'] = json.loads((self.directory / 'send-count.json').read_text())['count']

    def audit(self):
        m = self.manifest
        base = f"arn:aws:iam::{m['accountId']}:role/{m['runId']}"
        bucket = 'arn:aws:s3:::' + m['receiver']['bucket']
        decisions = []
        def simulate(role, actions, resources, contexts=None, expected='implicitDeny'):
            args = ['iam', 'simulate-principal-policy', '--policy-source-arn', base + '-' + role, '--action-names', *actions, '--resource-arns', *resources]
            if contexts:
                args += ['--context-entries', json.dumps(contexts)]
            result = self.source_aws('iam-simulation-' + role, args)['EvaluationResults']
            require(bool(result) and all(v['EvalDecision'] == expected for v in result), 'IAM simulation did not match its expected decision')
            decisions.extend({'role': role, 'action': v['EvalActionName'], 'decision': v['EvalDecision'], 'kind': 'simulation'} for v in result)
        for role in ROLES:
            simulate(role, ['iam:PutRolePolicy', 'iam:AttachRolePolicy', 'iam:DeleteRolePermissionsBoundary', 'iam:PutRolePermissionsBoundary'], [base + '-' + role])
            simulate(role, ['route53:ChangeResourceRecordSets'], ['arn:aws:route53:::hostedzone/HAILNEGATIVECANARY'])
            simulate(role, ['s3:GetObject'], [bucket + '-outside/incoming/canary'])
        simulate('indexer', ['s3:PutObject'], [bucket + '/incoming/canary'])
        simulate('indexer', ['sqs:ReceiveMessage'], [f"arn:aws:sqs:{m['region']}:{m['accountId']}:{m['runId']}-outside"])
        contexts = [{'ContextKeyName': 'aws:RequestedRegion', 'ContextKeyValues': [m['region']], 'ContextKeyType': 'string'}, {'ContextKeyName': 'ses:FromAddress', 'ContextKeyValues': [m['sender']], 'ContextKeyType': 'string'}, {'ContextKeyName': 'ses:Recipients', 'ContextKeyValues': ['test@outside.invalid'], 'ContextKeyType': 'stringList'}]
        identity = f"arn:aws:ses:{m['region']}:{m['accountId']}:identity/{m['domain']}"
        simulate('sender', ['ses:SendRawEmail'], [identity], contexts)
        contexts[-1]['ContextKeyValues'] = ['test@' + m['domain']]
        simulate('sender', ['ses:SendRawEmail'], [identity], contexts, 'allowed')
        write_json(self.directory / 'iam-simulations.json', decisions)
        self.summary['iamSimulations'] = len(decisions)

    def state(self, root):
        file = self.directory / root / 'terraform.tfstate'
        return json.loads(file.read_text()) if file.exists() else {}

    def cleanup(self):
        self.summary['cleanup'] = 'RUNNING'
        self.save()
        m = self.manifest
        receiver_resources = managed_resources(self.state('receiver'))
        if receiver_resources:
            self.assume(['provisioner'])
            self.sandbox('provisioner', ['python3', '/tools/live/checks.py', 'cleanup-preflight'], 'cleanup-ownership')
            # Tag/account checks in this script also cover partially deployed buckets.
            buckets = [r for r in receiver_resources if r['type'] == 'aws_s3_bucket']
            if buckets:
                m['receiver']['status'] = 'deployed'
                self.save()
                self.sandbox('provisioner', ['node', '/hail/work/scripts/cleanup-live-bucket.mjs', '/hail/manifest.json', m['receiver']['bucket']], 'guarded-mail-purge')
            self.sandbox('provisioner', ['terraform', '-chdir=/hail/receiver', 'plan', '-destroy', '-out=destroy.tfplan', '-no-color'], 'receiver-destroy-plan')
            text, _ = self.sandbox(None, ['terraform', '-chdir=/hail/receiver', 'show', '-json', 'destroy.tfplan'], 'receiver-destroy-review')
            check_plan(json.loads(text), 'receiver', 'delete', m)
            self.sandbox('provisioner', ['terraform', '-chdir=/hail/receiver', 'apply', '-no-color', 'destroy.tfplan'], 'receiver-destroy', timeout=1800)
            self.sandbox('provisioner', ['python3', '/tools/live/checks.py', 'cleanup-verify'], 'receiver-absence')
        require(not managed_resources(self.state('receiver')), 'Receiver state is not empty; bootstrap roles retained for recovery')
        for name in [m['domain'], '_amazonses.' + m['domain']]:
            require(not self.cf('zones/' + self.config['zoneId'] + '/dns_records?' + urllib.parse.urlencode({'name': name})), 'Run DNS records remain; bootstrap roles retained')
        if managed_resources(self.state('bootstrap')):
            identity = self.source_identity()
            tfvars = self.directory / 'bootstrap/bootstrap.auto.tfvars.json'
            values = json.loads(tfvars.read_text())
            values['source_session_arn'] = identity['Arn']
            write_json(tfvars, values)
            self.bootstrap('bootstrap-destroy-plan', ['plan', '-destroy', '-out=destroy.tfplan', '-no-color'])
            text, _ = self.bootstrap('bootstrap-destroy-review', ['show', '-json', 'destroy.tfplan'], source=False)
            check_plan(json.loads(text), 'bootstrap', 'delete', m)
            self.bootstrap('bootstrap-destroy', ['apply', '-no-color', 'destroy.tfplan'])
        require(not managed_resources(self.state('bootstrap')), 'Bootstrap state is not empty')
        if self.bootstrap_touched:
            for role in ROLES:
                for kind, args in [('role', ['iam', 'get-role', '--role-name', m['runId'] + '-' + role]), ('policy', ['iam', 'get-policy', '--policy-arn', f"arn:aws:iam::{m['accountId']}:policy/{m['runId']}-{role}"])]:
                    text, code = self.command('absence-' + kind + '-' + role, [self.tools['aws'], *args, '--output', 'json'], env=self.source_env(), ok=(254,), announce=False)
                    require('NoSuchEntity' in text, 'IAM absence was not confirmed')
        m['receiver']['status'] = 'destroyed'
        self.summary['cleanup'] = 'PASS'
        self.save()

    def remove_sessions(self):
        # This directory was freshly allocated by this Runner; include interrupted atomic writes.
        shutil.rmtree(self.sessions)
        self.lock.close()


def parser():
    p = argparse.ArgumentParser(description='Cloudflare live test: installs local dependencies, provisions a fresh receiver, sends <=200 synthetic messages, tests, and tears down. Linux only.')
    p.add_argument('--config', required=True, help='Nonsecret JSON account/zone/profile configuration')
    p.add_argument('--execute', action='store_true', help='Explicitly authorize provisioning, SES activation if none is active, synthetic mail, fault probes, and cleanup')
    p.add_argument('--cleanup', metavar='RUN_DIR', help='Retry cleanup only using the retained private manifest and states')
    p.add_argument('--output-dir', help='New private run directory (must not exist)')
    return p


def _main(argv=None):
    os.umask(0o077)
    args = parser().parse_args(argv)
    runner = None
    def interrupt(signum, frame):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, interrupt)
    try:
        config = read_config(args.config)
        require(not (args.cleanup and args.output_dir), 'Choose cleanup or a new output directory')
        if not args.execute:
            print('Configuration is valid. No cloud calls made. Add --execute to authorize the full run and cleanup.')
            return 0
        token = cloudflare_token(os.environ)
        if args.cleanup:
            directory = Path(args.cleanup)
        elif args.output_dir:
            directory = Path(args.output_dir).absolute()
            directory.mkdir(mode=0o700)
        else:
            directory = Path(tempfile.mkdtemp(prefix='hail-live-'))
        print('Private run directory: ' + str(directory), flush=True)
        runner = Runner(config, token, directory, cleanup=bool(args.cleanup))
        failure = None
        try:
            if not args.cleanup:
                runner.initialize()
                runner.provision()
                runner.tests()
        except (Exception, KeyboardInterrupt) as error:
            failure = type(error).__name__
            print('Run stopped; attempting guarded cleanup. Details remain private.', flush=True)
        finally:
            # Ignore a second interrupt while cleanup is in progress; command timeouts remain bounded.
            signal.signal(signal.SIGINT, signal.SIG_IGN)
            signal.signal(signal.SIGTERM, signal.SIG_IGN)
            if runner.manifest and (runner.bootstrap_touched or runner.receiver_touched):
                try:
                    runner.cleanup()
                except Exception:
                    runner.summary['cleanup'] = 'FAILED_REQUIRES_RECOVERY'
                    failure = failure or 'CleanupError'
            if not runner.bootstrap_touched and not runner.receiver_touched:
                runner.summary['cleanup'] = 'NOT_NEEDED'
            runner.remove_sessions()
        runner.summary['result'] = 'FAIL' if failure else ('CLEANUP_PASS' if args.cleanup else 'PASS')
        runner.summary['failureClass'] = failure
        runner.save()
        print(runner.summary['result'] + ': see ' + str(directory / 'summary.json'), flush=True)
        if runner.summary['cleanup'] == 'FAILED_REQUIRES_RECOVERY':
            print('Resources may remain. Retry with --config YOUR_CONFIG --cleanup ' + str(directory) + ' --execute', flush=True)
        return 1 if failure else 0
    except (Exception, KeyboardInterrupt) as error:
        # Config/prerequisite errors are safe; arbitrary provider/process text is never forwarded.
        message = str(error) if isinstance(error, RunError) else type(error).__name__
        print('Live runner stopped: ' + message, file=sys.stderr)
        return 1


def main(argv=None):
    previous = {sig: signal.getsignal(sig) for sig in (signal.SIGINT, signal.SIGTERM)}
    try:
        return _main(argv)
    finally:
        for sig, handler in previous.items():
            signal.signal(sig, handler)
