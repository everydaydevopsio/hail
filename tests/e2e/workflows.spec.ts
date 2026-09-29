import { SESClient, SendRawEmailCommand } from '@aws-sdk/client-ses';
import { test as hailTest, expect } from '../../src/playwright.js';
import { Hail, loadConfig } from '../../src/index.js';
import { MemoryStore, config } from '../helpers/memory-store.js';
import { startDemoApp, type DemoApp, type SendMail } from '../helpers/demo-app.js';

const live = process.env.HAIL_LIVE === '1';
const test = hailTest.extend<{ app: DemoApp }>({
  hail: async ({}, use) => {
    if (live) {
      if (!process.env.HAIL_FROM) throw new Error('Live tests require an explicitly configured HAIL_FROM sender and HAIL_CONFIG receiver.');
      await use(new Hail(await loadConfig()));
    } else await use(new Hail(config, new MemoryStore()));
  },
  app: async ({ hail }, use) => {
    let send: SendMail;
    if (live) {
      const ses = new SESClient({ region: process.env.HAIL_SEND_REGION ?? hail.config.region });
      send = async (recipient, raw) => {
        await ses.send(new SendRawEmailCommand({ Source: process.env.HAIL_FROM!, Destinations: [recipient], RawMessage: { Data: Buffer.from(raw) } }), { abortSignal: AbortSignal.timeout(20_000) });
      };
    } else {
      const store = hail.store as MemoryStore;
      send = async (recipient, raw) => { store.add(recipient, raw); };
    }
    const app = await startDemoApp(send, live ? process.env.HAIL_FROM! : undefined);
    try { await use(app); } finally { await app.close(); }
  },
});

test('magic link authenticates the intended user and cannot be reused', async ({ page, inbox, app }) => {
  await page.goto(app.origin + '/login');
  const after = await inbox.checkpoint();
  await page.getByLabel('Email', { exact: true }).fill(inbox.address);
  await page.getByRole('button', { name: 'Send magic link' }).click();
  await expect(page.getByTestId('sent')).toBeVisible();
  const email = await inbox.waitForEmail({ after, subject: 'Sign in to Hail' });
  const url = email.getLink({ text: 'Sign in', allowedOrigins: [app.origin] });
  await page.goto(url);
  await expect(page.getByTestId('current-user-email')).toHaveText(inbox.address);
  const secondUse = await page.goto(url);
  expect(secondUse?.status()).toBe(410);
  await expect(page.getByTestId('invalid-link')).toBeVisible();
});

test('invitation uses a separate browser identity and grants the correct organization and role', async ({ browser, inbox, app }) => {
  const administrator = await browser.newContext();
  const invitee = await browser.newContext();
  try {
    await administrator.addCookies([app.adminCookie]);
    const adminPage = await administrator.newPage();
    const memberPage = await invitee.newPage();
    await adminPage.goto(app.origin + '/admin');
    const after = await inbox.checkpoint();
    await adminPage.getByLabel('Invite email').fill(inbox.address);
    await adminPage.getByRole('button', { name: 'Invite member' }).click();
    await expect(adminPage.getByTestId('sent')).toBeVisible();
    const email = await inbox.waitForEmail({ after, subject: 'Invitation to Hail' });
    await memberPage.goto(email.getLink({ text: 'Accept invitation', allowedOrigins: [app.origin] }));
    await expect(memberPage.getByTestId('current-user-email')).toHaveText(inbox.address);
    await expect(memberPage.getByTestId('role')).toHaveText('viewer');
    await expect(memberPage.getByTestId('organization')).toHaveText('Hail');
    await adminPage.goto(app.origin + '/dashboard');
    await expect(adminPage.getByTestId('current-user-email')).toHaveText('admin@example.test');
    await expect(adminPage.getByTestId('role')).toHaveText('admin');
  } finally { await administrator.close(); await invitee.close(); }
});

test('expired login token is rejected by the server, not by a mocked browser clock', async ({ page, inbox, app }) => {
  await page.goto(app.origin + '/login');
  const after = await inbox.checkpoint();
  await page.getByLabel('Email', { exact: true }).fill(inbox.address);
  await page.getByRole('button', { name: 'Send magic link' }).click();
  await expect(page.getByTestId('sent')).toBeVisible();
  const email = await inbox.waitForEmail({ after, subject: 'Sign in to Hail' });
  const url = email.getLink({ allowedOrigins: [app.origin], pathname: '/auth/callback' });
  app.expire(url);
  expect((await page.goto(url))?.status()).toBe(410);
  expect((await page.goto(app.origin + '/dashboard'))?.status()).toBe(401);
});

test('revoked invitation cannot create a session', async ({ browser, inbox, app }) => {
  const administrator = await browser.newContext();
  const invitee = await browser.newContext();
  try {
    await administrator.addCookies([app.adminCookie]);
    const adminPage = await administrator.newPage();
    await adminPage.goto(app.origin + '/admin');
    const after = await inbox.checkpoint();
    await adminPage.getByLabel('Invite email').fill(inbox.address);
    await adminPage.getByRole('button', { name: 'Invite member' }).click();
    await expect(adminPage.getByTestId('sent')).toBeVisible();
    const email = await inbox.waitForEmail({ after, subject: 'Invitation to Hail' });
    const url = email.getLink({ allowedOrigins: [app.origin], pathname: '/accept' });
    app.revoke(url);
    const memberPage = await invitee.newPage();
    expect((await memberPage.goto(url))?.status()).toBe(410);
    expect((await memberPage.goto(app.origin + '/dashboard'))?.status()).toBe(401);
  } finally { await administrator.close(); await invitee.close(); }
});

test('parallel workers never receive another test inbox message', async ({ page, inbox, hail, app }) => {
  const other = hail.createInbox('other');
  for (const address of [other.address, inbox.address]) {
    await page.goto(app.origin + '/login');
    await page.getByLabel('Email', { exact: true }).fill(address);
    await page.getByRole('button', { name: 'Send magic link' }).click();
    await expect(page.getByTestId('sent')).toBeVisible();
  }
  const email = await inbox.waitForEmail({ subject: 'Sign in to Hail' });
  expect(email.recipient).toBe(inbox.address);
  await page.goto(email.getLink({ allowedOrigins: [app.origin] }));
  await expect(page.getByTestId('current-user-email')).toHaveText(inbox.address);
});
