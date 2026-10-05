import { open, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import type { AwsCredentialIdentity } from "@aws-sdk/types";

type Session = {
  credentials: AwsCredentialIdentity;
  roleArn: string;
  account: string;
};

export function assertDistinctLiveRoles(
  readerArn: string | undefined,
  senderArn: string | undefined,
): void {
  if (!readerArn || !senderArn || readerArn === senderArn)
    throw new Error("Live reader and sender roles must be distinct.");
}

export function validSessionExpiration(value: unknown): Date {
  const timestamp = typeof value === "string" ? Date.parse(value) : NaN;
  if (!Number.isFinite(timestamp) || timestamp < Date.now() + 15 * 60_000)
    throw new Error("Restricted session is missing or expires too soon.");
  return new Date(timestamp);
}

export async function loadRestrictedSession(
  file: string | undefined,
  expectedRoleArn: string | undefined,
  expectedAccount: string | undefined,
  region: string,
): Promise<Session> {
  if (!file || !expectedRoleArn || !expectedAccount)
    throw new Error(
      "Live tests require an explicit restricted session file, role ARN, and account.",
    );
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
  if (
    typeof data.accessKeyId !== "string" ||
    typeof data.secretAccessKey !== "string" ||
    typeof data.sessionToken !== "string"
  )
    throw new Error("Restricted session is missing or expires too soon.");
  const expiration = validSessionExpiration(data.expiration);
  const credentials: AwsCredentialIdentity = {
    accessKeyId: data.accessKeyId,
    secretAccessKey: data.secretAccessKey,
    sessionToken: data.sessionToken,
    expiration,
  };
  const sts = new STSClient({ region, credentials, maxAttempts: 1 });
  const identity = await sts.send(new GetCallerIdentityCommand({}), {
    abortSignal: AbortSignal.timeout(10_000),
  });
  const roleName = expectedRoleArn.split("/").at(-1);
  if (
    !/^\d{12}$/.test(expectedAccount) ||
    identity.Account !== expectedAccount ||
    !roleName ||
    !identity.Arn?.startsWith(
      `arn:aws:sts::${expectedAccount}:assumed-role/${roleName}/`,
    )
  )
    throw new Error(
      "Restricted session identity did not match the approved account and role.",
    );
  return { credentials, roleArn: expectedRoleArn, account: expectedAccount };
}

/** Counts attempted sends before calling SES, across all workers and runs sharing this directory. */
export async function countLiveSend(
  runDirectory: string | undefined,
): Promise<void> {
  if (!runDirectory)
    throw new Error(
      "HAIL_LIVE_RUN_DIR is required for the shared send budget.",
    );
  const info = await stat(runDirectory);
  if (
    !info.isDirectory() ||
    (info.mode & 0o077) !== 0 ||
    info.uid !== process.getuid?.()
  )
    throw new Error(
      "Live run directory must be owned by this user and mode 0700.",
    );
  const lock = join(runDirectory, "send-count.lock");
  const counter = join(runDirectory, "send-count.json");
  let handle;
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      handle = await open(lock, "wx", 0o600);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await delay(20);
    }
  }
  if (!handle) throw new Error("Could not acquire the live send budget lock.");
  try {
    let count = 0;
    try {
      const parsed = JSON.parse(await readFile(counter, "utf8")) as {
        count: number;
      };
      if (!Number.isSafeInteger(parsed.count) || parsed.count < 0)
        throw new Error("Invalid live send counter.");
      count = parsed.count;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (count >= 200)
      throw new Error("The 200-message live send budget is exhausted.");
    await writeFile(counter, JSON.stringify({ count: count + 1 }), {
      mode: 0o600,
    });
  } finally {
    await handle.close();
    await unlink(lock);
  }
}
