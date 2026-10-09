# Release Hail to npm

Hail publishes `@everydaydevopsio/hail` through the manually dispatched [Release workflow](../.github/workflows/release.yml). No push to `main` or pull request publishes a package. Release validation is credential-free; publication requires the `npm` GitHub environment and npm trusted publishing.

## One-time setup

1. In GitHub, create an environment named `npm`. Restrict deployment to `main` and add required reviewers if the repository uses release approval. Configure branch protection so the workflow's `GITHUB_TOKEN` can push the release commit and tag, or the version step will stop before publishing.
2. In npm package settings for `@everydaydevopsio/hail`, add a GitHub Actions trusted publisher for owner `everydaydevopsio`, repository `hail`, workflow filename `release.yml`, and environment `npm`. Allow direct `npm publish`. The npm account must control the `@everydaydevopsio` scope. No long-lived `NPM_TOKEN` is used.
3. Confirm Actions may create a GitHub Release and that the environment and npm publisher settings match exactly. Do not place AWS, DNS, SES, or application credentials in this environment.

The first package publication may need an npm owner to establish the package and scope settings before trusted publishing can be configured. Check [npm's trusted publishing guide](https://docs.npmjs.com/trusted-publishers/) for first publication and configuration expiry. The workflow checks that npm CLI is at least 11.5.1 and includes the exact repository URL required for provenance.

## New release

1. Merge the reviewed change to `main` and confirm [Hail validation](../.github/workflows/ci.yml) is green for that commit. Live email verification remains a separate gate under [live verification](LIVE-VERIFICATION.md).
2. Open **Actions → Release → Run workflow**, select `main`, choose `patch`, `minor`, or `major`, and leave `retry_tag` blank. This dispatch is the explicit authorization to publish.
3. The workflow runs build, type, lint, format, coverage, unit, Python, browser, package, and Terraform validation/mock tests. It then updates `package.json` and `package-lock.json`, atomically pushes the release commit and matching `v` tag, checks out that tag, publishes to npm with provenance, and creates a GitHub Release.
4. Verify the package version and provenance on npm, the GitHub Release, and the generated Terraform module tag. A successful publish does not establish live AWS email delivery; use the live evidence contract for that claim.

The version is incremented from `package.json`, so with the initial `0.1.0`, a patch dispatch creates `0.1.1`. The release job cannot run from a branch other than `main`.

## Recovery

If validation or the atomic push fails, no package is published. Fix the failure on `main` and start a new dispatch.

If the tag was pushed but npm publication failed, first check whether that version appeared on npm despite the workflow error. If it did not, repair the registry or trusted publisher setup, then dispatch from `main` with `retry_tag` set to that exact tag. The workflow validates the tag and its release commit, reruns the gates on tagged source, and attempts publication without another version bump. A retry tag must point to a release commit on `main` created by this workflow.

If npm publication succeeded but GitHub Release creation failed, create the GitHub Release for the existing tag after checking the npm package. Do not dispatch a tagged retry: npm does not allow publishing the same version twice. If a published package has a defect, issue a corrected patch release; do not move or reuse its tag.
