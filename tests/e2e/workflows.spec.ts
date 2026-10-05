import { SESClient, SendRawEmailCommand } from "@aws-sdk/client-ses";
import { S3Client } from "@aws-sdk/client-s3";
import {
  test as hailTest,
  expect,
  visitAuthLink,
} from "../../src/playwright.js";
import { Hail, loadConfig } from "../../src/index.js";
import { S3MailStore } from "../../src/store.js";
import { countLiveSend, loadRestrictedSession } from "../helpers/live-aws.js";
import { MemoryStore, config } from "../helpers/memory-store.js";
import {
  startDemoApp,
  type DemoApp,
  type SendMail,
} from "../helpers/demo-app.js";

const live = process.env.HAIL_LIVE === "1";
const test = hailTest.extend<{ app: DemoApp }>({
  hail: async ({}, use) => {
    if (live) {
      if (!process.env.HAIL_FROM)
        throw new Error(
          "Live tests require an explicitly configured HAIL_FROM sender and HAIL_CONFIG receiver.",
        );
      const config = await loadConfig();
      const reader = await loadRestrictedSession(
        process.env.HAIL_READER_SESSION_FILE,
        process.env.HAIL_READER_ROLE_ARN,
        process.env.HAIL_EXPECTED_ACCOUNT,
        config.region,
      );
      const directConfig = { ...config, roleArn: undefined };
      await use(
        new Hail(
          directConfig,
          new S3MailStore(
            directConfig,
            new S3Client({
              region: config.region,
              credentials: reader.credentials,
              maxAttempts: 2,
            }),
          ),
        ),
      );
    } else await use(new Hail(config, new MemoryStore()));
  },
  app: async ({ hail }, use) => {
    let send: SendMail;
    if (live) {
      const sendRegion = process.env.HAIL_SEND_REGION ?? hail.config.region;
      const sender = await loadRestrictedSession(
        process.env.HAIL_SENDER_SESSION_FILE,
        process.env.HAIL_SENDER_ROLE_ARN,
        process.env.HAIL_EXPECTED_ACCOUNT,
        sendRegion,
      );
      const ses = new SESClient({
        region: sendRegion,
        credentials: sender.credentials,
        maxAttempts: 2,
      });
      send = async (recipient, raw) => {
        await countLiveSend(process.env.HAIL_LIVE_RUN_DIR);
        await ses.send(
          new SendRawEmailCommand({
            Source: process.env.HAIL_FROM!,
            Destinations: [recipient],
            RawMessage: { Data: Buffer.from(raw) },
          }),
          { abortSignal: AbortSignal.timeout(20_000) },
        );
      };
    } else {
      const store = hail.store as MemoryStore;
      send = async (recipient, raw) => {
        store.add(recipient, raw);
      };
    }
    const app = await startDemoApp(
      send,
      live ? process.env.HAIL_FROM! : undefined,
    );
    try {
      await use(app);
    } finally {
      await app.close();
    }
  },
});

test("magic link authenticates the intended user and cannot be reused", async ({
  page,
  inbox,
  app,
  browser,
}) => {
  await page.goto(app.origin + "/login");
  const after = await inbox.checkpoint();
  await page.getByLabel("Email", { exact: true }).fill(inbox.address);
  await page.getByRole("button", { name: "Send magic link" }).click();
  await expect(page.getByTestId("sent")).toBeVisible();
  const email = await inbox.waitForEmail({ after, subject: "Sign in to Hail" });
  const url = email.getLink({ text: "Sign in", allowedOrigins: [app.origin] });
  await visitAuthLink(page, url);
  await expect(page.getByTestId("current-user-email")).toHaveText(
    inbox.address,
  );
  const nonce = (await page.context().cookies(app.origin)).find(
    (cookie) => cookie.name === "request_nonce",
  );
  expect(nonce).toBeDefined();
  const replayContext = await browser.newContext();
  try {
    await replayContext.addCookies([nonce!]);
    const replayPage = await replayContext.newPage();
    const secondUse = await visitAuthLink(replayPage, url);
    expect(secondUse?.status()).toBe(410);
    await expect(replayPage.getByTestId("invalid-link")).toBeVisible();
    expect((await replayPage.goto(app.origin + "/dashboard"))?.status()).toBe(
      401,
    );
  } finally {
    await replayContext.close();
  }
});

