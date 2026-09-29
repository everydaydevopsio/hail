import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hail } from '../../src/index.js';
import { MemoryStore, config } from '../helpers/memory-store.js';

test('arbitrary display labels still generate valid test addresses', () => {
  const hail = new Hail(config, new MemoryStore());
  for (const label of ['', '---', ' Login!', '💌 invite', '_leading']) {
    assert.match(hail.createInbox(label).address, /^[a-z0-9][a-z0-9-]*@mail\.example\.test$/);
  }
});
test('invalid checkpoint timestamps fail rather than accepting stale email', async () => {
  const inbox = new Hail(config, new MemoryStore()).createInbox();
  await assert.rejects(inbox.waitForEmail({ after: new Date('invalid') }), /valid timestamp/);
});
