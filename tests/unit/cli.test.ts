import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "../helpers/memory-store.js";

const execute = promisify(execFile);
const cli = resolve("src/cli.ts");
const run = (args: string[], options = {}) =>
  execute(process.execPath, ["--import", "tsx", cli, ...args], {
    timeout: 10_000,
    ...options,
  });

test("CLI help lists real commands and makes no network requests", async () => {
  const result = await run(["--help"]);
  assert.match(result.stdout, /hail init/);
  assert.match(result.stdout, /hail configure/);
  assert.match(result.stdout, /hail doctor/);
});
test("CLI rejects unknown commands and missing configure directory", async () => {
  await assert.rejects(run(["does-not-exist"]));
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
