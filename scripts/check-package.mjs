import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const output = execFileSync("npm", ["pack", "--dry-run", "--json"], {
  encoding: "utf8",
  maxBuffer: 1024 * 1024,
});
const [packageInfo] = JSON.parse(output);
const paths = new Set(packageInfo.files.map((file) => file.path));
for (const required of [
  "dist/index.js",
  "dist/index.d.ts",
  "dist/playwright.js",
  "dist/playwright.d.ts",
  "dist/cli.js",
  "terraform/examples/cloudflare/main.tf",
  "terraform/examples/route53/main.tf",
  "terraform/examples/manual/main.tf",
  "terraform/modules/receiver/lambda/handler.py",
])
  assert.ok(paths.has(required), `Package is missing ${required}`);
for (const path of paths) {
  assert.ok(
    !/(^|\/)(?:\.terraform|__pycache__|node_modules|upstream|tests|test-results|playwright-report)(?:\/|$)|\.(?:pyc|tfstate|tfplan|eml|tgz)$|(?:^|\/)(?:\.env|hail\.config\.json)/.test(
      path,
    ),
    `Package contains forbidden file ${path}`,
  );
}
console.log(`Package audit passed: ${paths.size} files`);
