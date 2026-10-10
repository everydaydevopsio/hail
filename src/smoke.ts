import { randomInt, randomUUID } from "node:crypto";
import { SESClient, SendRawEmailCommand } from "@aws-sdk/client-ses";
import { S3Client } from "@aws-sdk/client-s3";
import {
  fromIni,
  fromTemporaryCredentials,
} from "@aws-sdk/credential-providers";
import type { AwsCredentialIdentityProvider } from "@aws-sdk/types";
import { Hail, EmailTimeoutError } from "./index.js";
import { normalizeAddress, type HailConfig } from "./config.js";
import { S3MailStore } from "./store.js";

const pass = "PASS: one synthetic message reached the intended Hail inbox.";
const shortTexts = [
  "Hello from Hail",
  "This is a delivery check",
  "Hail is checking this inbox",
] as const;

export class SmokeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SmokeValidationError";
  }
}

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
  const body = `${shortTexts[randomInt(shortTexts.length)]}. Ref: ${marker}`;
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
      return [
        pass,
        "Received email:",
        `  From: ${message.from}`,
        `  To: ${message.recipient}`,
        `  Subject: ${message.subject}`,
        `  Text: ${message.text.trim()}`,
      ].join("\n");
  }
  throw new Error("Too many nonmatching messages.");
}

export function smokeFailure(error: unknown): string {
  if (error instanceof SmokeValidationError)
    return `FAIL: ${error.message} Run hail smoke --help.`;
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

type CredentialProvider = AwsCredentialIdentityProvider;

export function smokeCredentialSources<T>(
  config: HailConfig,
  profile: string | undefined,
  providers: {
    fromProfile: (profile: string) => T;
    assumeReader: (roleArn: string, region: string, source: T | undefined) => T;
  },
): { sender: T | undefined; reader: T | undefined } {
  const sender = profile ? providers.fromProfile(profile) : undefined;
  const reader = config.roleArn
    ? providers.assumeReader(config.roleArn, config.region, sender)
    : sender;
  return { sender, reader };
}

export interface SmokeOptions {
  config: HailConfig;
  from: string;
  timeoutMs: number;
  profile?: string;
}

export async function smoke(options: SmokeOptions): Promise<string> {
  if (
    !Number.isInteger(options.timeoutMs) ||
    options.timeoutMs < 5000 ||
    options.timeoutMs > 120000
  )
    throw new SmokeValidationError(
      "--timeout-ms must be an integer from 5000 to 120000.",
    );
  if (
    options.profile !== undefined &&
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(options.profile)
  )
    throw new SmokeValidationError(
      "--profile must be a valid AWS profile name.",
    );
  let from: string;
  try {
    from = normalizeAddress(options.from);
  } catch {
    throw new SmokeValidationError(
      "--from must be a valid simple email address.",
    );
  }
  const credentials = smokeCredentialSources<CredentialProvider>(
    options.config,
    options.profile,
    {
      fromProfile: (profile) => fromIni({ profile }),
      assumeReader: (roleArn, region, source) =>
        fromTemporaryCredentials({
          clientConfig: { region },
          masterCredentials: source,
          params: { RoleArn: roleArn, RoleSessionName: "hail-smoke-reader" },
        }),
    },
  );
  const hail = new Hail(
    options.config,
    new S3MailStore(
      options.config,
      new S3Client({
        region: options.config.region,
        credentials: credentials.reader,
        maxAttempts: 2,
      }),
    ),
  );
  const ses = new SESClient({
    region: options.config.region,
    credentials: credentials.sender,
    maxAttempts: 1,
  });
  try {
    return await runSmoke(
      hail,
      from,
      options.timeoutMs,
      async (to, subject, body) => {
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
