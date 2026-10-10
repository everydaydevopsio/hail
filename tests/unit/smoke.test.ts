import { test } from "node:test";
import assert from "node:assert/strict";
import { Hail } from "../../src/index.js";
import { MemoryStore, config } from "../helpers/memory-store.js";
import {
  runSmoke,
  smokeFailure,
  smokeCredentialSources,
} from "../../src/smoke.js";

test("smoke uses a new in-domain recipient and matches sender, subject, and body", async () => {
  const store = new MemoryStore();
  const hail = new Hail(config, store);
  const addresses = new Set<string>();
  for (let i = 0; i < 2; i++) {
    let expectedResult = "";
    const result = await runSmoke(
      hail,
      "sender@example.test",
      5000,
      async (to, subject, body) => {
        assert.match(to, /^smoke-[a-f0-9]{32}@mail\.example\.test$/);
        assert.match(subject, /^Hail smoke [a-f0-9-]+$/);
        assert.match(
          body,
          /^(?:Hello from Hail|This is a delivery check|Hail is checking this inbox)\. Ref: [a-f0-9-]+$/,
        );
        expectedResult = [
          "PASS: one synthetic message reached the intended Hail inbox.",
          "Received email:",
          "  From: sender@example.test",
          `  To: ${to}`,
          `  Subject: ${subject}`,
          `  Text: ${body}`,
        ].join("\n");
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
    assert.equal(result, expectedResult);
    assert.doesNotMatch(result, /wrong marker|wrong@example.test/);
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

test("smoke uses selected profile and configured reader role without extra flags", () => {
  const calls: string[] = [];
  const providers = {
    fromProfile: (profile: string) => {
      calls.push(`profile:${profile}`);
      return `source:${profile}`;
    },
    assumeReader: (
      roleArn: string,
      region: string,
      source: string | undefined,
    ) => {
      calls.push(`assume:${roleArn}:${region}:${source}`);
      return "reader";
    },
  };
  assert.deepEqual(smokeCredentialSources(config, undefined, providers), {
    sender: undefined,
    reader: undefined,
  });
  assert.deepEqual(smokeCredentialSources(config, "hail-test", providers), {
    sender: "source:hail-test",
    reader: "source:hail-test",
  });
  assert.deepEqual(
    smokeCredentialSources(
      { ...config, roleArn: "arn:aws:iam::123456789012:role/hail-reader" },
      "hail-test",
      providers,
    ),
    { sender: "source:hail-test", reader: "reader" },
  );
  assert.deepEqual(
    smokeCredentialSources(
      { ...config, roleArn: "arn:aws:iam::123456789012:role/hail-reader" },
      undefined,
      providers,
    ),
    { sender: undefined, reader: "reader" },
  );
  assert.deepEqual(calls, [
    "profile:hail-test",
    "profile:hail-test",
    "assume:arn:aws:iam::123456789012:role/hail-reader:us-east-1:source:hail-test",
    "assume:arn:aws:iam::123456789012:role/hail-reader:us-east-1:undefined",
  ]);
});
