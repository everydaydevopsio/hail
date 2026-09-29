import {
  S3Client,
  GetObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { fromTemporaryCredentials } from "@aws-sdk/credential-providers";
import { normalizeAddress, type HailConfig } from "./config.js";

export interface MessageRef {
  id: string;
  key: string;
  receivedAt: Date;
}
export interface StoredMail {
  id: string;
  recipient: string;
  receivedAt: Date;
  raw: Uint8Array | string;
  delivery?: Record<string, string>;
}
export interface MailStore {
  list(recipient: string, signal?: AbortSignal): Promise<MessageRef[]>;
  get(
    ref: MessageRef,
    recipient: string,
    signal?: AbortSignal,
  ): Promise<StoredMail>;
}

export function awsCredentials(config: HailConfig) {
  return config.roleArn
    ? fromTemporaryCredentials({
        clientConfig: { region: config.region },
        params: {
          RoleArn: config.roleArn,
          RoleSessionName: "hail-email-reader",
        },
      })
    : undefined;
}

export class S3MailStore implements MailStore {
  private readonly client: S3Client;
  constructor(
    readonly config: HailConfig,
    client?: S3Client,
    private readonly maxMessageBytes = 16 * 1024 * 1024,
  ) {
    this.client =
      client ??
      new S3Client({
        region: config.region,
        credentials: awsCredentials(config),
        maxAttempts: 3,
      });
  }
  private prefix(recipient: string): string {
    const address = normalizeAddress(recipient);
    if (address.split("@")[1] !== this.config.domain)
      throw new Error("Mailbox is outside the configured test domain.");
    return this.config.layout === "legacy"
      ? `${address}/`
      : `index/${address}/`;
  }
  async list(recipient: string, signal?: AbortSignal): Promise<MessageRef[]> {
    const prefix = this.prefix(recipient);
    const messages: MessageRef[] = [];
    let token: string | undefined;
    do {
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.config.bucketName,
          Prefix: prefix,
          ContinuationToken: token,
        }),
        { abortSignal: signal },
      );
      for (const object of response.Contents ?? []) {
        const extension = this.config.layout === "legacy" ? ".eml" : ".json";
        if (object.Key?.startsWith(prefix) && object.Key.endsWith(extension)) {
          messages.push({
            id: object.Key,
            key: object.Key,
            receivedAt: object.LastModified ?? new Date(0),
          });
        }
      }
      if (
        response.IsTruncated &&
        (!response.NextContinuationToken ||
          response.NextContinuationToken === token)
      ) {
        throw new Error("S3 returned an invalid pagination cursor.");
      }
      token = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (token);
    return messages.sort(
      (a, b) =>
        a.receivedAt.getTime() - b.receivedAt.getTime() ||
        a.key.localeCompare(b.key),
    );
  }
  private async read(
    key: string,
    limit: number,
    signal?: AbortSignal,
  ): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.config.bucketName, Key: key }),
      { abortSignal: signal },
    );
    if (!response.Body) throw new Error("Stored email has no content.");
    if ((response.ContentLength ?? 0) > limit)
      throw new Error("Stored email exceeds the configured size limit.");
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      signal?.throwIfAborted();
      const buffer = Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > limit)
        throw new Error("Stored email exceeds the configured size limit.");
      chunks.push(buffer);
    }
    return Buffer.concat(chunks);
  }
  async get(
    ref: MessageRef,
    recipient: string,
    signal?: AbortSignal,
  ): Promise<StoredMail> {
    const address = normalizeAddress(recipient);
    const prefix = this.prefix(address);
    if (
      !ref.key.startsWith(prefix) ||
      ref.key.slice(prefix.length).includes("/")
    )
      throw new Error("Message key is outside this mailbox.");
    let rawKey = ref.key;
    let receivedAt = ref.receivedAt;
    let delivery: Record<string, string> | undefined;
    if (this.config.layout === "indexed-v1") {
      const metadata = JSON.parse(
        (await this.read(ref.key, 64 * 1024, signal)).toString("utf8"),
      ) as Record<string, unknown>;
      if (
        metadata.schemaVersion !== 1 ||
        metadata.recipient !== address ||
        typeof metadata.rawKey !== "string" ||
        !/^incoming\/[a-zA-Z0-9_-]+$/.test(metadata.rawKey) ||
        typeof metadata.receivedAt !== "string"
      )
        throw new Error("Invalid mailbox metadata.");
      rawKey = metadata.rawKey;
      receivedAt = new Date(metadata.receivedAt);
      if (!Number.isFinite(receivedAt.getTime()))
        throw new Error("Invalid receipt timestamp.");
      if (metadata.delivery && typeof metadata.delivery === "object") {
        delivery = Object.fromEntries(
          Object.entries(metadata.delivery).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        );
      }
    }
    return {
      id: ref.id,
      recipient: address,
      receivedAt,
      delivery,
      raw: await this.read(rawKey, this.maxMessageBytes, signal),
    };
  }
}
