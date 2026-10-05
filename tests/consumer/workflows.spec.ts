import { randomUUID } from "node:crypto";
import {
  Hail,
  type MailStore,
  type MessageRef,
  type StoredMail,
  type HailConfig,
} from "@everydaydevopsio/hail";
import {
  test as base,
  expect,
  visitAuthLink,
} from "@everydaydevopsio/hail/playwright";
import { startDemoApp, type DemoApp } from "./demo-app.js";

const config: HailConfig = {
  schemaVersion: 1,
  domain: "mail.example.test",
  bucketName: "hail-test-bucket",
  region: "us-east-1",
  layout: "indexed-v1",
};
class LocalMailStore implements MailStore {
  private readonly items = new Map<string, StoredMail>();
  add(recipient: string, raw: string) {
    const id = randomUUID();
    this.items.set(id, { id, recipient, raw, receivedAt: new Date() });
  }
  async list(recipient: string): Promise<MessageRef[]> {
    return [...this.items.values()]
      .filter((mail) => mail.recipient === recipient)
      .map((mail) => ({
        id: mail.id,
        key: mail.id,
        receivedAt: mail.receivedAt,
      }));
  }
  async get(ref: MessageRef, recipient: string): Promise<StoredMail> {
    const mail = this.items.get(ref.id);
    if (!mail || mail.recipient !== recipient) throw new Error("Wrong inbox.");
    return mail;
  }
}

const test = base.extend<{ app: DemoApp }>({
  hail: async ({}, use) => {
    await use(new Hail(config, new LocalMailStore()));
  },
  app: async ({ hail }, use) => {
    const store = hail.store as LocalMailStore;
    const app = await startDemoApp(async (recipient, raw) =>
      store.add(recipient, raw),
    );
    try {
      await use(app);
    } finally {
      await app.close();
    }
  },
});

test("packed consumer completes a magic-link login", async ({
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
  await visitAuthLink(page, email.getLink({ allowedOrigins: [app.origin] }));
  await expect(page.getByTestId("current-user-email")).toHaveText(
    inbox.address,
  );
});

test("packed consumer accepts an invitation in an independent browser", async ({
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
