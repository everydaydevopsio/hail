import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import { performance } from 'node:perf_hooks';
import { Hail, EmailMessage, EmailTimeoutError, parseConfig, normalizeAddress } from '../../src/index.js';
import { MemoryStore, config, rawMail } from '../helpers/memory-store.js';

function setup() { const store = new MemoryStore(); const hail = new Hail(config, store); return { store, hail, inbox: hail.createInbox('test') }; }
async function parse(html: string) { return EmailMessage.parse({ id: 'test', recipient: 'test@mail.example.test', receivedAt: new Date(), raw: rawMail('Login', '', html) }); }

test('generates unique, bounded addresses without provisioning mailboxes', () => {
  const { hail } = setup();
  const addresses = new Set(Array.from({ length: 1000 }, () => hail.createInbox('worker-123-retry-123-browser').address));
  assert.equal(addresses.size, 1000);
  for (const address of addresses) assert.ok(address.split('@')[0].length <= 64);
});
test('rejects cross-domain mailboxes and unsafe key characters', () => {
  const { hail } = setup();
  assert.throws(() => hail.inbox('someone@evil.example.test'));
  assert.throws(() => normalizeAddress('../other@' + config.domain));
  assert.throws(() => normalizeAddress('a/b@' + config.domain));
});
test('configuration fails closed on unsupported schemas and layouts', () => {
  assert.throws(() => parseConfig({ ...config, schemaVersion: 2 }));
  assert.throws(() => parseConfig({ ...config, layout: 'future' }));
  assert.throws(() => parseConfig({ ...config, domain: 'not a domain' }));
  assert.equal(parseConfig({ ...config, extraSecret: 'not-copied' }).domain, config.domain);
  assert.ok(!JSON.stringify(parseConfig({ ...config, extraSecret: 'not-copied' })).includes('not-copied'));
});
test('checkpoint ignores already-indexed mail', async () => {
  const { store, inbox } = setup();
  store.add(inbox.address, rawMail('Sign in', 'stale'));
  const after = await inbox.checkpoint();
  store.add(inbox.address, rawMail('Sign in', 'fresh'));
  const mail = await inbox.waitForEmail({ after, subject: 'Sign in', timeoutMs: 500 });
  assert.equal(mail.text.trim(), 'fresh');
});
test('checkpoint ignores a delayed index for a receipt before the action', async () => {
  const { store, inbox } = setup();
  const after = await inbox.checkpoint();
  store.add(inbox.address, rawMail('Sign in', 'old-in-flight'), new Date(after.startedAt.getTime() - 60_000));
  store.add(inbox.address, rawMail('Sign in', 'new'));
  assert.equal((await inbox.waitForEmail({ after, timeoutMs: 500 })).text.trim(), 'new');
});
test('filters recipient, sender and subject without returning the newest unrelated email', async () => {
  const { store, inbox } = setup();
  store.add('another@' + config.domain, rawMail('Sign in', 'wrong-user'));
  store.add(inbox.address, rawMail('Newsletter', 'wrong-kind'));
  store.add(inbox.address, rawMail('Sign in', 'correct'));
  store.add(inbox.address, rawMail('Receipt', 'newest'));
  const mail = await inbox.waitForEmail({ subject: /sign in/gi, from: 'login@example.test', timeoutMs: 500 });
  assert.equal(mail.recipient, inbox.address);
  assert.equal(mail.text.trim(), 'correct');
});
test('consumes message IDs so repeated waits do not reuse authentication mail', async () => {
  const { store, inbox } = setup();
  store.add(inbox.address, rawMail('Sign in', 'first'), new Date(1));
  store.add(inbox.address, rawMail('Sign in', 'second'), new Date(2));
  assert.equal((await inbox.waitForEmail({ timeoutMs: 500 })).text.trim(), 'first');
  assert.equal((await inbox.waitForEmail({ timeoutMs: 500 })).text.trim(), 'second');
  await assert.rejects(inbox.waitForEmail({ timeoutMs: 30, pollIntervalMs: 5 }), EmailTimeoutError);
});
test('returns the requested number of distinct messages', async () => {
  const { store, inbox } = setup();
  store.add(inbox.address, rawMail('One'));
  store.add(inbox.address, rawMail('Two'));
  assert.equal((await inbox.waitForEmails(2, { timeoutMs: 500 })).length, 2);
  await assert.rejects(inbox.waitForEmails(0), /positive integer/);
});
test('waits through the full negative-assertion observation window', async () => {
  const { inbox } = setup();
  const start = performance.now();
  await inbox.expectNoEmail({ forMs: 50, pollIntervalMs: 5 });
  assert.ok(performance.now() - start >= 40);
});
test('negative assertion fails when matching mail exists', async () => {
  const { store, inbox } = setup();
  store.add(inbox.address, rawMail('Unexpected'));
  await assert.rejects(inbox.expectNoEmail({ forMs: 500 }), /Unexpected matching email/);
});
test('abort propagates rather than becoming a misleading timeout', async () => {
  const { inbox } = setup();
  const controller = new AbortController();
  const reason = new Error('Cancelled by caller');
  controller.abort(reason);
  await assert.rejects(inbox.waitForEmail({ signal: controller.signal }), error => error === reason);
});
test('authentication/storage failures fail immediately', async () => {
  const store = new MemoryStore();
  store.list = async () => { throw new Error('AccessDenied'); };
  const inbox = new Hail(config, store).createInbox();
  await assert.rejects(inbox.waitForEmail({ timeoutMs: 500 }), /AccessDenied/);
});
test('invalid timeout and poll interval fail before polling', async () => {
  const { inbox } = setup();
  await assert.rejects(inbox.waitForEmail({ timeoutMs: -1 }), /positive/);
  await assert.rejects(inbox.waitForEmail({ pollIntervalMs: 0 }), /positive/);
});
test('decodes HTML entities while preserving a signed URL exactly', async () => {
  const mail = await parse('<a href="https://app.example.test/auth?token=ABC%2f123&amp;next=%2Fhome"><strong>Sign in</strong></a>');
  assert.equal(mail.getLink({ text: /sign in/i, allowedOrigins: ['https://app.example.test'] }), 'https://app.example.test/auth?token=ABC%2f123&next=%2Fhome');
});
test('requires one unambiguous link', async () => {
  const mail = await parse('<a href="https://app.example.test/a">Sign in</a><a href="https://app.example.test/b">Sign in</a>');
  assert.throws(() => mail.getLink({ text: 'Sign in', allowedOrigins: ['https://app.example.test'] }), /found 2/);
});
test('rejects lookalike origins, credential-bearing URLs and executable schemes', async () => {
  const mail = await parse('<a href="https://app.example.test.evil.test/auth">Sign in</a><a href="https://user:pass@app.example.test/auth">Sign in</a><a href="javascript:alert(1)">Sign in</a>');
  assert.throws(() => mail.getLink({ allowedOrigins: ['https://app.example.test'] }), /found 0/);
  assert.throws(() => mail.getLink({ allowedOrigins: [] }), /required/);
});
test('deduplicates repeated copies of the same link and does not fetch it', async () => {
  const original = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error('Must not fetch authentication links'); };
  try {
    const mail = await parse('<a href="https://app.example.test/a?token=SECRET">Sign in</a><a href="https://app.example.test/a?token=SECRET">Sign in</a>');
    assert.equal(mail.getLink({ allowedOrigins: ['https://app.example.test'], pathname: '/a' }), 'https://app.example.test/a?token=SECRET');
    assert.equal(requests, 0);
    assert.ok(!JSON.stringify(mail).includes('SECRET'));
    assert.ok(!inspect(mail).includes('SECRET'));
  } finally { globalThis.fetch = original; }
});
test('extracts one-time codes without logging ambiguous values', async () => {
  const { store, inbox } = setup();
  store.add(inbox.address, rawMail('Code', 'Your code is 123456. Repeat: 123456.'));
  assert.equal((await inbox.waitForEmail({ timeoutMs: 500 })).getCode(), '123456');
  const mail = await parse('<p>123456 or 654321</p>');
  assert.throws(() => mail.getCode(), /found 2/);
});
test('parses MIME attachment bytes and ignores the untrusted Date header for receipt time', async () => {
  const receivedAt = new Date('2026-09-29T00:00:00Z');
  const raw = ['From: sender@example.test', 'Subject: Attachment', 'Date: Wed, 1 Jan 2099 00:00:00 +0000', 'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="b"', '', '--b', 'Content-Type: text/plain', '', 'Receipt', '--b', 'Content-Type: text/plain; name="hello.txt"', 'Content-Disposition: attachment; filename="hello.txt"', 'Content-Transfer-Encoding: base64', '', 'SGVsbG8=', '--b--', ''].join('\r\n');
  const mail = await EmailMessage.parse({ id: 'mime', recipient: 'test@' + config.domain, receivedAt, raw });
  assert.equal(mail.attachments[0].filename, 'hello.txt');
  assert.equal(mail.attachments[0].content.toString(), 'Hello');
  assert.equal(mail.receivedAt, receivedAt);
});
