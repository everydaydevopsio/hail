"""Credential-free tests of live-run safety gates and recovery behavior."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from live import runner
from live import checks

CONFIG = {'accountId': '123456789012', 'region': 'us-east-1', 'zoneName': 'example.test',
          'zoneId': 'a' * 32, 'bootstrapProfile': 'test-bootstrap',
          'sourcePrincipalArn': 'arn:aws:iam::123456789012:user/tester', 'owner': 'test'}
MANIFEST = {'runId': 'hail-20261007-0123456789', 'accountId': CONFIG['accountId'],
            'domain': 'hail-20261007-0123456789.example.test', 'config': CONFIG,
            'receiver': {'bucket': 'hail-owned'}}


def plan(kind, after, actions=None):
    return {'resource_changes': [{'mode': 'managed', 'type': kind, 'change': {'actions': actions or ['create'], 'after': after, 'before': after}}]}


class LiveRunnerTests(unittest.TestCase):
    def test_requires_explicit_execute_before_any_cloud_or_subprocess(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / 'config.json'
            path.write_text(json.dumps(CONFIG))
            with patch.object(runner, 'Runner') as constructor, patch.object(runner, 'cloudflare_token') as token, contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(runner.main(['--config', str(path)]), 0)
                constructor.assert_not_called()
                token.assert_not_called()

    def test_unknown_or_secret_config_fields_are_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / 'config.json'
            for data in [dict(CONFIG, apiToken='secret'), dict(CONFIG, accountId='other'), dict(CONFIG, sourcePrincipalArn='arn:aws:iam::999999999999:user/tester')]:
                path.write_text(json.dumps(data))
                with self.assertRaises(runner.RunError):
                    runner.read_config(path)

    def test_token_alias_is_supported_but_conflicts_fail(self):
        self.assertEqual(runner.cloudflare_token({'CLOUDFLARE_API_KEY': 'bearer'}), 'bearer')
        self.assertEqual(runner.cloudflare_token({'CLOUDFLARE_API_TOKEN': 'bearer'}), 'bearer')
        with self.assertRaises(runner.RunError):
            runner.cloudflare_token({'CLOUDFLARE_API_KEY': 'one', 'CLOUDFLARE_API_TOKEN': 'two'})

    def test_plan_refuses_unowned_dns_bucket_and_replacements(self):
        for data in [plan('cloudflare_dns_record', {'zone_id': 'b' * 32, 'name': MANIFEST['domain']}),
                     plan('cloudflare_dns_record', {'zone_id': CONFIG['zoneId'], 'name': 'example.test'}),
                     plan('aws_s3_bucket', {'bucket': 'company-mail'}),
                     plan('aws_ses_active_receipt_rule_set', {'rule_set_name': 'company-mail'}),
                     plan('aws_s3_bucket', {'bucket': 'hail-owned'}, ['delete', 'create'])]:
            with self.assertRaises(runner.RunError):
                runner.check_plan(data, 'receiver', 'create', MANIFEST)

    def test_cleanup_plan_refuses_create_and_wrong_boundary(self):
        role = MANIFEST['runId'] + '-reader'
        with self.assertRaises(runner.RunError):
            runner.check_plan(plan('aws_iam_role', {'name': role, 'permissions_boundary': 'other'}), 'bootstrap', 'create', MANIFEST)
        with self.assertRaises(runner.RunError):
            runner.check_plan(plan('aws_s3_bucket', {'bucket': 'hail-owned'}), 'receiver', 'delete', MANIFEST)

    def test_computed_attachment_requires_exact_owned_policy_reference(self):
        role = MANIFEST['runId'] + '-reader'
        data = plan('aws_iam_role_policy_attachment', {'role': role})
        attachment = data['resource_changes'][0]
        attachment['address'] = 'aws_iam_role_policy_attachment.reader'
        attachment['change']['after_unknown'] = {'policy_arn': True}
        policy = plan('aws_iam_policy', {'name': role})['resource_changes'][0]
        policy['address'] = 'aws_iam_policy.reader'
        data['resource_changes'].append(policy)
        expression = {'references': ['aws_iam_policy.reader.arn', 'aws_iam_policy.reader']}
        data['configuration'] = {'root_module': {'resources': [{'address': attachment['address'], 'expressions': {'policy_arn': expression}}]}}
        runner.check_plan(data, 'bootstrap', 'create', MANIFEST)
        expression['references'] = ['aws_iam_policy.unrelated.arn', 'aws_iam_policy.unrelated']
        with self.assertRaises(runner.RunError):
            runner.check_plan(data, 'bootstrap', 'create', MANIFEST)
        expression['references'] = ['aws_iam_policy.reader.arn', 'aws_iam_policy.reader']
        policy['change']['after']['name'] = 'unrelated'
        with self.assertRaises(runner.RunError):
            runner.check_plan(data, 'bootstrap', 'create', MANIFEST)

    def test_notfound_and_cli_errors_are_not_denial_evidence(self):
        for message in ['NoSuchBucket', '(NoSuchEntity)', 'invalid argument', 'AccessDenied in a parameter name']:
            self.assertFalse(checks.denial(subprocess.CompletedProcess([], 1, '', message)))
        self.assertTrue(checks.denial(subprocess.CompletedProcess([], 254, '', 'An error occurred (AccessDenied) when calling')))
        self.assertFalse(checks.denial(subprocess.CompletedProcess([], 0, '', '(AccessDenied)')))

    def test_clean_environment_does_not_inherit_credentials(self):
        with patch.dict(os.environ, {'AWS_PROFILE': 'powerful', 'AWS_ACCESS_KEY_ID': 'secret', 'CLOUDFLARE_API_KEY': 'secret'}):
            env = runner.clean_env('/tmp/test')
        self.assertNotIn('AWS_PROFILE', env)
        self.assertNotIn('AWS_ACCESS_KEY_ID', env)
        self.assertNotIn('CLOUDFLARE_API_KEY', env)
        self.assertEqual(env['AWS_CONFIG_FILE'], '/dev/null')

    def test_bootstrap_preserves_helper_input_but_not_cloudflare_or_direct_keys(self):
        instance = runner.Runner.__new__(runner.Runner)
        instance.config = CONFIG
        with patch.dict(os.environ, {'PROFILE_HELPER_INPUT': 'helper-secret', 'AWS_ACCESS_KEY_ID': 'wrong-identity', 'CLOUDFLARE_API_KEY': 'dns-secret'}):
            env = instance.source_env()
        self.assertEqual(env['PROFILE_HELPER_INPUT'], 'helper-secret')
        self.assertEqual(env['AWS_PROFILE'], CONFIG['bootstrapProfile'])
        self.assertNotIn('AWS_ACCESS_KEY_ID', env)
        self.assertNotIn('CLOUDFLARE_API_KEY', env)

    def test_sts_credentials_never_pass_through_command_log(self):
        instance = runner.Runner.__new__(runner.Runner)
        instance.config = CONFIG
        instance.tools = {'aws': '/usr/bin/aws'}
        output = {'Credentials': {'SecretAccessKey': 'do-not-log'}}
        with patch.object(instance, 'command') as logger, patch.object(runner.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, json.dumps(output), '')):
            self.assertEqual(instance.source_aws('assume-reader', ['sts', 'assume-role']), output)
            logger.assert_not_called()

    def test_private_directory_rejects_public_modes_and_symlinks(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / 'private'
            path.mkdir(mode=0o700)
            runner.private_directory(path)
            link = Path(d) / 'link'
            link.symlink_to(path)
            with self.assertRaises(runner.RunError):
                runner.private_directory(link)
            path.chmod(0o755)
            with self.assertRaises(runner.RunError):
                runner.private_directory(path)

    def test_doctor_retries_only_dns_then_requires_success(self):
        instance = runner.Runner.__new__(runner.Runner)
        instance.summary = {'phases': []}
        responses = ['dns-mx', None]
        def sandbox(*args, **kwargs):
            failed = responses.pop(0)
            instance.summary['phases'].append({'result': 'PASS'})
            return json.dumps({'results': [{'check': k, 'ok': k != failed} for k in
                              ['dns-mx', 'ses-identity', 'active-receipt-rule', 's3-reader']]}), int(failed is not None)
        with patch.object(instance, 'sandbox', side_effect=sandbox), patch.object(instance, 'save'), patch.object(runner.time, 'sleep'):
            instance.wait_for_doctor()
        self.assertEqual([p['result'] for p in instance.summary['phases']], ['RETRY', 'PASS'])
        responses[:] = ['s3-reader']
        with patch.object(instance, 'sandbox', side_effect=sandbox), patch.object(instance, 'save'), patch.object(runner.time, 'sleep') as sleep:
            with self.assertRaisesRegex(runner.RunError, 'Non-DNS'):
                instance.wait_for_doctor()
            sleep.assert_not_called()

    def test_doctor_dns_wait_is_bounded(self):
        instance = runner.Runner.__new__(runner.Runner)
        instance.summary = {'phases': [{'result': 'PASS'}]}
        report = json.dumps({'results': [{'check': k, 'ok': k != 'dns-mx'} for k in
                            ['dns-mx', 'ses-identity', 'active-receipt-rule', 's3-reader']]})
        with patch.object(instance, 'sandbox', return_value=(report, 1)), patch.object(instance, 'save'), patch.object(runner.time, 'monotonic', side_effect=[0, 601]), patch.object(runner.time, 'sleep') as sleep:
            with self.assertRaisesRegex(runner.RunError, 'DNS readiness timed out'):
                instance.wait_for_doctor()
            sleep.assert_not_called()

    def test_failure_still_cleans_up_and_reports_nonzero(self):
        class Fake:
            def __init__(self, *args, **kwargs):
                self.summary = {}; self.manifest = {}; self.bootstrap_touched = False; self.receiver_touched = False
            def initialize(self): self.manifest = {'runId': 'test'}
            def provision(self): self.bootstrap_touched = True
            def tests(self): raise RuntimeError('secret diagnostic must stay private')
            def cleanup(self): self.cleaned = True; self.summary['cleanup'] = 'PASS'
            def remove_sessions(self): self.sessions_removed = True
            def save(self): pass
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / 'config.json'; path.write_text(json.dumps(CONFIG))
            fake = Fake(); stream = io.StringIO()
            with patch.object(runner, 'Runner', return_value=fake), patch.object(runner, 'cloudflare_token', return_value='secret'), patch.object(runner.signal, 'signal'), contextlib.redirect_stdout(stream):
                result = runner.main(['--config', str(path), '--execute', '--output-dir', str(Path(d) / 'run')])
            self.assertEqual(result, 1)
            self.assertTrue(fake.cleaned)
            self.assertTrue(fake.sessions_removed)
            self.assertNotIn('secret diagnostic', stream.getvalue())
            self.assertEqual(fake.summary['result'], 'FAIL')

    def test_cleanup_failure_is_not_reported_as_success(self):
        class Fake:
            def __init__(self):
                self.summary = {}; self.manifest = {'runId': 'test'}; self.bootstrap_touched = True; self.receiver_touched = True
            def cleanup(self): raise RuntimeError('failure')
            def remove_sessions(self): self.removed = True
            def save(self): pass
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / 'config.json'; path.write_text(json.dumps(CONFIG)); fake = Fake()
            with patch.object(runner, 'Runner', return_value=fake), patch.object(runner, 'cloudflare_token', return_value='secret'), patch.object(runner.signal, 'signal'), contextlib.redirect_stdout(io.StringIO()):
                result = runner.main(['--config', str(path), '--execute', '--cleanup', d])
            self.assertEqual(result, 1)
            self.assertEqual(fake.summary['cleanup'], 'FAILED_REQUIRES_RECOVERY')
            self.assertTrue(fake.removed)


if __name__ == '__main__':
    unittest.main()
