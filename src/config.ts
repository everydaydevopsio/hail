import { readFile } from "node:fs/promises";

export interface HailConfig {
  schemaVersion: 1;
  domain: string;
  bucketName: string;
  region: string;
  layout: "indexed-v1" | "legacy";
  roleArn?: string;
  ruleSetName?: string;
  ruleName?: string;
}

export function normalizeDomain(value: string): string {
  const domain = value.toLowerCase().replace(/\.$/, "");
  if (
    domain.length > 253 ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)
  ) {
    throw new Error("Use a valid ASCII DNS domain.");
  }
  return domain;
}

export function normalizeAddress(value: string): string {
  const address = value.toLowerCase();
  const parts = address.split("@");
  if (parts.length !== 2 || !/^[a-z0-9][a-z0-9._+-]{0,63}$/.test(parts[0])) {
    throw new Error(
      "Use a simple test mailbox address with a local part of at most 64 characters.",
    );
  }
  return `${parts[0]}@${normalizeDomain(parts[1])}`;
}

export function parseConfig(value: unknown): HailConfig {
  if (!value || typeof value !== "object")
    throw new Error("Hail configuration must be an object.");
  const data = value as Record<string, unknown>;
  if (data.schemaVersion !== 1)
    throw new Error("Unsupported Hail configuration schemaVersion.");
  if (
    typeof data.domain !== "string" ||
    typeof data.bucketName !== "string" ||
    typeof data.region !== "string"
  ) {
    throw new Error(
      "Hail configuration requires domain, bucketName, and region.",
    );
  }
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(data.bucketName))
    throw new Error("Invalid S3 bucket name.");
  if (!/^[a-z]{2}(?:-gov)?-[a-z]+-\d+$/.test(data.region))
    throw new Error("Invalid AWS region.");
  if (data.layout !== "indexed-v1" && data.layout !== "legacy")
    throw new Error("Unsupported mailbox storage layout.");
  const result: HailConfig = {
    schemaVersion: 1,
    domain: normalizeDomain(data.domain),
    bucketName: data.bucketName,
    region: data.region,
    layout: data.layout,
  };
  for (const name of ["roleArn", "ruleSetName", "ruleName"] as const) {
    if (data[name] != null) {
      if (typeof data[name] !== "string" || !data[name])
        throw new Error(`Invalid ${name}.`);
      result[name] = data[name];
    }
  }
  if (
    result.roleArn &&
    !/^arn:aws(?:-us-gov|-cn)?:iam::\d{12}:role\/.+$/.test(result.roleArn)
  )
    throw new Error("Invalid reader role ARN.");
  return result;
}

export async function loadConfig(
  path = process.env.HAIL_CONFIG ?? "hail.config.json",
): Promise<HailConfig> {
  return parseConfig(JSON.parse(await readFile(path, "utf8")));
}
