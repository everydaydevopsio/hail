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
        with patch.object(runner, 'Runner') as constructor, patch.object(runner, 'resolve_config') as discovery, patch.object(runner, 'cloudflare_token') as token, contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(runner.main(['--profile', 'test-bootstrap', '--domain', 'example.test']), 0)
            constructor.assert_not_called()
            discovery.assert_not_called()
            token.assert_not_called()

    def test_invalid_options_fail_without_discovery(self):
        for arguments in [[], ['--profile', 'test'], ['--profile', 'test', '--domain', 'https://example.test'],
                          ['--profile', 'test', '--domain=-bad.test'],
                          ['--profile', 'test', '--domain', 'example.test', '--expected-account', 'wrong']]:
            with patch.object(runner, 'resolve_config') as discovery, contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(runner.main(arguments), 1)
                discovery.assert_not_called()

    def test_discovery_uses_profile_region_identity_and_exact_zone(self):
        args = runner.parser().parse_args(['--profile', 'test-bootstrap', '--domain', 'example.test'])
        identity = {'Account': CONFIG['accountId'], 'Arn': CONFIG['sourcePrincipalArn']}
        zone = {'id': CONFIG['zoneId'], 'name': 'example.test', 'status': 'active'}
        with patch.object(runner, 'discovery_aws', side_effect=['us-east-1', identity]) as aws, patch.object(runner, 'cloudflare_read', return_value=[zone]) as cf:
            resolved = runner.resolve_config(args, 'secret')
        self.assertEqual(resolved, dict(CONFIG, owner='tester'))
        self.assertEqual(aws.call_args_list[0].args, ('test-bootstrap', None, ['configure', 'get', 'region']))
        self.assertIn('name=example.test', cf.call_args.args[1])

    def test_explicit_region_owner_and_expected_account(self):
        args = runner.parser().parse_args(['--profile', 'test-bootstrap', '--domain', 'example.test', '--region', 'us-east-1', '--owner', 'test', '--expected-account', CONFIG['accountId']])
        identity = {'Account': CONFIG['accountId'], 'Arn': CONFIG['sourcePrincipalArn']}
        zone = {'id': CONFIG['zoneId'], 'name': 'example.test', 'status': 'active'}
        with patch.object(runner, 'discovery_aws', return_value=identity) as aws, patch.object(runner, 'cloudflare_read', return_value=[zone]):
            self.assertEqual(runner.resolve_config(args, 'secret'), CONFIG)
            aws.assert_called_once_with('test-bootstrap', 'us-east-1', ['sts', 'get-caller-identity'])
        with patch.object(runner, 'discovery_aws', return_value=dict(identity, Account='999999999999')), patch.object(runner, 'cloudflare_read') as cf:
            with self.assertRaisesRegex(runner.RunError, 'account'):
                runner.resolve_config(args, 'secret')
            cf.assert_not_called()

    def test_assumed_role_discovery_preserves_iam_path(self):
        arn = 'arn:aws:iam::123456789012:role/aws-reserved/sso.amazonaws.com/AWSReservedSSO_Test_123'
        identity = {'Account': CONFIG['accountId'], 'Arn': 'arn:aws:sts::123456789012:assumed-role/AWSReservedSSO_Test_123/session'}
        role = {'Role': {'RoleName': 'AWSReservedSSO_Test_123', 'Arn': arn}}
        with patch.object(runner, 'discovery_aws', side_effect=[identity, role]) as aws:
            self.assertEqual(runner.discover_principal('test-bootstrap', 'us-east-1'), (CONFIG['accountId'], arn))
            self.assertEqual(aws.call_args.args[2], ['iam', 'get-role', '--role-name', 'AWSReservedSSO_Test_123'])
        role['Role']['Arn'] = 'arn:aws:iam::999999999999:role/AWSReservedSSO_Test_123'
        with patch.object(runner, 'discovery_aws', side_effect=[identity, role]), self.assertRaises(runner.RunError):
            runner.discover_principal('test-bootstrap', 'us-east-1')

    def test_zone_discovery_rejects_missing_ambiguous_inactive_or_wrong_zone(self):
        args = runner.parser().parse_args(['--profile', 'test-bootstrap', '--domain', 'example.test', '--region', 'us-east-1'])
        zone = {'id': CONFIG['zoneId'], 'name': 'example.test', 'status': 'active'}
        for zones in [[], [zone, zone], [dict(zone, status='pending')], [dict(zone, name='other.test')]]:
            with patch.object(runner, 'discover_principal', return_value=(CONFIG['accountId'], CONFIG['sourcePrincipalArn'])), patch.object(runner, 'cloudflare_read', return_value=zones):
                with self.assertRaises(runner.RunError):
                    runner.resolve_config(args, 'secret')

    def test_cleanup_recovers_settings_and_pins_original_identity(self):
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / 'manifest.json').write_text(json.dumps(MANIFEST))
            args = runner.parser().parse_args(['--cleanup', d])
            with patch.object(runner, 'discover_principal', return_value=(CONFIG['accountId'], CONFIG['sourcePrincipalArn'])) as identity, patch.object(runner, 'cloudflare_read') as cf:
                self.assertEqual(runner.resolve_config(args, 'secret'), CONFIG)
                identity.assert_called_once_with('test-bootstrap', 'us-east-1', CONFIG['accountId'])
                cf.assert_not_called()
            args.domain = 'other.test'
            with patch.object(runner, 'discover_principal') as identity, self.assertRaises(runner.RunError):
                runner.resolve_config(args, 'secret')
            identity.assert_not_called()
            args.domain = None
            with patch.object(runner, 'discover_principal', return_value=(CONFIG['accountId'], 'arn:aws:iam::123456789012:user/other')), self.assertRaises(runner.RunError):
                runner.resolve_config(args, 'secret')

    def test_profile_discovery_scrubs_direct_credentials_and_region_override(self):
        with patch.dict(os.environ, {'AWS_REGION': 'wrong-region', 'AWS_DEFAULT_REGION': 'wrong-region', 'AWS_ACCESS_KEY_ID': 'wrong-identity', 'CLOUDFLARE_API_KEY': 'secret'}), patch.object(runner.shutil, 'which', return_value='/usr/bin/aws'), patch.object(runner.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, 'us-east-1\n', '')) as command:
            self.assertEqual(runner.discovery_aws('selected', None, ['configure', 'get', 'region'], raw=True), 'us-east-1')
            env = command.call_args.kwargs['env']
            self.assertEqual(env['AWS_PROFILE'], 'selected')
            for key in ['AWS_REGION', 'AWS_DEFAULT_REGION', 'AWS_ACCESS_KEY_ID', 'CLOUDFLARE_API_KEY']:
                self.assertNotIn(key, env)

    def test_explicit_terraform_binary_overrides_path_launcher(self):
        with tempfile.TemporaryDirectory() as d:
            binary = Path(d) / 'terraform'
            binary.write_bytes(b'fixture')
            binary.chmod(0o700)
            with patch.object(runner.shutil, 'which', return_value='/unavailable/tfenv-wrapper') as lookup:
                self.assertEqual(runner.terraform_executable(str(binary)), str(binary))
                lookup.assert_not_called()
            binary.chmod(0o600)
            with self.assertRaises(runner.RunError):
                runner.terraform_executable(str(binary))

    def test_tfenv_launcher_resolves_native_binary_without_credentials(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            launcher = root / 'terraform'
            launcher.write_text('#!/bin/bash\n# tfenv launcher\n')
            launcher.chmod(0o700)
            tfenv = root / 'tfenv'
            tfenv.write_text('#!/bin/bash\n')
            tfenv.chmod(0o700)
            binary = root / 'versions/1.9.8/terraform'
            binary.parent.mkdir(parents=True)
            binary.write_bytes(b'\x7fELFfixture')
            binary.chmod(0o700)
            output = subprocess.CompletedProcess([], 0, str(root) + '\n1.9.8\n', '')
            with patch.dict(os.environ, {'AWS_PROFILE': 'powerful', 'CLOUDFLARE_API_KEY': 'secret', 'AWS_ACCESS_KEY_ID': 'secret', 'TFENV_TERRAFORM_VERSION': '1.9.8', 'TFENV_CONFIG_DIR': d}), patch.object(runner.subprocess, 'run', return_value=output) as command:
                self.assertEqual(runner.terraform_executable(str(launcher)), str(binary))
            env = command.call_args.kwargs['env']
            for key in ('AWS_PROFILE', 'AWS_ACCESS_KEY_ID', 'CLOUDFLARE_API_KEY'):
                self.assertNotIn(key, env)
            self.assertEqual(env['TFENV_AUTO_INSTALL'], 'false')
            self.assertEqual(env['TFENV_TERRAFORM_VERSION'], '1.9.8')
            self.assertEqual(env['TFENV_CONFIG_DIR'], d)
            self.assertEqual(command.call_args.kwargs['cwd'], runner.REPO)
            self.assertEqual(command.call_args.args[0], [str(tfenv), 'hail-resolve'])
            binary.unlink()
            with patch.object(runner.subprocess, 'run', return_value=output), self.assertRaisesRegex(runner.RunError, 'not installed'):
                runner.terraform_executable(str(launcher))

    def test_tfenv_resolution_rejects_bad_versions_and_sanitizes_errors(self):
        with tempfile.TemporaryDirectory() as d:
            launcher = Path(d) / 'terraform'
            for output in [subprocess.CompletedProcess([], 0, d + '\n../../outside\n', ''),
                           subprocess.CompletedProcess([], 1, '', 'private diagnostic')]:
                with patch.object(runner.shutil, 'which', return_value='/tools/tfenv'), patch.object(runner.subprocess, 'run', return_value=output):
                    with self.assertRaises(runner.RunError) as error:
                        runner.tfenv_executable(launcher)
                    self.assertNotIn('private diagnostic', str(error.exception))

    def test_terraform_preflight_uses_no_credentials_and_explains_launcher_failure(self):
        instance = runner.Runner.__new__(runner.Runner)
        with patch.object(instance, 'sandbox', side_effect=runner.RunError('private subprocess error')) as sandbox:
            with self.assertRaisesRegex(runner.RunError, '--terraform-binary'):
                instance.terraform_preflight()
            self.assertEqual(sandbox.call_args.args[:2], (None, ['terraform', 'version', '-json']))
            self.assertEqual(sandbox.call_args.kwargs['cwd'], '/hail')

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
            fake = Fake(); stream = io.StringIO()
            with patch.object(runner, 'Runner', return_value=fake), patch.object(runner, 'resolve_config', return_value=CONFIG), patch.object(runner, 'cloudflare_token', return_value='secret'), patch.object(runner.signal, 'signal'), contextlib.redirect_stdout(stream):
                result = runner.main(['--profile', 'test-bootstrap', '--domain', 'example.test', '--execute', '--output-dir', str(Path(d) / 'run')])
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
            fake = Fake()
            with patch.object(runner, 'Runner', return_value=fake), patch.object(runner, 'resolve_config', return_value=CONFIG), patch.object(runner, 'cloudflare_token', return_value='secret'), patch.object(runner.signal, 'signal'), contextlib.redirect_stdout(io.StringIO()):
                result = runner.main(['--execute', '--cleanup', d])
            self.assertEqual(result, 1)
            self.assertEqual(fake.summary['cleanup'], 'FAILED_REQUIRES_RECOVERY')
            self.assertTrue(fake.removed)


if __name__ == '__main__':
    unittest.main()
