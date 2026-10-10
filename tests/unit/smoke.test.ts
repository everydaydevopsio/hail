import { test } from "node:test";
import assert from "node:assert/strict";
import { Hail } from "../../src/index.js";
import { MemoryStore, config } from "../helpers/memory-store.js";
import {
  runSmoke,
  smokeFailure,
  verifiedRoleId,
  requireSessionLifetime,
  assertDistinctRoleIds,
} from "../../src/smoke.js";

test("smoke uses a new in-domain recipient and matches sender, subject, and body", async () => {
  const store = new MemoryStore();
  const hail = new Hail(config, store);
  const addresses = new Set<string>();
  for (let i = 0; i < 2; i++) {
    const result = await runSmoke(
      hail,
      "sender@example.test",
      5000,
      async (to, subject, body) => {
        assert.match(to, /^smoke-[a-f0-9]{32}@mail\.example\.test$/);
        assert.match(subject, /^Hail smoke [a-f0-9-]+$/);
        assert.match(body, /^Synthetic Hail delivery check: [a-f0-9-]+$/);
        addresses.add(to);
        store.add(
          to,
          `From: Wrong <wrong@example.test>\r\nTo: ${to}\r\nSubject: ${subject}\r\n\r\n${body}`,
        );
        store.add(
          to,
          `From: sender@example.test\r\nTo: ${to}\r\nSubject: ${subject}\r\n\r\nwrong marker`,
        );
        store.add(
          to,
          `From: sender@example.test\r\nTo: ${to}\r\nSubject: ${subject}\r\n\r\n${body}`,
        );
      },
    );
    assert.equal(
      result,
      "PASS: one synthetic message reached the intended Hail inbox.",
    );
  }
  assert.equal(addresses.size, 2);
});

test("smoke times out and diagnostics never include message content or credentials", async () => {
  const secret = "secret-auth-url-and-credentials";
  const hail = new Hail(config, new MemoryStore());
  await assert.rejects(
    runSmoke(hail, "sender@example.test", 20, async () => {}),
    (error: unknown) => {
      assert.equal(
        smokeFailure(error),
        "FAIL: delivery or ingestion timed out; inspect DNS, SES receipt rules, and the ingestion DLQ.",
      );
      assert.doesNotMatch(smokeFailure(error), /secret|https?:\/\//);
      return true;
    },
  );
  assert.equal(
    smokeFailure(Object.assign(new Error(secret), { name: "AccessDenied" })),
    "FAIL: reader access was denied.",
  );
  assert.equal(
    smokeFailure(Object.assign(new Error(secret), { name: "MessageRejected" })),
    "FAIL: SES rejected the sender or recipient.",
  );
  assert.equal(
    smokeFailure(new Error(secret)),
    "FAIL: smoke check failed; inspect restricted credentials and receiver health.",
  );
});

test("restricted identity checks ARN account and actual role IDs", () => {
  const expected = "arn:aws:iam::123456789012:role/hail-reader";
  const actual = "arn:aws:sts::123456789012:assumed-role/hail-reader/run";
  assert.equal(
    verifiedRoleId(
      expected,
      "123456789012",
      actual,
      "123456789012",
      "AROA123:run",
    ),
    "AROA123",
  );
  assert.throws(() =>
    verifiedRoleId(
      "arn:aws:iam::999999999999:role/hail-reader",
      "123456789012",
      actual,
      "123456789012",
      "AROA123:run",
    ),
  );
  assert.throws(() =>
    verifiedRoleId(
      expected,
      "123456789012",
      actual,
      "123456789012",
      "bad-user-id",
    ),
  );
  assert.throws(() => assertDistinctRoleIds("AROA123", "AROA123"));
  assert.doesNotThrow(() => assertDistinctRoleIds("AROA123", "AROA456"));
});

test("session lifetime is checked again after setup for the send and receipt wait", () => {
  const now = Date.now();
  assert.throws(() =>
    requireSessionLifetime(new Date(now + 65_000), 60_000, now),
  );
  assert.doesNotThrow(() =>
    requireSessionLifetime(new Date(now + 91_000), 60_000, now),
  );
});
