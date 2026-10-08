#!/usr/bin/env node
// Copy only public-package tests and their local helpers into an installed consumer.
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const consumer = process.argv[2] && resolve(process.argv[2]);
if (!consumer)
  throw new Error(
    "Usage: node scripts/prepare-live-consumer.mjs /private/consumer",
  );
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (consumer.startsWith(`${root}/`) || consumer === root)
  throw new Error("The consumer project must be outside the Hail repository");
const manifest = JSON.parse(
  await readFile(
    join(consumer, "node_modules/@everydaydevopsio/hail/package.json"),
    "utf8",
  ),
);
if (manifest.name !== "@everydaydevopsio/hail")
  throw new Error("Packed Hail installation missing");
const target = join(consumer, "tests");
await mkdir(target, { recursive: true, mode: 0o700 });
for (const [from, to] of [
  ["tests/consumer/live-workflows.spec.ts", "live-workflows.spec.ts"],
  ["tests/consumer/live-playwright.config.ts", "live-playwright.config.ts"],
  ["tests/helpers/demo-app.ts", "demo-app.ts"],
  ["tests/helpers/live-aws.ts", "live-aws.ts"],
])
  await copyFile(join(root, from), join(target, to));
console.log("Prepared packed consumer live tests outside the Hail repository");
