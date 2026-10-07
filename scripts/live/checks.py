"""Restricted synthetic live checks; output includes outcomes, never mail bodies."""
import copy
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import uuid
import zipfile

ROOT = Path('/hail')


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def save(name, value):
    path = ROOT / name
    with open(path, 'w', opener=lambda p, f: os.open(p, f, 0o600)) as out:
        json.dump(value, out, indent=2)


def aws(*args, allow_error=False):
    result = subprocess.run(['aws', *args, '--region', os.environ['AWS_REGION'], '--output', 'json'], capture_output=True, text=True, timeout=90)
    if allow_error:
        return result
    require(result.returncode == 0, 'AWS operation failed: ' + args[0] + ' ' + args[1])
    return json.loads(result.stdout) if result.stdout.strip() else {}


def denial(result):
    # Missing resources or malformed CLI requests do not prove authorization denial.
    return result.returncode != 0 and ('(AccessDenied)' in result.stderr or '(AccessDeniedException)' in result.stderr or '(UnauthorizedOperation)' in result.stderr)


def wait(operation, seconds=120):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        value = operation()
        if value:
            return value
        time.sleep(3)
    raise RuntimeError('Bounded live check timed out')


def queue_url(m):
    return f"https://sqs.{m['region']}.amazonaws.com/{m['accountId']}/{m['runId']}-ingestion"


def denials(m, role):
    require(role in ('reader', 'sender', 'provisioner'), 'Invalid denial role')
    bucket = m['receiver']['bucket']
    (ROOT / 'canary.txt').write_text('synthetic authorization canary')
    cases = []
    if role == 'reader':
        cases = [('reader S3 write', ['s3api', 'put-object', '--bucket', bucket, '--key', 'canary/reader-negative', '--body', '/hail/canary.txt']),
                 ('reader queue consume', ['sqs', 'receive-message', '--queue-url', queue_url(m)]),
                 ('reader outside-prefix read', ['s3api', 'get-object', '--bucket', bucket, '--key', 'canary/nonexistent-read', '/tmp/denied-read'])]
    if role == 'sender':
        cases = [('sender inbox list', ['s3api', 'list-objects-v2', '--bucket', bucket]),
                 ('sender raw read', ['s3api', 'get-object', '--bucket', bucket, '--key', 'incoming/nonexistent-canary', '/tmp/denied-read'])]
    cases.append((role + ' IAM mutation', ['iam', 'delete-role-policy', '--role-name', m['runId'] + '-' + role, '--policy-name', 'hail-nonexistent-negative-canary']))
    results = []
    for label, args in cases:
        require(denial(aws(*args, allow_error=True)), 'Expected AccessDenied: ' + label)
        results.append({'case': label, 'result': 'AccessDenied', 'kind': 'live API'})
    save(role + '-denials.json', results)
    print('PASS: ' + role + ' bounded API denials')


def get_metadata(bucket, key, name):
    target = ROOT / name
    aws('s3api', 'get-object', '--bucket', bucket, '--key', key, str(target))
    return json.loads(target.read_text())


def exists(bucket, prefix):
    return bool(aws('s3api', 'list-objects-v2', '--bucket', bucket, '--prefix', prefix).get('Contents'))


def empty_queue(url):
    attrs = aws('sqs', 'get-queue-attributes', '--queue-url', url, '--attribute-names', 'ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible', 'ApproximateNumberOfMessagesDelayed')['Attributes']
    return all(int(value) == 0 for value in attrs.values())


