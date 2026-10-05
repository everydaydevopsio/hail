import { randomUUID } from "node:crypto";
import type {
  MailStore,
  MessageRef,
  StoredMail,
  HailConfig,
} from "../../src/index.js";

export const config: HailConfig = {
  schemaVersion: 1,
  domain: "mail.example.test",
  bucketName: "hail-test-bucket",
  region: "us-east-1",
  layout: "indexed-v1",
};
export class MemoryStore implements MailStore {
  readonly items = new Map<string, StoredMail>();
  add(recipient: string, raw: string, receivedAt = new Date()) {
    const id = randomUUID();
    this.items.set(id, { id, recipient, raw, receivedAt });
    return id;
  }
  async list(recipient: string, signal?: AbortSignal): Promise<MessageRef[]> {
    signal?.throwIfAborted();
    return [...this.items.values()]
      .filter((mail) => mail.recipient === recipient)
      .map((mail) => ({
        id: mail.id,
        key: mail.id,
        receivedAt: mail.receivedAt,
      }));
  }
  async get(
    ref: MessageRef,
    recipient: string,
    signal?: AbortSignal,
  ): Promise<StoredMail> {
    signal?.throwIfAborted();
    const mail = this.items.get(ref.id);
    if (!mail || mail.recipient !== recipient)
      throw new Error("Message does not belong to the inbox.");
    return mail;
  }
}
export function rawMail(subject: string, text = "Hello", html?: string) {
  const headers = `From: App <login@example.test>\r\nTo: header-recipient@example.test\r\nSubject: ${subject}\r\nMIME-Version: 1.0\r\n`;
  return html
    ? `${headers}Content-Type: text/html; charset=utf-8\r\n\r\n${html}`
    : `${headers}Content-Type: text/plain; charset=utf-8\r\n\r\n${text}`;
}
