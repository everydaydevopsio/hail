import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scaffold, validateInit, type InitOptions } from "../../src/setup.js";

const base: InitOptions = {
  dns: "manual",
  domain: "mail.example.test",
  zoneName: "example.test",
  region: "us-east-1",
  name: "hail-test",
  out: "unused",
  activateNewRuleSet: true,
};
test("refuses apex or unrelated domains", () => {
  assert.throws(
    () => validateInit({ ...base, domain: "example.test" }),
    /apex/,
  );
  assert.throws(
    () => validateInit({ ...base, domain: "example.test.evil.test" }),
    /apex/,
  );
});
test("requires an explicit receipt-rule activation choice", () => {
  assert.throws(() => validateInit({ ...base, activateNewRuleSet: false }));
  assert.throws(() => validateInit({ ...base, existingRuleSet: "shared" }));
});
test("requires a zone ID for managed DNS and validates region/name", () => {
  assert.throws(() => validateInit({ ...base, dns: "cloudflare" }));
  assert.throws(() => validateInit({ ...base, region: "nowhere-9" }));
  assert.throws(() => validateInit({ ...base, name: "bad name" }));
});
for (const dns of ["manual", "cloudflare", "route53"] as const) {
  test(`generates a standalone ${dns} Terraform tree without overwriting files`, async () => {
    const parent = await mkdtemp(join(tmpdir(), "hail-setup-"));
    const out = join(parent, "receiver");
    try {
      await scaffold({
        ...base,
        dns,
        zoneId:
          dns === "route53" ? "Z123456" : "0123456789abcdef0123456789abcdef",
        out,
      });
      const main = await readFile(join(out, "main.tf"), "utf8");
      assert.ok(main.includes('"./modules/receiver"'));
      if (dns !== "cloudflare")
        assert.ok(!main.includes('provider "cloudflare"'));
      await access(join(out, "modules/receiver/lambda/handler.py"));
      assert.equal(
        JSON.parse(await readFile(join(out, "terraform.tfvars.json"), "utf8"))
          .domain,
        base.domain,
      );
      await assert.rejects(scaffold({ ...base, out }), { code: "EEXIST" });
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
}
