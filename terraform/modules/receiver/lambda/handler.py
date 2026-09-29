"""Retryable SES S3-action -> SNS (raw) -> SQS mailbox indexer.

Derived from markcallen/ses-receiving-terraform. Keep raw MIME immutable;
write deterministic per-envelope-recipient metadata only after S3 confirms it.
"""
import json
import logging
import os
import re
from datetime import datetime

import boto3

s3 = boto3.client("s3")
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


def index_notification(payload):
    bucket = os.environ["BUCKET"]
    domain = os.environ["DOMAIN"].lower()
    if payload.get("Type") == "Notification":
        payload = json.loads(payload["Message"])
    if payload.get("notificationType") != "Received":
        raise ValueError("Expected an SES receiving notification")
    mail, receipt = payload["mail"], payload["receipt"]
    message_id = mail["messageId"]
    if not isinstance(message_id, str) or not re.fullmatch(r"[a-zA-Z0-9_-]{1,200}", message_id):
        raise ValueError("Invalid SES message ID")
    raw_key = f"incoming/{message_id}"
    action = receipt["action"]
    if action.get("type") != "S3" or action.get("bucketName") != bucket or action.get("objectKey") not in (message_id, raw_key):
        raise ValueError("Unexpected SES storage action")
    received_at = mail["timestamp"]
    timestamp = datetime.fromisoformat(received_at.replace("Z", "+00:00"))
    if timestamp.tzinfo is None:
        raise ValueError("Receipt timestamp must include a timezone")
    # A failed read raises, leaving the SQS record available for retry.
    head = s3.head_object(Bucket=bucket, Key=raw_key)
    if head["ContentLength"] > 16 * 1024 * 1024:
        raise ValueError("Message exceeds Hail's 16 MiB limit")
    delivery = {
        name: receipt[name]["status"]
        for name in ("spfVerdict", "dkimVerdict", "dmarcVerdict", "spamVerdict", "virusVerdict")
        if isinstance(receipt.get(name), dict) and isinstance(receipt[name].get("status"), str)
    }
    recipients = receipt["recipients"]
    if not isinstance(recipients, list):
        raise ValueError("Expected envelope recipients")
    for recipient in sorted(set(value.lower() for value in recipients)):
        local, separator, recipient_domain = recipient.partition("@")
        if separator != "@" or recipient_domain != domain:
            continue
        if not re.fullmatch(r"[a-z0-9][a-z0-9._+-]{0,63}", local):
            continue
        metadata = {
            "schemaVersion": 1,
            "messageId": message_id,
            "recipient": recipient,
            "receivedAt": received_at,
            "rawKey": raw_key,
            "delivery": delivery,
        }
        # Same key and body on retries. Never delete raw mail or emit S3 events.
        s3.put_object(
            Bucket=bucket,
            Key=f"index/{recipient}/{message_id}.json",
            Body=json.dumps(metadata, sort_keys=True).encode("utf-8"),
            ContentType="application/json",
        )


def handler(event, context):
    failures = []
    for record in event["Records"]:
        identifier = record["messageId"]
        try:
            index_notification(json.loads(record["body"]))
        except Exception as error:
            # Do not log message bodies, recipients, subjects, or token-bearing URLs.
            logger.error("Mail indexing failed (%s)", type(error).__name__)
            failures.append({"itemIdentifier": identifier})
    return {"batchItemFailures": failures}
