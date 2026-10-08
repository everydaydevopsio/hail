import { randomInt, randomUUID } from "node:crypto";
import { SESClient, SendRawEmailCommand } from "@aws-sdk/client-ses";
import { S3Client } from "@aws-sdk/client-s3";
import { Hail, S3MailStore, loadConfig } from "../../src/index.js";
import { loadRestrictedSession, countLiveSend } from "../helpers/live-aws.js";
import { writeFile } from "node:fs/promises";
const region = process.env.HAIL_SEND_REGION!;
async function main() {
  const cfg = await loadConfig();
  const reader = await loadRestrictedSession(
    process.env.HAIL_READER_SESSION_FILE,
    process.env.HAIL_READER_ROLE_ARN,
    process.env.HAIL_EXPECTED_ACCOUNT,
    region,
  );
  const sender = await loadRestrictedSession(
    process.env.HAIL_SENDER_SESSION_FILE,
    process.env.HAIL_SENDER_ROLE_ARN,
    process.env.HAIL_EXPECTED_ACCOUNT,
    region,
  );
  const config = { ...cfg, roleArn: undefined };
  const hail = new Hail(
    config,
    new S3MailStore(
      config,
      new S3Client({ region, credentials: reader.credentials, maxAttempts: 2 }),
    ),
  );
  const ses = new SESClient({
    region,
    credentials: sender.credentials,
    maxAttempts: 1,
  });
  const visible = hail.createInbox("mime"),
    blind = hail.createInbox("bcc");
  const after = await visible.checkpoint();
  const code = String(randomInt(100000, 1000000));
  const subject = "Hail transport " + randomUUID();
  const boundary = "hail-" + randomUUID();
  const raw = [
    `From: ${process.env.HAIL_FROM}`,
    `To: ${visible.address}`,
    `Subject: ${subject}`,
    "Date: Sat, 01 Jan 2000 00:00:00 +0000",
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    `Your verification code is ${code}.`,
    `--${boundary}`,
    "Content-Type: application/octet-stream",
    'Content-Disposition: attachment; filename="synthetic.bin"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from([0, 1, 2, 127, 128, 255]).toString("base64"),
    `--${boundary}--`,
    "",
  ].join("\r\n");
  await countLiveSend(process.env.HAIL_LIVE_RUN_DIR);
  await ses.send(
    new SendRawEmailCommand({
      Source: process.env.HAIL_FROM,
      Destinations: [visible.address, blind.address],
      RawMessage: { Data: Buffer.from(raw) },
    }),
    { abortSignal: AbortSignal.timeout(20000) },
  );
  const messages = await Promise.all([
    visible.waitForEmail({ after, subject, timeoutMs: 90000 }),
    blind.waitForEmail({ after, subject, timeoutMs: 90000 }),
  ]);
  for (const mail of messages) {
    if (mail.getCode() !== code) throw Error("OTP assertion failed");
    if (
      mail.attachments.length !== 1 ||
      !mail.attachments[0].content.equals(Buffer.from([0, 1, 2, 127, 128, 255]))
    )
      throw Error("Attachment assertion failed");
    if (mail.receivedAt.getTime() < after.startedAt.getTime())
      throw Error("Receipt timestamp assertion failed");
  }
  await writeFile(
    process.env.HAIL_LIVE_RUN_DIR + "/transport-result.json",
    JSON.stringify({
      result: "PASS",
      cases: [
        "transactional MIME",
        "OTP",
        "Bcc envelope delivery",
        "binary attachment bytes",
        "server receipt timestamp",
      ],
    }),
    { mode: 0o600 },
  );
  console.log(
    "PASS: transactional MIME, OTP, Bcc envelope delivery, binary attachment bytes, trusted receipt timestamp",
  );
}
main().catch((e) => {
  console.error("Transport failed:", e.name);
  process.exitCode = 1;
});
