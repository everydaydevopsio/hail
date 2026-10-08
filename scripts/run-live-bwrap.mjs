import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [phase, role, account, run, sessionPath, runDir, ...command] =
  process.argv.slice(2);
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const region = process.env.HAIL_LIVE_REGION;
if (
  !["provisioner", "reader", "sender"].includes(role) ||
  !["terraform", "node", "browser"].includes(phase) ||
  !/^\d{12}$/.test(account ?? "") ||
  !/^hail-[a-z0-9-]+$/.test(run ?? "") ||
  !/^[a-z]{2}-[a-z]+-\d$/.test(region ?? "") ||
  !sessionPath ||
  !runDir ||
  !command.length
)
  throw new Error(
    "HAIL_LIVE_REGION and phase role account runId sessionFile privateDir command required",
  );
const node = process.execPath;
const nodeDir = dirname(dirname(node));
const home = process.env.HOME;
if (!home || !repo.startsWith(`${home}/`))
  throw new Error("Repository must be under the operator home");
const parent = dirname(repo);
const grandparent = dirname(parent);
const args = [
  "--ro-bind",
  "/",
  "/",
  "--tmpfs",
  home,
  "--tmpfs",
  "/tmp",
  "--tmpfs",
  "/run",
  "--tmpfs",
  "/root",
  "--dev-bind",
  "/dev",
  "/dev",
  "--proc",
  "/proc",
  "--dir",
  "/run/systemd",
  "--dir",
  "/run/systemd/resolve",
  "--ro-bind",
  "/run/systemd/resolve/stub-resolv.conf",
  "/run/systemd/resolve/stub-resolv.conf",
  "--dir",
  grandparent,
  "--dir",
  parent,
  "--dir",
  dirname(dirname(dirname(nodeDir))),
  "--dir",
  dirname(dirname(nodeDir)),
  "--dir",
  dirname(nodeDir),
  "--dir",
  `${home}/.terraform.d`,
  "--dir",
  `${home}/.config`,
  "--dir",
  `${home}/.cache`,
  "--dir",
  "/tmp/private",
  "--bind",
  repo,
  repo,
  "--ro-bind",
  nodeDir,
  nodeDir,
  "--bind",
  `${home}/.terraform.d/plugin-cache`,
  `${home}/.terraform.d/plugin-cache`,
  "--ro-bind",
  `${home}/.config/tfenv`,
  `${home}/.config/tfenv`,
  "--ro-bind",
  sessionPath,
  "/tmp/session.json",
  "--bind",
  runDir,
  "/tmp/private",
];
if (phase === "browser") {
  args.push(
    "--dir",
    "/tmp/.cache",
    "--dir",
    "/tmp/.cache/ms-playwright",
    "--ro-bind",
    `${home}/.cache/ms-playwright`,
    "/tmp/.cache/ms-playwright",
  );
  const senderFile = process.env.HAIL_LIVE_SENDER_SESSION_FILE;
  if (!senderFile) throw new Error("Browser sender session required");
  args.push("--ro-bind", senderFile, "/tmp/sender-session.json");
}
if (phase === "terraform" && process.env.HAIL_LIVE_CLOUDFLARE_TOKEN_FILE)
  args.push(
    "--ro-bind",
    process.env.HAIL_LIVE_CLOUDFLARE_TOKEN_FILE,
    "/tmp/cloudflare-token",
  );
if (phase === "terraform" && process.env.HAIL_LIVE_STATE_DIR)
  args.push(
    "--dir",
    "/tmp/state",
    "--bind",
    process.env.HAIL_LIVE_STATE_DIR,
    "/tmp/state",
  );
args.push(
  "--chdir",
  process.env.HAIL_LIVE_WORKDIR === "consumer" ? "/tmp/private" : repo,
  "--clearenv",
  "--setenv",
  "PATH",
  `${nodeDir}/bin:/usr/local/bin:/usr/bin:/bin`,
  "--setenv",
  "HOME",
  "/tmp",
  "--setenv",
  "AWS_SHARED_CREDENTIALS_FILE",
  "/dev/null",
  "--setenv",
  "AWS_CONFIG_FILE",
  "/dev/null",
  "--setenv",
  "AWS_EC2_METADATA_DISABLED",
  "true",
  "--setenv",
  "TF_PLUGIN_CACHE_DIR",
  `${home}/.terraform.d/plugin-cache`,
  "--setenv",
  "TFENV_CONFIG_DIR",
  `${home}/.config/tfenv`,
  "--setenv",
  "AWS_REGION",
  region,
  "--setenv",
  "AWS_DEFAULT_REGION",
  region,
);
if (phase === "browser")
  args.push(
    "--setenv",
    "HAIL_READER_SESSION_FILE",
    "/tmp/session.json",
    "--setenv",
    "HAIL_SENDER_SESSION_FILE",
    "/tmp/sender-session.json",
  );
for (const key of [
  "HAIL_LIVE",
  "HAIL_CONFIG",
  "HAIL_FROM",
  "HAIL_SEND_REGION",
  "HAIL_EXPECTED_ACCOUNT",
  "HAIL_READER_ROLE_ARN",
  "HAIL_SENDER_ROLE_ARN",
  "HAIL_LIVE_RUN_DIR",
  "CLOUDFLARE_API_TOKEN",
])
  if (process.env[key]) {
    if (key === "CLOUDFLARE_API_TOKEN")
      throw new Error(
        "Pass Cloudflare token through a private mounted file, not argv",
      );
    args.push("--setenv", key, process.env[key]);
  }
const code = `const fs=require('fs');const s=JSON.parse(fs.readFileSync('/tmp/session.json','utf8'));if(!s.accessKeyId||!s.secretAccessKey||!s.sessionToken||Date.parse(s.expiration)<Date.now()+120000)throw Error('Session expired');const e={...process.env,AWS_ACCESS_KEY_ID:s.accessKeyId,AWS_SECRET_ACCESS_KEY:s.secretAccessKey,AWS_SESSION_TOKEN:s.sessionToken};if(fs.existsSync('/tmp/cloudflare-token'))e.CLOUDFLARE_API_TOKEN=fs.readFileSync('/tmp/cloudflare-token','utf8').trim();const cp=require('child_process');const id=JSON.parse(cp.execFileSync('aws',['sts','get-caller-identity','--output','json'],{env:e,encoding:'utf8'}));if(id.Account!==${JSON.stringify(account)}||!id.Arn.startsWith(${JSON.stringify(`arn:aws:sts::${account}:assumed-role/${run}-${role}/`)}))throw Error('Restricted role identity mismatch');console.error('Validated '+${JSON.stringify(role)}+' role in '+id.Account);const r=cp.spawnSync(process.argv[1],process.argv.slice(2),{stdio:'inherit',env:e});process.exit(r.status??1);`;
args.push("--", node, "-e", code, ...command);
const result = spawnSync("bwrap", args, {
  stdio: "inherit",
  env: { PATH: process.env.PATH },
  timeout: 45 * 60_000,
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
