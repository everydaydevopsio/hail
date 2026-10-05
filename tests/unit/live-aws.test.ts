import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { countLiveSend } from "../helpers/live-aws.js";

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
