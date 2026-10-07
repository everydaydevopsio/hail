#!/usr/bin/env node
// Purge only a manifest-owned Hail receiver bucket before Terraform destroy.
import { readFile } from "node:fs/promises";
import {
  S3Client,
  GetBucketTaggingCommand,
  ListObjectsV2Command,
  ListObjectVersionsCommand,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";

const [manifestPath, expectedBucket] = process.argv.slice(2);
if (!manifestPath || !expectedBucket)
  throw new Error("manifest path and exact bucket required");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (
  !/^hail-[a-z0-9-]+$/.test(manifest.runId) ||
  manifest.receiver?.bucket !== expectedBucket ||
  manifest.receiver?.status !== "deployed" ||
  manifest.retention !== "destroy-after-validation"
)
  throw new Error("Receiver manifest ownership mismatch");

const region = manifest.region;
const sts = new STSClient({ region, maxAttempts: 1 });
const identity = await sts.send(new GetCallerIdentityCommand({}));
if (
  identity.Account !== manifest.accountId ||
  !identity.Arn?.startsWith(
    `arn:aws:sts::${manifest.accountId}:assumed-role/${manifest.runId}-provisioner/`,
  )
)
  throw new Error("Restricted provisioner identity mismatch");
const s3 = new S3Client({ region, maxAttempts: 2 });
const tags =
  (await s3.send(new GetBucketTaggingCommand({ Bucket: expectedBucket })))
    .TagSet ?? [];
const tag = new Map(tags.map((item) => [item.Key, item.Value]));
if (
  tag.get("Project") !== "hail" ||
  tag.get("Environment") !== "test" ||
  tag.get("RunId") !== manifest.runId ||
  tag.get("Owner") !== manifest.owner ||
  tag.get("ExpiresAt") !== manifest.expiresAt
)
  throw new Error("Bucket tag ownership mismatch");

let removed = 0;
for (let pass = 0; pass < 20; pass++) {
  const current = await s3.send(
    new ListObjectsV2Command({ Bucket: expectedBucket, MaxKeys: 1000 }),
  );
  const versions = await s3.send(
    new ListObjectVersionsCommand({ Bucket: expectedBucket, MaxKeys: 1000 }),
  );
  const objects = new Map();
  for (const item of current.Contents ?? [])
    if (item.Key) objects.set(`${item.Key}\0`, { Key: item.Key });
  for (const item of [
    ...(versions.Versions ?? []),
    ...(versions.DeleteMarkers ?? []),
  ])
    if (item.Key && item.VersionId)
      objects.set(`${item.Key}\0${item.VersionId}`, {
        Key: item.Key,
        VersionId: item.VersionId,
      });
  if (objects.size === 0) {
    if (current.IsTruncated || versions.IsTruncated)
      throw new Error("Unexpected truncated empty listing");
    console.log(`Purged ${removed} run-owned object entries; bucket is empty`);
    process.exit(0);
  }
  const result = await s3.send(
    new DeleteObjectsCommand({
      Bucket: expectedBucket,
      Delete: { Objects: [...objects.values()], Quiet: true },
    }),
  );
  if (result.Errors?.length)
    throw new Error(
      `Object deletion failed for ${result.Errors.length} entries`,
    );
  removed += objects.size;
}
throw new Error("Bucket purge did not converge within 20 bounded passes");
