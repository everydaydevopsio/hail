import { test as base, expect } from "@playwright/test";
import { Hail, loadConfig, type HailConfig, type Inbox } from "./index.js";

export interface HailOptions {
  hailConfig: HailConfig | undefined;
}
export interface HailFixtures {
  hail: Hail;
  inbox: Inbox;
}
export const test = base.extend<HailOptions & HailFixtures>({
  hailConfig: [undefined, { option: true }],
  hail: async ({ hailConfig }, use) => {
    await use(new Hail(hailConfig ?? (await loadConfig())));
  },
  inbox: async ({ hail }, use, testInfo) => {
    const inbox = hail.createInbox(
      `w${testInfo.workerIndex}-r${testInfo.retry}`,
    );
    // Do not attach raw MIME, subjects, codes, or authentication URLs to reports.
    await use(inbox);
  },
});
export { expect };
