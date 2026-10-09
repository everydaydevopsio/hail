import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  rm,
  access,
  mkdir,
  writeFile,
} from "node:fs/promises";
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
const packageVersion = JSON.parse(
  await readFile(new URL("../../package.json", import.meta.url), "utf8"),
).version as string;
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
  test(`generates pinned ${dns} Terraform in an existing directory`, async () => {
    const parent = await mkdtemp(join(tmpdir(), "hail-setup-"));
    const out = join(parent, "receiver");
    try {
      await mkdir(out);
      await writeFile(join(out, ".gitignore"), "keep-existing\n");
      await scaffold({
        ...base,
        dns,
        zoneId:
          dns === "route53" ? "Z123456" : "0123456789abcdef0123456789abcdef",
        out,
        file: "hail-receiver.tf",
      });
      const main = await readFile(join(out, "hail-receiver.tf"), "utf8");
      assert.equal(
        await readFile(join(out, ".gitignore"), "utf8"),
        "keep-existing\n",
      );
      assert.ok(
        main.includes(
          `hail.git//terraform/modules/receiver?ref=v${packageVersion}`,
        ),
      );
      if (dns !== "cloudflare")
        assert.ok(!main.includes('provider "cloudflare"'));
      await assert.rejects(
        access(join(out, "modules/receiver/lambda/handler.py")),
      );
      assert.match(
        await readFile(join(out, "example.spec.ts"), "utf8"),
        /visitAuthLink/,
      );
      const variables = JSON.parse(
        await readFile(join(out, "terraform.tfvars.json"), "utf8"),
      );
      assert.equal(variables.domain, base.domain);
      assert.equal(variables.external_indexer_role_arn, null);
      assert.equal(variables.external_reader_role_arn, null);
      assert.equal(variables.permissions_boundary_arn, null);
      assert.deepEqual(variables.tags, {});
      for (const input of [
        "external_indexer_role_arn",
        "external_reader_role_arn",
        "permissions_boundary_arn",
        "tags",
      ])
        assert.ok(main.includes(input));
      await assert.rejects(
        scaffold({ ...base, out, file: "hail-receiver.tf" }),
        { code: "EEXIST" },
      );
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
}
test("local module mode copies and references the bundled module", async () => {
  const out = join(await mkdtemp(join(tmpdir(), "hail-local-")), "receiver");
  try {
    await scaffold({ ...base, out, localModules: true });
    assert.match(
      await readFile(join(out, "main.tf"), "utf8"),
      /source\s+= "\.\/modules\/receiver"/,
    );
    await access(join(out, "modules/receiver/lambda/handler.py"));
  } finally {
    await rm(join(out, ".."), { recursive: true, force: true });
  }
});
test("rejects unsafe Terraform filenames and preserves conflicting files", async () => {
  for (const file of ["../other.tf", "nested/main.tf", "bad.txt", "", ".tf"])
    assert.throws(() => validateInit({ ...base, file }), /file/i);
  const out = await mkdtemp(join(tmpdir(), "hail-conflict-"));
  try {
    await writeFile(join(out, "main.tf"), "existing\n");
    await assert.rejects(scaffold({ ...base, out }), { code: "EEXIST" });
    assert.equal(await readFile(join(out, "main.tf"), "utf8"), "existing\n");
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});
