import { SESClient, SendRawEmailCommand } from "@aws-sdk/client-ses";
import { S3Client } from "@aws-sdk/client-s3";
import { Hail, S3MailStore, loadConfig } from "@everydaydevopsio/hail";
import {
  test as base,
  expect,
  visitAuthLink,
} from "@everydaydevopsio/hail/playwright";
import { startDemoApp, type DemoApp } from "./demo-app.js";
import {
  assertDistinctLiveRoles,
  countLiveSend,
  loadRestrictedSession,
} from "./live-aws.js";

const test = base.extend<{ app: DemoApp }>({
  hail: async ({}, use) => {
    assertDistinctLiveRoles(
      process.env.HAIL_READER_ROLE_ARN,
      process.env.HAIL_SENDER_ROLE_ARN,
    );
    const config = await loadConfig();
    const reader = await loadRestrictedSession(
      process.env.HAIL_READER_SESSION_FILE,
      process.env.HAIL_READER_ROLE_ARN,
      process.env.HAIL_EXPECTED_ACCOUNT,
      config.region,
    );
    const direct = { ...config, roleArn: undefined };
    await use(
      new Hail(
        direct,
        new S3MailStore(
          direct,
          new S3Client({
            region: direct.region,
            credentials: reader.credentials,
            maxAttempts: 2,
          }),
        ),
      ),
    );
  },
  app: async ({ hail }, use) => {
    if (!process.env.HAIL_FROM)
      throw new Error("Approved HAIL_FROM is required.");
    const sender = await loadRestrictedSession(
      process.env.HAIL_SENDER_SESSION_FILE,
      process.env.HAIL_SENDER_ROLE_ARN,
      process.env.HAIL_EXPECTED_ACCOUNT,
      process.env.HAIL_SEND_REGION ?? hail.config.region,
    );
    const ses = new SESClient({
      region: process.env.HAIL_SEND_REGION ?? hail.config.region,
      credentials: sender.credentials,
      maxAttempts: 1,
    });
    const app = await startDemoApp(async (recipient, raw) => {
      await countLiveSend(process.env.HAIL_LIVE_RUN_DIR);
      await ses.send(
        new SendRawEmailCommand({
          Source: process.env.HAIL_FROM,
          Destinations: [recipient],
          RawMessage: { Data: Buffer.from(raw) },
        }),
        { abortSignal: AbortSignal.timeout(20_000) },
      );
    }, process.env.HAIL_FROM);
    try {
      await use(app);
    } finally {
      await app.close();
    }
  },
});

test("packed consumer completes real email magic-link login and rejects replay", async ({
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
  const url = email.getLink({ text: "Sign in", allowedOrigins: [app.origin] });
  await visitAuthLink(page, url);
  await expect(page.getByTestId("current-user-email")).toHaveText(
    inbox.address,
  );
  const nonce = (await page.context().cookies(app.origin)).find(
    (cookie) => cookie.name === "request_nonce",
  );
  expect(nonce).toBeDefined();
  const replay = await browser.newContext();
  try {
    await replay.addCookies([nonce!]);
    const replayPage = await replay.newPage();
    expect((await visitAuthLink(replayPage, url))?.status()).toBe(410);
    expect((await replayPage.goto(app.origin + "/dashboard"))?.status()).toBe(
      401,
    );
  } finally {
    await replay.close();
  }
});

test("packed consumer accepts real email invitation in an independent browser", async ({
  browser,
  inbox,
  app,
}) => {
  const admin = await browser.newContext();
  const invitee = await browser.newContext();
  try {
    await admin.addCookies([app.adminCookie]);
    const adminPage = await admin.newPage();
    const inviteePage = await invitee.newPage();
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
      inviteePage,
      email.getLink({ allowedOrigins: [app.origin] }),
    );
    await expect(inviteePage.getByTestId("current-user-email")).toHaveText(
      inbox.address,
    );
    await expect(inviteePage.getByTestId("role")).toHaveText("viewer");
    await expect(inviteePage.getByTestId("organization")).toHaveText("Hail");
    await adminPage.goto(app.origin + "/dashboard");
    await expect(adminPage.getByTestId("current-user-email")).toHaveText(
      "admin@example.test",
    );
  } finally {
    await admin.close();
    await invitee.close();
  }
});
