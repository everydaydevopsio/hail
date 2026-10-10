import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "../helpers/memory-store.js";

const execute = promisify(execFile);
const cli = resolve("dist/cli.js");
const run = (args: string[], options = {}) =>
  execute(process.execPath, [cli, ...args], {
    timeout: 10_000,
    ...options,
  });

test("CLI help lists real commands and makes no network requests", async () => {
  const result = await run(["--help"]);
  assert.match(result.stdout, /hail init/);
  assert.match(result.stdout, /--file main\.tf/);
  assert.match(result.stdout, /--local-modules/);
  assert.match(result.stdout, /hail configure/);
  assert.match(result.stdout, /hail doctor/);
  assert.match(result.stdout, /hail smoke/);
});
test("issue #24: subcommand help describes options without credentials or network", async () => {
  for (const command of ["init", "configure", "doctor", "smoke"]) {
    for (const flag of ["--help", "-h"]) {
      const { stdout, stderr } = await run([command, flag], {
        env: {
          ...process.env,
          AWS_ACCESS_KEY_ID: "",
          AWS_SECRET_ACCESS_KEY: "",
          AWS_EC2_METADATA_DISABLED: "true",
          HAIL_CONFIG: "/does-not-exist",
        },
      });
      assert.equal(stderr, "");
      assert.match(stdout, new RegExp(`hail ${command}`));
      assert.match(stdout, /Example:/);
    }
  }
  const init = (await run(["init", "--help"])).stdout;
  assert.match(init, /--domain.*required/);
  assert.match(init, /--zone-name.*required/);
  assert.match(init, /--existing-rule-set.*--activate-new-rule-set/s);
  assert.match(init, /--region.*us-east-1/);
  assert.match(
    (await run(["configure", "--help"])).stdout,
    /--terraform-dir.*required/,
  );
  assert.match((await run(["doctor", "--help"])).stdout, /HAIL_CONFIG/);
  assert.match((await run(["smoke", "--help"])).stdout, /--profile/);
  assert.doesNotMatch(
    (await run(["smoke", "--help"])).stdout,
    /--reader-session-file|--account/,
  );
});
test("issue #24: invalid and missing options identify their flags", async () => {
  for (const args of [
    ["init"],
    ["init", "--domain", "mail.example.test"],
    ["init", "--dns", "unknown"],
    ["init", "--domain", "invalid", "--zone-name", "example.test"],
    ["init", "--domain", "mail.example.test", "--zone-name", "invalid"],
    ["configure"],
    ["doctor", "--bogus"],
    ["smoke"],
    ["init", "--domain"],
  ]) {
    await assert.rejects(run(args), (error: Error & { stderr?: string }) => {
      assert.doesNotMatch(error.stderr ?? "", /Hail failed \(TypeError\)/);
      assert.match(
        error.stderr ?? "",
        /--(?:domain|zone-name|dns|terraform-dir|bogus|from)/,
      );
      return true;
    });
  }
});
test("init rejects unsafe output filenames before contacting AWS", async () => {
  await assert.rejects(
    run([
      "init",
      "--dns",
      "manual",
      "--domain",
      "mail.example.test",
      "--zone-name",
      "example.test",
      "--activate-new-rule-set",
      "--file",
      "../escape.tf",
    ]),
    /without a path/,
  );
});
test("CLI rejects unknown commands and missing configure directory", async () => {
  await assert.rejects(run(["does-not-exist"]));
  await assert.rejects(run(["toString", "--help"]));
  await assert.rejects(run(["configure"]));
});
test("configure passes arguments without a shell and writes a protected allowlisted file", async () => {
  const parent = await mkdtemp(join(tmpdir(), "hail-cli-"));
  try {
    const executable = join(parent, "terraform");
    const argumentsFile = join(parent, "arguments.json");
    const output = join(parent, "hail.json");
    await writeFile(
      executable,
      `#!${process.execPath}\nrequire('node:fs').writeFileSync(process.env.ARGUMENTS_FILE, JSON.stringify(process.argv.slice(2)));\nconsole.log(process.env.TEST_CONFIG);\n`,
      { mode: 0o700 },
    );
    const env = {
      ...process.env,
      PATH: `${parent}:${process.env.PATH}`,
      ARGUMENTS_FILE: argumentsFile,
      TEST_CONFIG: JSON.stringify({ ...config, secret: "do-not-copy" }),
    };
    const directory = "/tmp/infra with spaces;not-a-command";
    await run(["configure", "--terraform-dir", directory, "--out", output], {
      env,
    });
    assert.deepEqual(JSON.parse(await readFile(argumentsFile, "utf8")), [
      `-chdir=${directory}`,
      "output",
      "-json",
      "hail_config",
    ]);
    assert.deepEqual(JSON.parse(await readFile(output, "utf8")), config);
    assert.equal((await stat(output)).mode & 0o777, 0o600);
    await assert.rejects(
      run(["configure", "--terraform-dir", directory, "--out", output], {
        env,
      }),
    );
    assert.deepEqual(JSON.parse(await readFile(output, "utf8")), config);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
