import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { performance } from "node:perf_hooks";
import { normalizeAddress, parseConfig, type HailConfig } from "./config.js";
import { EmailMessage, matches, type Pattern } from "./email.js";
import { S3MailStore, type MailStore } from "./store.js";

export * from "./config.js";
export * from "./email.js";
export * from "./store.js";
export interface Checkpoint {
  readonly startedAt: Date;
  readonly seen: ReadonlySet<string>;
}
export interface WaitOptions {
  after?: Checkpoint | Date;
  subject?: Pattern;
  from?: Pattern;
  timeoutMs?: number;
  pollIntervalMs?: number;
  signal?: AbortSignal;
  consume?: boolean;
}
export class EmailTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`No matching email was observed within ${timeoutMs}ms. Check DNS, the active SES receipt rule, and the ingestion DLQ. Message contents are redacted.`);
    this.name = "EmailTimeoutError";
  }
}
function positive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive.`);
  return value;
}

export class Inbox {
  private readonly consumed = new Set<string>();
  private readonly cache = new Map<string, EmailMessage>();
  readonly address: string;
  constructor(address: string, private readonly store: MailStore) {
    this.address = normalizeAddress(address);
  }
  async checkpoint(): Promise<Checkpoint> {
    const startedAt = new Date();
    const refs = await this.store.list(this.address, AbortSignal.timeout(20_000));
    return { startedAt, seen: new Set(refs.map(ref => ref.id)) };
  }
  async waitForEmail(options: WaitOptions = {}): Promise<EmailMessage> {
    return (await this.waitForEmails(1, options))[0];
  }
  async waitForEmails(count: number, options: WaitOptions = {}): Promise<EmailMessage[]> {
    if (!Number.isInteger(count) || count < 1) throw new Error("Email count must be a positive integer.");
    const timeoutMs = positive(options.timeoutMs ?? 60_000, "timeoutMs");
    const interval = positive(options.pollIntervalMs ?? 500, "pollIntervalMs");
    const after = options.after instanceof Date ? options.after : options.after?.startedAt;
    if (after && !Number.isFinite(after.getTime())) throw new Error("The email checkpoint must have a valid timestamp.");
    const expiry = AbortSignal.timeout(Math.ceil(timeoutMs));
    const signal = options.signal ? AbortSignal.any([options.signal, expiry]) : expiry;
    const start = performance.now();
    try {
      while (performance.now() - start < timeoutMs) {
        signal.throwIfAborted();
        const refs = await this.store.list(this.address, signal);
        const seen = new Set<string>();
        const found: EmailMessage[] = [];
        for (const ref of refs) {
          signal.throwIfAborted();
          if (seen.has(ref.id) || this.consumed.has(ref.id)) continue;
          seen.add(ref.id);
          if (options.after && !(options.after instanceof Date) && options.after.seen.has(ref.id)) continue;
          let email = this.cache.get(ref.id);
          if (!email) {
            const stored = await this.store.get(ref, this.address, signal);
            if (stored.recipient !== this.address) throw new Error("Storage returned a message for a different recipient.");
            email = await EmailMessage.parse(stored);
            this.cache.set(ref.id, email);
          }
          signal.throwIfAborted();
          if (after && email.receivedAt < after) continue;
          if (matches(email.subject, options.subject) && matches(email.from, options.from)) found.push(email);
        }
        found.sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime() || a.id.localeCompare(b.id));
        if (found.length >= count) {
          const result = found.slice(0, count);
          if (options.consume !== false) result.forEach(email => this.consumed.add(email.id));
          return result;
        }
        await delay(Math.min(interval, Math.max(1, timeoutMs - (performance.now() - start))), undefined, { signal });
      }
    } catch (error) {
      if (options.signal?.aborted) throw options.signal.reason;
      if (!expiry.aborted) throw error;
    }
    throw new EmailTimeoutError(timeoutMs);
  }
  async expectNoEmail(options: Omit<WaitOptions, "timeoutMs" | "consume"> & { forMs: number }): Promise<void> {
    try {
      await this.waitForEmail({ ...options, timeoutMs: options.forMs, consume: false });
    } catch (error) {
      if (error instanceof EmailTimeoutError) return;
      throw error;
    }
    throw new Error("Unexpected matching email arrived during the observation window. Contents are redacted.");
  }
}

export class Hail {
  readonly config: HailConfig;
  readonly store: MailStore;
  constructor(config: HailConfig, store?: MailStore) {
    this.config = parseConfig(config);
    this.store = store ?? new S3MailStore(this.config);
  }
  createInbox(label = "test"): Inbox {
    const prefix = label.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+/, "").slice(0, 20) || "test";
    return this.inbox(`${prefix}-${randomBytes(16).toString("hex")}@${this.config.domain}`);
  }
  inbox(address: string): Inbox {
    const normalized = normalizeAddress(address);
    if (normalized.split("@")[1] !== this.config.domain) throw new Error("Mailbox is outside the configured test domain.");
    return new Inbox(normalized, this.store);
  }
}