test("invitation uses a separate browser identity and grants the correct organization and role", async ({
  browser,
  inbox,
  app,
}) => {
  const administrator = await browser.newContext();
  const invitee = await browser.newContext();
  try {
    await administrator.addCookies([app.adminCookie]);
    const adminPage = await administrator.newPage();
    const memberPage = await invitee.newPage();
    await adminPage.goto(app.origin + "/admin");
    const after = await inbox.checkpoint();
    await adminPage.getByLabel("Invite email").fill(inbox.address);
    await adminPage.getByRole("button", { name: "Invite member" }).click();
    await expect(adminPage.getByTestId("sent")).toBeVisible();
    const email = await inbox.waitForEmail({
      after,
      subject: "Invitation to Hail",
    });
    await visitAuthLink(
      memberPage,
      email.getLink({
        text: "Accept invitation",
        allowedOrigins: [app.origin],
      }),
    );
    await expect(memberPage.getByTestId("current-user-email")).toHaveText(
      inbox.address,
    );
    await expect(memberPage.getByTestId("role")).toHaveText("viewer");
    await expect(memberPage.getByTestId("organization")).toHaveText("Hail");
    expect((await memberPage.goto(app.origin + "/admin"))?.status()).toBe(403);
    await adminPage.goto(app.origin + "/dashboard");
    await expect(adminPage.getByTestId("current-user-email")).toHaveText(
      "admin@example.test",
    );
    await expect(adminPage.getByTestId("role")).toHaveText("admin");
  } finally {
    await administrator.close();
    await invitee.close();
  }
});

test("expired login token is rejected by the server, not by a mocked browser clock", async ({
  page,
  inbox,
  app,
}) => {
  await page.goto(app.origin + "/login");
  const after = await inbox.checkpoint();
  await page.getByLabel("Email", { exact: true }).fill(inbox.address);
  await page.getByRole("button", { name: "Send magic link" }).click();
  await expect(page.getByTestId("sent")).toBeVisible();
  const email = await inbox.waitForEmail({ after, subject: "Sign in to Hail" });
  const url = email.getLink({
    allowedOrigins: [app.origin],
    pathname: "/auth/callback",
  });
  app.expire(url);
  expect((await visitAuthLink(page, url))?.status()).toBe(410);
  expect((await page.goto(app.origin + "/dashboard"))?.status()).toBe(401);
});

test("revoked invitation cannot create a session", async ({
  browser,
  inbox,
  app,
}) => {
  const administrator = await browser.newContext();
  const invitee = await browser.newContext();
  try {
    await administrator.addCookies([app.adminCookie]);
    const adminPage = await administrator.newPage();
    await adminPage.goto(app.origin + "/admin");
    const after = await inbox.checkpoint();
    await adminPage.getByLabel("Invite email").fill(inbox.address);
    await adminPage.getByRole("button", { name: "Invite member" }).click();
    await expect(adminPage.getByTestId("sent")).toBeVisible();
    const email = await inbox.waitForEmail({
      after,
      subject: "Invitation to Hail",
    });
    const url = email.getLink({
      allowedOrigins: [app.origin],
      pathname: "/accept",
    });
    app.revoke(url);
    const memberPage = await invitee.newPage();
    expect((await visitAuthLink(memberPage, url))?.status()).toBe(410);
    expect((await memberPage.goto(app.origin + "/dashboard"))?.status()).toBe(
      401,
    );
  } finally {
    await administrator.close();
    await invitee.close();
  }
});

test("parallel workers never receive another test inbox message", async ({
  page,
  inbox,
  hail,
  app,
}) => {
  const other = hail.createInbox("other");
  for (const address of [other.address, inbox.address]) {
    await page.goto(app.origin + "/login");
    await page.getByLabel("Email", { exact: true }).fill(address);
    await page.getByRole("button", { name: "Send magic link" }).click();
    await expect(page.getByTestId("sent")).toBeVisible();
  }
  const email = await inbox.waitForEmail({ subject: "Sign in to Hail" });
  expect(email.recipient).toBe(inbox.address);
  await visitAuthLink(page, email.getLink({ allowedOrigins: [app.origin] }));
  await expect(page.getByTestId("current-user-email")).toHaveText(
    inbox.address,
  );
});

