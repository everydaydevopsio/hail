import { inspect } from 'node:util';
import { simpleParser, type ParsedMail } from 'mailparser';
import { load } from 'cheerio';
import type { StoredMail } from './store.js';

export type Pattern = string | RegExp;
export function matches(value: string, pattern?: Pattern): boolean {
  if (pattern === undefined) return true;
  return typeof pattern === 'string' ? value === pattern : new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, '')).test(value);
}
export interface LinkQuery { allowedOrigins: string[]; text?: Pattern; pathname?: Pattern }

export class EmailMessage {
  private constructor(private readonly parsed: ParsedMail, private readonly stored: StoredMail) {}
  static async parse(stored: StoredMail): Promise<EmailMessage> {
    const raw = typeof stored.raw === 'string' ? Buffer.from(stored.raw) : Buffer.from(stored.raw);
    return new EmailMessage(await simpleParser(raw, { skipHtmlToText: true, skipTextToHtml: true }), stored);
  }
  get id() { return this.stored.id; }
  get recipient() { return this.stored.recipient; }
  get receivedAt() { return this.stored.receivedAt; }
  get subject() { return this.parsed.subject ?? ''; }
  get from() { return this.parsed.from?.value.map(value => value.address ?? '').join(', ') ?? ''; }
  get text() { return this.parsed.text ?? ''; }
  get html() { return this.parsed.html || ''; }
  get attachments() { return this.parsed.attachments; }
  get delivery() { return this.stored.delivery ?? {}; }
  getLink(query: LinkQuery): string {
    if (!query.allowedOrigins.length) throw new Error('At least one allowed link origin is required.');
    const allowed = new Set(query.allowedOrigins.map(value => {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid allowed origin.');
      return url.origin;
    }));
    const candidates: { href: string; text: string }[] = [];
    if (this.html) {
      const document = load(this.html);
      document('a[href]').each((_index, element) => {
        const href = document(element).attr('href');
        if (href) candidates.push({ href, text: document(element).text().replace(/\s+/g, ' ').trim() });
      });
    }
    if (query.text === undefined) {
      for (const href of this.text.match(/https?:\/\/[^\s<>"']+/g) ?? []) candidates.push({ href, text: '' });
    }
    const links = new Set<string>();
    for (const candidate of candidates) {
      let url: URL;
      try { url = new URL(candidate.href); } catch { continue; }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !allowed.has(url.origin)) continue;
      if (matches(candidate.text, query.text) && matches(url.pathname, query.pathname)) links.add(candidate.href);
    }
    if (links.size !== 1) throw new Error(`Expected one matching safe link; found ${links.size}. Link values are redacted.`);
    return [...links][0];
  }
  getCode(pattern: RegExp = /\b(\d{6})\b/g): string {
    const expression = new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, '') + 'g');
    const content = this.text || load(this.html).text();
    const codes = new Set([...content.matchAll(expression)].map(match => match[1] ?? match[0]));
    if (codes.size !== 1) throw new Error(`Expected one distinct code; found ${codes.size}. Codes are redacted.`);
    return [...codes][0];
  }
  toJSON() { return { id: this.id, receivedAt: this.receivedAt, attachmentCount: this.attachments.length }; }
  [inspect.custom]() { return this.toJSON(); }
}
