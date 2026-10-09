# Release Hail to npm

Hail releases `@everydaydevopsio/hail` through the manually dispatched [Release workflow](../.github/workflows/release.yml). No push to `main` or pull request publishes a package. The first package version is published by an npm organization owner from a workflow-created tag. Later versions use npm trusted publishing. New releases use [Castoff](https://github.com/everydaydevopsio/castoff) for GitHub Release notes and a tagged `CHANGELOG.md` entry.

The first release, [`v0.1.1`](https://github.com/everydaydevopsio/hail/releases/tag/v0.1.1), was published from tag commit `17866c41ee2b0814db7b70bc1cd6ca38c5a51163` on 2026-10-09. The bootstrap [release run](https://github.com/everydaydevopsio/hail/actions/runs/37893690737) passed its gates; the package audit found 28 files, and the public package's `hail --help` command passed. This is package publication evidence, not live email delivery evidence.

The first trusted publication, [`v0.1.2`](https://github.com/everydaydevopsio/hail/releases/tag/v0.1.2), succeeded on a [retry of its existing tag](https://github.com/everydaydevopsio/hail/actions/runs/37944187301) after direct `npm publish` was enabled for the npm trusted publisher. npm lists `0.1.2` as `latest` with a SLSA provenance attestation. A fresh consumer install linked `hail` and its `--help` command passed. The package release does not establish live email delivery.

## First publication

The package must exist on npm before [npm trust](https://docs.npmjs.com/cli/v11/commands/npm-trust/) can bind it to a GitHub workflow. Use this once for the initial version:

1. Merge the reviewed release workflow to `main` and confirm [Hail validation](../.github/workflows/ci.yml) is green. Configure branch protection so the workflow's `GITHUB_TOKEN` can push the release commit and tag.
2. Dispatch **Actions → Release** from `main`, choose a semver increment, leave `retry_tag` blank, and check `bootstrap_first_release`. The workflow validates the source and pushes its release commit and matching `v` tag, then stops successfully before npm publication.
3. Fetch the tag and check out that exact source in a clean worktree. With an npm account that owns the `@everydaydevopsio` scope, run `npm ci`, `npm run build`, `npm run test:package`, then `npm publish --access public --ignore-scripts`. Complete npm's interactive authentication if prompted. Verify the package version on npm, then create the GitHub Release for the tag.
4. Create a GitHub environment named `npm`, restricted to `main`. Add a trusted publisher for owner `everydaydevopsio`, repository `hail`, workflow filename `release.yml`, environment `npm`, and direct `npm publish` permission. With npm CLI 11.15.0 or newer, an organization owner can run `npm trust github @everydaydevopsio/hail --repository everydaydevopsio/hail --file release.yml --environment npm --allow-publish` (npm may request two-factor authentication). No long-lived `NPM_TOKEN` is needed for later releases.

The initial authenticated publication does not have CI provenance. Later releases use npm's OIDC provenance. Do not put AWS, DNS, SES, or application credentials in the `npm` environment.

## Castoff setup

Grant an Actions secret named `OPENAI_API_KEY` to the Hail repository under **Settings → Secrets and variables → Actions**. A repository secret or an organization secret granted to `everydaydevopsio/hail` works. The release workflow checks that it is nonempty before running its validation gates or creating a tag, and Castoff receives it only as an action input. Optionally set the Actions variable `OPENAI_MODEL`; otherwise Castoff uses its default model. This key is for manual releases only; pull-request CI remains credential-free. Confirm the key can call the selected model before dispatching a new release.

## New release

1. Merge the reviewed change to `main` and confirm [Hail validation](../.github/workflows/ci.yml) is green for that commit. Live email verification remains a separate gate under [live verification](LIVE-VERIFICATION.md).
2. Open **Actions → Release → Run workflow**, select `main`, choose `patch`, `minor`, or `major`, and leave `retry_tag` blank and `bootstrap_first_release` unchecked. This dispatch is the explicit authorization to publish.
3. The workflow checks the OpenAI key, then runs build, type, lint, format, coverage, unit, Python, browser, package, and Terraform validation/mock tests. It updates `package.json` and `package-lock.json`, runs Castoff against the commits since the prior release, and writes the versioned `CHANGELOG.md` entry. Only after those steps pass does it atomically push the release commit and matching `v` tag.
4. The tagged source publishes to npm with provenance. The GitHub Release uses Castoff's generated notes, including its attribution. Verify the package version and provenance on npm, the GitHub Release, the tagged changelog, and the generated Terraform module tag. A successful publish does not establish live AWS email delivery; use the live evidence contract for that claim.

The version is incremented from `package.json`, so with the initial `0.1.0`, a patch dispatch creates `0.1.1`. The release job cannot run from a branch other than `main`.

## Recovery

If validation or the atomic push fails, no package is published. Fix the failure on `main` and start a new dispatch.

If the OpenAI key is missing or Castoff fails, no release commit or tag is created. Grant the secret or resolve the Castoff error, then start a new dispatch. Castoff sends commit subjects and short hashes for the release range to the configured OpenAI model; keep secrets out of commit messages.

If the tag was pushed but npm publication failed, first check whether that version appeared on npm despite the workflow error. If it did not, repair the registry or trusted publisher setup, then dispatch from `main` with `retry_tag` set to that exact tag. The workflow validates the tag and its release commit, reruns the gates on tagged source, and attempts publication without another version bump. A retry tag must point to a release commit on `main` created by this workflow.

Tagged retries do not call Castoff or change the changelog. If a retry reaches GitHub Release creation, it uses GitHub generated notes because Castoff notes from the original dispatch are not carried between runs; the tagged changelog retains the original Castoff summary. If exact original release prose is required, use that run's notes when creating the GitHub Release manually after npm publication.

For `403 OIDC permission denied for this action`, check the trusted publisher's **Allowed actions** on npmjs.com. The connection must allow direct `npm publish`; newly created connections can allow staged publishing only. Match the repository, `release.yml` filename, and `npm` environment exactly before retrying.

If npm publication succeeded but GitHub Release creation failed, create the GitHub Release for the existing tag after checking the npm package. Do not dispatch a tagged retry: npm does not allow publishing the same version twice. If a published package has a defect, issue a corrected patch release; do not move or reuse its tag.
