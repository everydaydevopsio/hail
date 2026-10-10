import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { SESClient, SendRawEmailCommand } from "@aws-sdk/client-ses";
import { S3Client } from "@aws-sdk/client-s3";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import type { AwsCredentialIdentity } from "@aws-sdk/types";
import { Hail, EmailTimeoutError } from "./index.js";
import { normalizeAddress, type HailConfig } from "./config.js";
import { S3MailStore } from "./store.js";

const pass = "PASS: one synthetic message reached the intended Hail inbox.";

export async function runSmoke(
  hail: Hail,
  sender: string,
  timeoutMs: number,
  send: (to: string, subject: string, body: string) => Promise<void>,
): Promise<string> {
  const from = normalizeAddress(sender);
  const inbox = hail.createInbox("smoke");
  const after = await inbox.checkpoint();
  const marker = randomUUID();
  const subject = `Hail smoke ${marker}`;
  const body = `Synthetic Hail delivery check: ${marker}`;
  await send(inbox.address, subject, body);
  const deadline = Date.now() + timeoutMs;
  for (let inspected = 0; inspected < 5; inspected++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new EmailTimeoutError(timeoutMs);
    const message = await inbox.waitForEmail({
      after,
      subject,
      from,
      timeoutMs: remaining,
      pollIntervalMs: 500,
    });
    if (message.recipient === inbox.address && message.text.trim() === body)
      return pass;
  }
  throw new Error("Too many nonmatching messages.");
}

export function smokeFailure(error: unknown): string {
  if (error instanceof EmailTimeoutError)
    return "FAIL: delivery or ingestion timed out; inspect DNS, SES receipt rules, and the ingestion DLQ.";
  const name = error instanceof Error ? error.name : "";
  if (
    name === "MessageRejected" ||
    name === "MailFromDomainNotVerifiedException"
  )
    return "FAIL: SES rejected the sender or recipient.";
  if (name === "SmokeSenderAccessDenied")
    return "FAIL: sender access was denied.";
  if (name === "AccessDenied" || name === "AccessDeniedException")
    return "FAIL: reader access was denied.";
  return "FAIL: smoke check failed; inspect restricted credentials and receiver health.";
}

interface RestrictedSession {
  credentials: AwsCredentialIdentity;
  roleId: string;
  expiration: Date;
}

export function requireSessionLifetime(
  expiration: Date,
  neededMs: number,
  now = Date.now(),
): void {
  if (
    !Number.isFinite(expiration.getTime()) ||
    expiration.getTime() < now + neededMs + 30_000
  )
    throw new Error("Restricted session expires before the smoke deadline.");
}

export function verifiedRoleId(
  expectedRoleArn: string,
  expectedAccount: string,
  actualArn: string | undefined,
  actualAccount: string | undefined,
  userId: string | undefined,
): string {
  const expected =
    /^arn:(aws(?:-us-gov|-cn)?):iam::(\d{12}):role\/(?:[A-Za-z0-9_+=,.@-]+\/)*([A-Za-z0-9_+=,.@-]+)$/.exec(
      expectedRoleArn,
    );
  const actual =
    /^arn:(aws(?:-us-gov|-cn)?):sts::(\d{12}):assumed-role\/([^/]+)\/[^/]+$/.exec(
      actualArn ?? "",
    );
  const roleId = /^(AROA[A-Z0-9]+):[^:]+$/.exec(userId ?? "")?.[1];
  if (
    !expected ||
    !actual ||
    !roleId ||
    expected[1] !== actual[1] ||
    expected[2] !== expectedAccount ||
    actual[2] !== expectedAccount ||
    actualAccount !== expectedAccount ||
    expected[3] !== actual[3]
  )
    throw new Error(
      "Restricted session identity did not match the expected role and account.",
    );
  return roleId;
}

export function assertDistinctRoleIds(
  readerRoleId: string,
  senderRoleId: string,
): void {
  if (readerRoleId === senderRoleId)
    throw new Error("Reader and sender sessions use the same AWS role.");
}

