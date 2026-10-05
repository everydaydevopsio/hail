import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import type { S3Client } from "@aws-sdk/client-s3";
import { S3MailStore, awsCredentials } from "../../src/store.js";
import { config, rawMail } from "../helpers/memory-store.js";

function fake(
  send: (command: { input: Record<string, unknown> }) => Promise<unknown>,
) {
  return { send } as unknown as S3Client;
}
const recipient = "test@" + config.domain;
test("follows every S3 listing page and sorts deterministically", async () => {
  const calls: unknown[] = [];
  const client = fake(async (command) => {
    calls.push(command.input.ContinuationToken);
    return command.input.ContinuationToken
      ? {
          Contents: [
            { Key: `index/${recipient}/old.json`, LastModified: new Date(1) },
          ],
        }
      : {
          Contents: [
            { Key: `index/${recipient}/new.json`, LastModified: new Date(2) },
          ],
          IsTruncated: true,
          NextContinuationToken: "page-2",
        };
  });
  const messages = await new S3MailStore(config, client).list(recipient);
  assert.deepEqual(calls, [undefined, "page-2"]);
  assert.ok(messages[0].key.endsWith("/old.json"));
});
test("supports the original recipient/message.eml storage layout", async () => {
  const client = fake(async (command) => {
    if ("Prefix" in command.input) {
      assert.equal(command.input.Prefix, `${recipient}/`);
      return {
        Contents: [
          { Key: `${recipient}/legacy.eml`, LastModified: new Date(42) },
        ],
      };
    }
    return { Body: Readable.from([Buffer.from(rawMail("Legacy"))]) };
  });
  const store = new S3MailStore({ ...config, layout: "legacy" }, client);
  const [ref] = await store.list(recipient);
  const message = await store.get(ref, recipient);
  assert.equal(message.receivedAt.getTime(), 42);
});
test("reads indexed metadata then the raw MIME object", async () => {
  const keys: unknown[] = [];
  const client = fake(async (command) => {
    keys.push(command.input.Key);
    const content = String(command.input.Key).startsWith("index/")
      ? JSON.stringify({
          schemaVersion: 1,
          recipient,
          rawKey: "incoming/id123",
          receivedAt: "2026-09-29T00:00:00Z",
          delivery: { dkimVerdict: "PASS" },
        })
      : rawMail("Indexed");
    return { Body: Readable.from([Buffer.from(content)]) };
  });
  const key = `index/${recipient}/id123.json`;
  const message = await new S3MailStore(config, client).get(
    { id: key, key, receivedAt: new Date(0) },
    recipient,
  );
  assert.deepEqual(keys, [key, "incoming/id123"]);
  assert.equal(message.delivery?.dkimVerdict, "PASS");
  assert.equal(message.receivedAt.toISOString(), "2026-09-29T00:00:00.000Z");
});
test("does not permit cross-mailbox key reads", async () => {
  let calls = 0;
  const store = new S3MailStore(
    config,
    fake(async () => {
      calls++;
      return {};
    }),
  );
  await assert.rejects(
    store.get(
      {
        id: "bad",
        key: "index/other@" + config.domain + "/secret.json",
        receivedAt: new Date(),
      },
      recipient,
    ),
  );
  assert.equal(calls, 0);
});
test("rejects corrupted metadata that points outside the raw prefix", async () => {
  const store = new S3MailStore(
    config,
    fake(async () => ({
      Body: Readable.from([
        JSON.stringify({
          schemaVersion: 1,
          recipient,
          rawKey: "other/secret",
          receivedAt: new Date().toISOString(),
        }),
      ]),
    })),
  );
  const key = `index/${recipient}/id.json`;
  await assert.rejects(
    store.get({ id: key, key, receivedAt: new Date() }, recipient),
    /Invalid mailbox metadata/,
  );
});
test("fails closed on a truncated listing without a continuation token", async () => {
  await assert.rejects(
    new S3MailStore(
      config,
      fake(async () => ({ IsTruncated: true })),
    ).list(recipient),
    /pagination cursor/,
  );
});
test("enforces a streaming size limit even without ContentLength", async () => {
  const store = new S3MailStore(
    { ...config, layout: "legacy" },
    fake(async () => ({
      Body: Readable.from([Buffer.alloc(20), Buffer.alloc(20)]),
    })),
    32,
  );
  const key = `${recipient}/id.eml`;
  await assert.rejects(
    store.get({ id: key, key, receivedAt: new Date() }, recipient),
    /size limit/,
  );
});
test("uses a refreshable credential provider when assuming a role", () => {
  assert.equal(
    typeof awsCredentials({
      ...config,
      roleArn: "arn:aws:iam::123456789012:role/hail-reader",
    }),
    "function",
  );
  assert.equal(awsCredentials(config), undefined);
});
