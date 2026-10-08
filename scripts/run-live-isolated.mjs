import { spawnSync } from "node:child_process";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const [phase, sessionPath, runDirectory, ...command] = process.argv.slice(2);
const images = {
  terraform: "hashicorp/terraform:1.9.8",
  node: "node:22-bookworm",
  browser: "mcr.microsoft.com/playwright:v1.63.0-noble",
};
if (!(phase in images) || !sessionPath || !runDirectory || command.length === 0)
  throw new Error(
    "Usage: node scripts/run-live-isolated.mjs terraform|node|browser SESSION_JSON PRIVATE_RUN_DIR COMMAND...",
  );
const session = JSON.parse(await readFile(sessionPath, "utf8"));
if (
  !session.accessKeyId ||
  !session.secretAccessKey ||
  !session.sessionToken ||
  Date.parse(session.expiration) <= Date.now() + 120_000
)
  throw new Error("Restricted session is missing or expires too soon.");
const temporary = await mkdtemp(join(tmpdir(), "hail-env-"));
const envFile = join(temporary, "credentials.env");
const safe = (value) => {
  if (typeof value !== "string" || /[\r\n]/.test(value))
    throw new Error("Invalid environment value.");
  return value;
};
await writeFile(
  envFile,
  [
    `AWS_ACCESS_KEY_ID=${safe(session.accessKeyId)}`,
    `AWS_SECRET_ACCESS_KEY=${safe(session.secretAccessKey)}`,
    `AWS_SESSION_TOKEN=${safe(session.sessionToken)}`,
    "AWS_REGION=us-east-1",
    "AWS_DEFAULT_REGION=us-east-1",
    "AWS_EC2_METADATA_DISABLED=true",
    "AWS_SHARED_CREDENTIALS_FILE=/dev/null",
    "AWS_CONFIG_FILE=/dev/null",
    "HOME=/tmp",
    ...(phase === "browser"
      ? [
          "HAIL_READER_SESSION_FILE=/private/reader-session.json",
          "HAIL_SENDER_SESSION_FILE=/private/sender-session.json",
        ]
      : []),
    ...[
      "HAIL_CONFIG",
      "HAIL_FROM",
      "HAIL_SEND_REGION",
      "HAIL_EXPECTED_ACCOUNT",
      "HAIL_READER_ROLE_ARN",
      "HAIL_SENDER_ROLE_ARN",
      "HAIL_LIVE_RUN_DIR",
    ]
      .filter((key) => process.env[key] !== undefined)
      .map((key) => `${key}=${safe(process.env[key])}`),
  ].join("\n") + "\n",
  { mode: 0o600 },
);
try {
  if (resolve(sessionPath).startsWith(`${resolve(runDirectory)}/`))
    throw new Error("Keep session files outside the mounted run directory.");
  const args = [
    "run",
    "--rm",
    "--init",
    "--network",
    "host",
    "--user",
    `${process.getuid()}:${process.getgid()}`,
    "--env-file",
    envFile,
  ];
  if (process.env.HAIL_LIVE_EXTRA_ENV_FILE) {
    if (phase !== "terraform")
      throw new Error(
        "Extra provider secrets are allowed only in the Terraform provisioner phase.",
      );
    args.push("--env-file", resolve(process.env.HAIL_LIVE_EXTRA_ENV_FILE));
  }
  args.push(
    "--mount",
    `type=bind,src=${resolve(process.cwd())},dst=/workspace`,
    "--mount",
    `type=bind,src=${resolve(runDirectory)},dst=/private`,
    "--workdir",
    "/workspace",
    "--entrypoint",
    command[0],
    images[phase],
    ...command.slice(1),
  );
  if (phase === "browser") {
    const senderPath = process.env.HAIL_LIVE_SENDER_SESSION_FILE;
    if (!senderPath)
      throw new Error("Browser phase requires HAIL_LIVE_SENDER_SESSION_FILE.");
    args.splice(
      args.indexOf("--workdir"),
      0,
      "--mount",
      `type=bind,src=${resolve(sessionPath)},dst=/private/reader-session.json,readonly`,
      "--mount",
      `type=bind,src=${resolve(senderPath)},dst=/private/sender-session.json,readonly`,
    );
  }
  const result = spawnSync("docker", args, {
    stdio: "inherit",
    env: { PATH: process.env.PATH },
    timeout: 45 * 60_000,
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  await rm(temporary, { recursive: true, force: true });
}