async function restrictedSession(
  file: string,
  expectedRoleArn: string,
  expectedAccount: string,
  region: string,
  timeoutMs: number,
): Promise<RestrictedSession> {
  const info = await stat(file);
  if (
    !info.isFile() ||
    (info.mode & 0o077) !== 0 ||
    info.uid !== process.getuid?.()
  )
    throw new Error(
      "Restricted session file must be owned by this user and mode 0600.",
    );
  const data = JSON.parse(await readFile(file, "utf8")) as Record<
    string,
    unknown
  >;
  const expiration =
    typeof data.expiration === "string" ? Date.parse(data.expiration) : NaN;
  if (
    typeof data.accessKeyId !== "string" ||
    typeof data.secretAccessKey !== "string" ||
    typeof data.sessionToken !== "string" ||
    !Number.isFinite(expiration)
  )
    throw new Error("Restricted session is missing or expires too soon.");
  requireSessionLifetime(new Date(expiration), timeoutMs);
  const credentials: AwsCredentialIdentity = {
    accessKeyId: data.accessKeyId,
    secretAccessKey: data.secretAccessKey,
    sessionToken: data.sessionToken,
    expiration: new Date(expiration),
  };
  const identity = await new STSClient({
    region,
    credentials,
    maxAttempts: 1,
  }).send(new GetCallerIdentityCommand({}), {
    abortSignal: AbortSignal.timeout(10_000),
  });
  return {
    credentials,
    roleId: verifiedRoleId(
      expectedRoleArn,
      expectedAccount,
      identity.Arn,
      identity.Account,
      identity.UserId,
    ),
    expiration: new Date(expiration),
  };
}

export interface SmokeOptions {
  config: HailConfig;
  from: string;
  sendRegion: string;
  timeoutMs: number;
  account: string;
  readerRoleArn: string;
  senderRoleArn: string;
  readerSessionFile: string;
  senderSessionFile: string;
}

export async function smoke(options: SmokeOptions): Promise<string> {
  if (
    !Number.isInteger(options.timeoutMs) ||
    options.timeoutMs < 5000 ||
    options.timeoutMs > 120000
  )
    throw new Error("--timeout-ms must be an integer from 5000 to 120000.");
  if (!/^[a-z]{2}(?:-gov)?-[a-z]+-\d+$/.test(options.sendRegion))
    throw new Error("Invalid --send-region.");
  if (options.readerRoleArn === options.senderRoleArn)
    throw new Error("Reader and sender roles must be distinct.");
  if (options.readerSessionFile === options.senderSessionFile)
    throw new Error("Reader and sender session files must be distinct.");
  const from = normalizeAddress(options.from);
  const reader = await restrictedSession(
    options.readerSessionFile,
    options.readerRoleArn,
    options.account,
    options.config.region,
    options.timeoutMs,
  );
  const sender = await restrictedSession(
    options.senderSessionFile,
    options.senderRoleArn,
    options.account,
    options.sendRegion,
    options.timeoutMs,
  );
  assertDistinctRoleIds(reader.roleId, sender.roleId);
  const directConfig = { ...options.config, roleArn: undefined };
  const hail = new Hail(
    directConfig,
    new S3MailStore(
      directConfig,
      new S3Client({
        region: options.config.region,
        credentials: reader.credentials,
        maxAttempts: 2,
      }),
    ),
  );
  const ses = new SESClient({
    region: options.sendRegion,
    credentials: sender.credentials,
    maxAttempts: 1,
  });
  try {
    return await runSmoke(
      hail,
      from,
      options.timeoutMs,
      async (to, subject, body) => {
        requireSessionLifetime(reader.expiration, options.timeoutMs);
        requireSessionLifetime(sender.expiration, 20_000);
        try {
          const raw = [
            `From: ${from}`,
            `To: ${to}`,
            `Subject: ${subject}`,
            "MIME-Version: 1.0",
            "Content-Type: text/plain; charset=utf-8",
            "",
            body,
            "",
          ].join("\r\n");
          await ses.send(
            new SendRawEmailCommand({
              Source: from,
              Destinations: [to],
              RawMessage: { Data: Buffer.from(raw) },
            }),
            { abortSignal: AbortSignal.timeout(20_000) },
          );
        } catch (error) {
          if (
            error instanceof Error &&
            ["AccessDenied", "AccessDeniedException"].includes(error.name)
          )
            throw Object.assign(new Error("Sender access denied."), {
              name: "SmokeSenderAccessDenied",
            });
          throw error;
        }
      },
    );
  } finally {
    ses.destroy();
  }
}
