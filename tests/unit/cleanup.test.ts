import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

test("mail purge refuses a bucket outside the private run manifest before AWS calls", () => {
  const dir = mkdtempSync(join(tmpdir(), "hail-cleanup-"));
  try {
    const manifest = join(dir, "manifest.json");
    writeFileSync(
      manifest,
      JSON.stringify({
        runId: "hail-test-123",
        accountId: "123456789012",
        region: "us-east-1",
        retention: "destroy-after-validation",
        receiver: { bucket: "hail-test-123-owned", status: "deployed" },
      }),
      { mode: 0o600 },
    );
    const result = spawnSync(
      process.execPath,
      [
        resolve("scripts/cleanup-live-bucket.mjs"),
        manifest,
        "unrelated-bucket",
      ],
      {
        encoding: "utf8",
        env: {
          PATH: process.env.PATH ?? "",
          AWS_CONFIG_FILE: "/dev/null",
          AWS_SHARED_CREDENTIALS_FILE: "/dev/null",
          AWS_EC2_METADATA_DISABLED: "true",
        },
      },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Receiver manifest ownership mismatch/);
    assert.doesNotMatch(result.stderr, /AccessDenied|CredentialsProviderError/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