test("failed auth navigation redacts the token", async ({ page }) => {
  const token = "SYNTHETIC_SECRET_TOKEN";
  let failure: unknown;
  try {
    await visitAuthLink(
      page,
      `http://127.0.0.1:1/auth/callback?token=${token}`,
    );
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(Error);
  expect(String(failure)).toContain("URL is redacted");
  expect(String(failure)).not.toContain(token);
});

test("a login link is bound to the requesting browser", async ({
  page,
  browser,
  inbox,
  app,
}) => {
  await page.goto(app.origin + "/login");
  const after = await inbox.checkpoint();
  await page.getByLabel("Email", { exact: true }).fill(inbox.address);
  await page.getByRole("button", { name: "Send magic link" }).click();
  await expect(page.getByTestId("sent")).toBeVisible();
  const email = await inbox.waitForEmail({ after, subject: "Sign in to Hail" });
  const url = email.getLink({ allowedOrigins: [app.origin] });
  const stranger = await browser.newContext();
  try {
    const strangerPage = await stranger.newPage();
    expect((await visitAuthLink(strangerPage, url))?.status()).toBe(403);
    expect((await strangerPage.goto(app.origin + "/dashboard"))?.status()).toBe(
      401,
    );
    await visitAuthLink(page, url);
    await expect(page.getByTestId("current-user-email")).toHaveText(
      inbox.address,
    );
  } finally {
    await stranger.close();
  }
});

test("a newer login request supersedes an older link", async ({
  page,
  inbox,
  app,
}) => {
  await page.goto(app.origin + "/login");
  const firstCheckpoint = await inbox.checkpoint();
  await page.getByLabel("Email", { exact: true }).fill(inbox.address);
  await page.getByRole("button", { name: "Send magic link" }).click();
  await expect(page.getByTestId("sent")).toBeVisible();
  const first = await inbox.waitForEmail({
    after: firstCheckpoint,
    subject: "Sign in to Hail",
  });
  const secondCheckpoint = await inbox.checkpoint();
  await page.goto(app.origin + "/login");
  await page.getByLabel("Email", { exact: true }).fill(inbox.address);
  await page.getByRole("button", { name: "Send magic link" }).click();
  await expect(page.getByTestId("sent")).toBeVisible();
  const second = await inbox.waitForEmail({
    after: secondCheckpoint,
    subject: "Sign in to Hail",
  });
  expect(
    (
      await visitAuthLink(page, first.getLink({ allowedOrigins: [app.origin] }))
    )?.status(),
  ).toBe(410);
  expect((await page.goto(app.origin + "/dashboard"))?.status()).toBe(401);
  await visitAuthLink(page, second.getLink({ allowedOrigins: [app.origin] }));
  await expect(page.getByTestId("current-user-email")).toHaveText(
    inbox.address,
  );
});

test("expired and already-used invitations cannot create another session", async ({
  browser,
  inbox,
  app,
}) => {
  const administrator = await browser.newContext();
  const firstInvitee = await browser.newContext();
  const secondInvitee = await browser.newContext();
  try {
    await administrator.addCookies([app.adminCookie]);
    const adminPage = await administrator.newPage();
    await adminPage.goto(app.origin + "/admin");
    const firstCheckpoint = await inbox.checkpoint();
    await adminPage.getByLabel("Invite email").fill(inbox.address);
    await adminPage.getByRole("button", { name: "Invite member" }).click();
    await expect(adminPage.getByTestId("sent")).toBeVisible();
    const usedEmail = await inbox.waitForEmail({
      after: firstCheckpoint,
      subject: "Invitation to Hail",
    });
    const usedUrl = usedEmail.getLink({ allowedOrigins: [app.origin] });
    const firstPage = await firstInvitee.newPage();
    await visitAuthLink(firstPage, usedUrl);
    await expect(firstPage.getByTestId("current-user-email")).toHaveText(
      inbox.address,
    );
    const secondPage = await secondInvitee.newPage();
    expect((await visitAuthLink(secondPage, usedUrl))?.status()).toBe(410);
    expect((await secondPage.goto(app.origin + "/dashboard"))?.status()).toBe(
      401,
    );

    const secondCheckpoint = await inbox.checkpoint();
    await adminPage.goto(app.origin + "/admin");
    await adminPage.getByLabel("Invite email").fill(inbox.address);
    await adminPage.getByRole("button", { name: "Invite member" }).click();
    await expect(adminPage.getByTestId("sent")).toBeVisible();
    const expiredEmail = await inbox.waitForEmail({
      after: secondCheckpoint,
      subject: "Invitation to Hail",
    });
    const expiredUrl = expiredEmail.getLink({ allowedOrigins: [app.origin] });
    app.expire(expiredUrl);
    expect((await visitAuthLink(secondPage, expiredUrl))?.status()).toBe(410);
    expect((await secondPage.goto(app.origin + "/dashboard"))?.status()).toBe(
      401,
    );
  } finally {
    await administrator.close();
    await firstInvitee.close();
    await secondInvitee.close();
  }
});
