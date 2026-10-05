import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  countLiveSend,
  assertDistinctLiveRoles,
  validSessionExpiration,
} from "../helpers/live-aws.js";

test("live reader and sender roles must be separate", () => {
  const role = "arn:aws:iam::123456789012:role/hail-test-reader";
  assert.throws(() => assertDistinctLiveRoles(role, role), /distinct/);
  assert.doesNotThrow(() =>
    assertDistinctLiveRoles(
      role,
      "arn:aws:iam::123456789012:role/hail-test-sender",
    ),
  );
});

test("malformed or too-short session expiration fails before STS", () => {
  assert.throws(() => validSessionExpiration("not-a-date"), /expires too soon/);
  assert.throws(
    () => validSessionExpiration(new Date(Date.now() + 60_000).toISOString()),
    /expires too soon/,
  );
  assert.doesNotThrow(() =>
    validSessionExpiration(new Date(Date.now() + 20 * 60_000).toISOString()),
  );
});

test("live send budget is shared across concurrent workers and counts attempts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hail-budget-"));
  try {
    await writeFile(join(directory, "send-count.json"), '{"count":190}', {
      mode: 0o600,
    });
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => countLiveSend(directory)),
    );
    assert.equal(
      results.filter((result) => result.status === "fulfilled").length,
      10,
    );
    assert.equal(
      results.filter((result) => result.status === "rejected").length,
      10,
    );
    assert.deepEqual(
      JSON.parse(await readFile(join(directory, "send-count.json"), "utf8")),
      { count: 200 },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
