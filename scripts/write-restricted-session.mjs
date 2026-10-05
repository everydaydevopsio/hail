import { writeFile } from "node:fs/promises";

const destination = process.argv[2];
if (
  !destination ||
  !process.env.AWS_ACCESS_KEY_ID ||
  !process.env.AWS_SECRET_ACCESS_KEY ||
  !process.env.AWS_SESSION_TOKEN
)
  throw new Error(
    "A short-lived assumed role session and private destination are required.",
  );
const session = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  sessionToken: process.env.AWS_SESSION_TOKEN,
  // The workflow requests a 3600-second OIDC session; testing stops before 30 minutes.
  expiration: new Date(Date.now() + 30 * 60_000).toISOString(),
};
await writeFile(destination, JSON.stringify(session), {
  mode: 0o600,
  flag: "wx",
});