def pipeline(m):
    bucket, q = m['receiver']['bucket'], queue_url(m)
    dlq = q + '-dlq'
    wait(lambda: empty_queue(q))
    require(empty_queue(dlq), 'DLQ must start empty')
    attrs = aws('sqs', 'get-queue-attributes', '--queue-url', q, '--attribute-names', 'VisibilityTimeout', 'RedrivePolicy')['Attributes']
    policy = json.loads(attrs['RedrivePolicy'])
    require(policy['deadLetterTargetArn'] == f"arn:aws:sqs:{m['region']}:{m['accountId']}:{m['runId']}-ingestion-dlq", 'Unexpected DLQ ownership')
    save('queue-settings-before.json', attrs)
    listed = aws('s3api', 'list-objects-v2', '--bucket', bucket, '--prefix', 'index/', '--max-keys', '1').get('Contents', [])
    require(bool(listed), 'Transport must deliver before fault injection')
    meta = get_metadata(bucket, listed[0]['Key'], 'pipeline-source.json')
    require(meta['rawKey'].startswith('incoming/') and meta['recipient'].endswith('@' + m['domain']), 'Unexpected source metadata')
    message = meta['messageId']
    recipient = 'pipeline-' + uuid.uuid4().hex[:20] + '@' + m['domain']
    good = {'notificationType': 'Received', 'mail': {'messageId': message, 'timestamp': meta['receivedAt']},
            'receipt': {'action': {'type': 'S3', 'bucketName': bucket, 'objectKey': meta['rawKey']}, 'recipients': [recipient]}}
    marker = uuid.uuid4().hex
    bad = copy.deepcopy(good)
    bad['receipt']['action']['objectKey'] = 'invalid-synthetic-storage-key'
    bad['hailCanary'] = marker
    try:
        policy['maxReceiveCount'] = 2
        aws('sqs', 'set-queue-attributes', '--queue-url', q, '--attributes', json.dumps({'VisibilityTimeout': '30', 'RedrivePolicy': json.dumps(policy)}))
        # SQS attributes may take up to a minute to propagate. Poll boundedly.
        wait(lambda: aws('sqs', 'get-queue-attributes', '--queue-url', q, '--attribute-names', 'VisibilityTimeout')['Attributes']['VisibilityTimeout'] == '30', 90)
        entries = [{'Id': 'valid', 'MessageBody': json.dumps(good)}, {'Id': 'poison', 'MessageBody': json.dumps(bad)}]
        require(not aws('sqs', 'send-message-batch', '--queue-url', q, '--entries', json.dumps(entries)).get('Failed'), 'Synthetic batch submission failed')
        wait(lambda: exists(bucket, f'index/{recipient}/{message}.json'))
        print('PASS: valid event indexed alongside poison', flush=True)
        def receive():
            items = aws('sqs', 'receive-message', '--queue-url', dlq, '--wait-time-seconds', '5', '--visibility-timeout', '180', '--message-system-attribute-names', 'ApproximateReceiveCount').get('Messages', [])
            for item in items:
                require(json.loads(item['Body']).get('hailCanary') == marker, 'Unowned DLQ message; refusing to consume it')
                return item
            return None
        dead = wait(receive, 360)
        require(int(dead.get('Attributes', {}).get('ApproximateReceiveCount', '0')) >= 3, 'Poison retry evidence missing')
        fixed = copy.deepcopy(good)
        fixed['receipt']['recipients'] = ['recovery-' + uuid.uuid4().hex[:20] + '@' + m['domain']]
        key = f"index/{fixed['receipt']['recipients'][0]}/{message}.json"
        aws('sqs', 'send-message', '--queue-url', q, '--message-body', json.dumps(fixed))
        wait(lambda: exists(bucket, key))
        aws('sqs', 'delete-message', '--queue-url', dlq, '--receipt-handle', dead['ReceiptHandle'])
        before = get_metadata(bucket, key, 'pipeline-before.json')
        previous = aws('s3api', 'head-object', '--bucket', bucket, '--key', key)['LastModified']
        time.sleep(2)  # Ensure the repeated write is distinguishable at S3 timestamp resolution.
        aws('sqs', 'send-message', '--queue-url', q, '--message-body', json.dumps(fixed))
        wait(lambda: aws('s3api', 'head-object', '--bucket', bucket, '--key', key)['LastModified'] != previous)
        require(before == get_metadata(bucket, key, 'pipeline-after.json'), 'Duplicate metadata changed')
        wait(lambda: empty_queue(q) and empty_queue(dlq))
        save('pipeline-result.json', {'result': 'PASS', 'kind': 'synthetic queue injection', 'manualReplay': True, 'nativeRedriveTaskTested': False, 'sameLambdaBatchProven': False})
        print('PASS: retry to DLQ, corrected manual replay, duplicate idempotency', flush=True)
    finally:
        aws('sqs', 'set-queue-attributes', '--queue-url', q, '--attributes', json.dumps(attrs))
        print('Restored queue settings', flush=True)


PROBE = '''import json,boto3,handler_original
from botocore.exceptions import ClientError
s3=boto3.client('s3'); iam=boto3.client('iam'); sqs=boto3.client('sqs')
def handler(event,context):
 failures=[]; ordinary=[]
 for r in event['Records']:
  try:
   body=json.loads(r['body'])
   if body.get('hailAuthorizationProbe')!=MARKER:
    ordinary.append(r); continue
   checks=[]
   cases=[('outside-prefix read',lambda:s3.get_object(Bucket=BUCKET,Key='canary/authorization-probe')),('raw-prefix write',lambda:s3.put_object(Bucket=BUCKET,Key='incoming/authorization-probe',Body=b'synthetic')),('IAM mutation',lambda:iam.delete_role_policy(RoleName=RUN+'-indexer',PolicyName='hail-nonexistent-negative-canary')),('DLQ consume',lambda:sqs.receive_message(QueueUrl=QUEUE+'-dlq',WaitTimeSeconds=0))]
   for name,fn in cases:
    try: fn(); checks.append({'case':name,'code':'UNEXPECTED_ALLOW'})
    except ClientError as e: checks.append({'case':name,'code':e.response['Error']['Code']})
   s3.put_object(Bucket=BUCKET,Key=RESULT,Body=json.dumps(checks).encode(),ContentType='application/json')
  except Exception: failures.append({'itemIdentifier':r['messageId']})
 if ordinary: failures.extend(handler_original.handler({'Records':ordinary},context)['batchItemFailures'])
 return {'batchItemFailures':failures}
'''


