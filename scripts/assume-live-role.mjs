import { execFileSync } from "node:child_process";
import { mkdir, open, rename, stat } from "node:fs/promises";
import { resolve } from "node:path";

const [
  role,
  run,
  account,
  directory,
  expectedSourceArn,
  profile = "biokeytic",
] = process.argv.slice(2);
if (
  !new Set(["provisioner", "reader", "sender"]).has(role) ||
  !/^hail-[a-z0-9-]{1,40}$/.test(run ?? "") ||
  !/^\d{12}$/.test(account ?? "") ||
  !directory ||
  !expectedSourceArn
) {
  throw new Error(
    "Usage: node scripts/assume-live-role.mjs provisioner|reader|sender RUN ACCOUNT PRIVATE_DIR EXPECTED_SOURCE_ARN [BOOTSTRAP_PROFILE]",
  );
}
const source = JSON.parse(
  execFileSync(
    "aws",
    ["sts", "get-caller-identity", "--profile", profile, "--output", "json"],
    { encoding: "utf8" },
  ),
);
if (source.Account !== account || source.Arn !== expectedSourceArn)
  throw new Error("Bootstrap profile identity mismatch.");
const roleArn = `arn:aws:iam::${account}:role/${run}-${role}`;
const result = JSON.parse(
  execFileSync(
    "aws",
    [
      "sts",
      "assume-role",
      "--profile",
      profile,
      "--role-arn",
      roleArn,
      "--role-session-name",
      `hail-${role}-${Date.now()}`,
      "--duration-seconds",
      "3600",
      "--output",
      "json",
    ],
    { encoding: "utf8" },
  ),
);
if (
  !result.AssumedRoleUser?.Arn.startsWith(
    `arn:aws:sts::${account}:assumed-role/${run}-${role}/`,
  )
)
  throw new Error("Assumed role identity mismatch.");
await mkdir(directory, { recursive: true, mode: 0o700 });
if ((await stat(directory)).mode & 0o077)
  throw new Error("Session directory must be private (0700).");
const target = resolve(directory, `${role}.json`);
const pending = `${target}.${process.pid}.tmp`;
const file = await open(pending, "wx", 0o600);
try {
  await file.writeFile(
    JSON.stringify({
      accessKeyId: result.Credentials.AccessKeyId,
      secretAccessKey: result.Credentials.SecretAccessKey,
      sessionToken: result.Credentials.SessionToken,
      expiration: result.Credentials.Expiration,
    }),
  );
} finally {
  await file.close();
}
await rename(pending, target);
process.stdout.write(`Created restricted ${role} session at ${target}\n`);
