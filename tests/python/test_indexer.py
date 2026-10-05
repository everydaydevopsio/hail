import importlib.util
import json
import os
from pathlib import Path
import sys
import types
import unittest

# Test the actual deployable handler without requiring AWS credentials or boto3.
sys.modules["boto3"] = types.SimpleNamespace(client=lambda service: None)
path = Path(__file__).resolve().parents[2] / "terraform/modules/receiver/lambda/handler.py"
spec = importlib.util.spec_from_file_location("hail_indexer", path)
indexer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(indexer)


class FakeS3:
    def __init__(self):
        self.objects = {}
        self.fail_head = False
        self.fail_put = None
        self.length = 100

    def head_object(self, **kwargs):
        if self.fail_head:
            raise OSError("Raw object temporarily unavailable")
        return {"ContentLength": self.length}

    def put_object(self, **kwargs):
        if self.fail_put and self.fail_put in kwargs["Key"]:
            raise OSError("Injected write failure")
        self.objects[kwargs["Key"]] = kwargs["Body"]


def notification(identifier="ses-123", recipients=None):
    return {
        "notificationType": "Received",
        "mail": {"messageId": identifier, "timestamp": "2026-09-29T00:00:00Z", "destination": ["wrong@example.test"]},
        "receipt": {
            "action": {"type": "S3", "bucketName": "hail-test", "objectKey": "incoming/" + identifier},
            "recipients": recipients or ["Test@mail.example.test"],
            "dkimVerdict": {"status": "PASS"},
        },
    }


def record(payload, identifier="queue-1"):
    return {"messageId": identifier, "body": json.dumps(payload)}


class IndexerTests(unittest.TestCase):
    def setUp(self):
        os.environ.update(BUCKET="hail-test", DOMAIN="mail.example.test")
        self.s3 = FakeS3()
        indexer.s3 = self.s3

    def test_indexes_envelope_recipient_not_untrusted_to_header(self):
        result = indexer.handler({"Records": [record(notification())]}, None)
        self.assertEqual(result, {"batchItemFailures": []})
        metadata = json.loads(self.s3.objects["index/test@mail.example.test/ses-123.json"])
        self.assertEqual(metadata["rawKey"], "incoming/ses-123")
        self.assertEqual(metadata["delivery"]["dkimVerdict"], "PASS")

    def test_duplicate_delivery_is_idempotent(self):
        payload = {"Records": [record(notification())]}
        indexer.handler(payload, None)
        original = self.s3.objects.copy()
        indexer.handler(payload, None)
        self.assertEqual(self.s3.objects, original)

    def test_only_failed_queue_records_are_retried(self):
        self.s3.fail_put = "bad@"
        payload = {"Records": [record(notification("good", ["good@mail.example.test"]), "q1"), record(notification("bad", ["bad@mail.example.test"]), "q2")]}
        self.assertEqual(indexer.handler(payload, None), {"batchItemFailures": [{"itemIdentifier": "q2"}]})
        self.assertIn("index/good@mail.example.test/good.json", self.s3.objects)

    def test_missing_raw_message_does_not_publish_a_ready_index(self):
        self.s3.fail_head = True
        result = indexer.handler({"Records": [record(notification())]}, None)
        self.assertEqual(len(result["batchItemFailures"]), 1)
        self.assertEqual(self.s3.objects, {})

    def test_filters_other_domains_and_supports_multiple_recipients(self):
        indexer.index_notification(notification(recipients=["a@mail.example.test", "b@mail.example.test", "other@external.test", "../unsafe@mail.example.test"]))
        self.assertEqual(len(self.s3.objects), 2)

    def test_rejects_wrong_bucket_and_key(self):
        payload = notification()
        payload["receipt"]["action"]["bucketName"] = "another-bucket"
        with self.assertRaises(ValueError):
            indexer.index_notification(payload)
        payload = notification()
        payload["receipt"]["action"]["objectKey"] = "unrelated-secret"
        with self.assertRaises(ValueError):
            indexer.index_notification(payload)

    def test_rejects_oversized_mail(self):
        self.s3.length = 17 * 1024 * 1024
        with self.assertRaises(ValueError):
            indexer.index_notification(notification())

    def test_invalid_json_is_not_acknowledged(self):
        result = indexer.handler({"Records": [{"messageId": "q1", "body": "not-json"}]}, None)
        self.assertEqual(result, {"batchItemFailures": [{"itemIdentifier": "q1"}]})

    def test_accepts_raw_or_sns_wrapped_notification(self):
        indexer.index_notification({"Type": "Notification", "Message": json.dumps(notification())})
        self.assertEqual(len(self.s3.objects), 1)

    def test_receipt_timestamp_requires_timezone(self):
        payload = notification()
        payload["mail"]["timestamp"] = "2026-09-29T00:00:00"
        with self.assertRaises(ValueError):
            indexer.index_notification(payload)


if __name__ == "__main__":
    unittest.main()