def indexer(m):
    bucket, run, q = m['receiver']['bucket'], m['runId'], queue_url(m)
    wait(lambda: empty_queue(q))
    original = ROOT / 'receiver/modules/receiver/lambda.zip'
    result_key = 'index/authorization-probe-' + uuid.uuid4().hex + '.json'
    marker = uuid.uuid4().hex
    header = '\n'.join(k + '=' + repr(v) for k, v in {'MARKER': marker, 'BUCKET': bucket, 'RUN': run, 'QUEUE': q, 'RESULT': result_key}.items()) + '\n'
    probe = ROOT / 'indexer-probe.zip'
    with zipfile.ZipFile(original) as source, zipfile.ZipFile(probe, 'w', zipfile.ZIP_DEFLATED) as target:
        target.writestr('handler_original.py', source.read('handler.py'))
        target.writestr('handler.py', header + PROBE)
    def ready():
        wait(lambda: aws('lambda', 'get-function-configuration', '--function-name', run + '-indexer').get('LastUpdateStatus') == 'Successful', 180)
    before = aws('lambda', 'get-function', '--function-name', run + '-indexer')['Configuration']['CodeSha256']
    try:
        aws('lambda', 'update-function-code', '--function-name', run + '-indexer', '--zip-file', 'fileb://' + str(probe))
        ready()
        aws('sqs', 'send-message', '--queue-url', q, '--message-body', json.dumps({'hailAuthorizationProbe': marker}))
        wait(lambda: exists(bucket, result_key))
        results = get_metadata(bucket, result_key, 'indexer-denials.json')
        require(len(results) == 4 and all(r['code'] in ('AccessDenied', 'AccessDeniedException') for r in results), 'Indexer canary did not return the required denial')
        print('PASS: four real indexer role denials', flush=True)
    finally:
        aws('lambda', 'update-function-code', '--function-name', run + '-indexer', '--zip-file', 'fileb://' + str(original))
        ready()
        require(aws('lambda', 'get-function', '--function-name', run + '-indexer')['Configuration']['CodeSha256'] == before, 'Worker restoration hash mismatch')
        print('Restored original worker archive', flush=True)


def cleanup_preflight(m):
    active = aws('ses', 'describe-active-receipt-rule-set')
    require(not active.get('Metadata') or active['Metadata']['Name'] == m['runId'] + '-rules', 'Another SES rule set is now active; refusing automated teardown')
    state = json.loads((ROOT / 'receiver/terraform.tfstate').read_text())
    if active.get('Metadata'):
        aws('ses', 'set-active-receipt-rule-set')
    # Stop new index writes before purging, including cleanup after a failed test.
    for resource in state.get('resources', []):
        if resource.get('mode') == 'managed' and resource['type'] == 'aws_lambda_event_source_mapping':
            for instance in resource.get('instances', []):
                identifier = instance['attributes']['id']
                aws('lambda', 'update-event-source-mapping', '--uuid', identifier, '--no-enabled')
                wait(lambda: aws('lambda', 'get-event-source-mapping', '--uuid', identifier).get('State') == 'Disabled', 180)
                time.sleep(30)  # The checked-in worker timeout bounds any in-flight invocation.
    for resource in state.get('resources', []):
        if resource.get('mode') != 'managed':
            continue
        for instance in resource.get('instances', []):
            values = instance.get('attributes', {})
            if resource['type'] == 'aws_s3_bucket':
                require(values['id'] == m['receiver']['bucket'], 'Unowned bucket in cleanup state')
                tags = aws('s3api', 'get-bucket-tagging', '--bucket', values['id'])['TagSet']
                require({t['Key']: t['Value'] for t in tags}.get('RunId') == m['runId'], 'Bucket ownership tag mismatch')


def cleanup_verify(m):
    response = aws('s3api', 'head-bucket', '--bucket', m['receiver']['bucket'], allow_error=True)
    require(response.returncode != 0 and '404' in response.stderr, 'Bucket absence not proven')
    require(not aws('ses', 'describe-active-receipt-rule-set').get('Metadata'), 'SES activation was not restored to empty')
    print('PASS: bucket absent and no active SES rule set')


def main():
    m = json.loads((ROOT / 'manifest.json').read_text())
    action = sys.argv[1]
    if action == 'denials':
        denials(m, sys.argv[2])
    else:
        {'pipeline': pipeline, 'indexer': indexer, 'cleanup-preflight': cleanup_preflight, 'cleanup-verify': cleanup_verify}[action](m)


if __name__ == '__main__':
    main()
