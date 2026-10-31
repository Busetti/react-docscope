# Releasing

Nothing is published automatically. Publishing requires a manual workflow run and approval of the
`npm` GitHub environment.

## One-time setup

1. Choose the final package name in `packages/react-docscope/package.json` (`react-docscope` is free
   on npm at the time of writing) and update `repository`/`homepage`/`bugs`.
2. Create the GitHub repository and push.
3. On npmjs.com, configure **Trusted Publishing** for the package: GitHub Actions, repository
   `<owner>/<repo>`, workflow `release.yml`, environment `npm`. No `NPM_TOKEN` secret is needed —
   the workflow authenticates with OIDC and publishes with provenance. (For the very first publish
   npm may require the package to exist; publish `0.1.0` once manually with `npm publish --access public`
   from `packages/react-docscope` after `pnpm build`, then switch to trusted publishing.)
4. In GitHub → Settings → Environments, create `npm` with required reviewers.

## Every release

```bash
pnpm changeset            # describe the change, pick patch/minor/major
git commit -am "docs: changeset" && git push
```

On `main`, the **Release** workflow (run manually via _Actions → Release → Run workflow_):

1. If there are pending changesets: opens/updates a "Version packages" PR (bumps version, writes
   `CHANGELOG.md`).
2. After that PR is merged, run it again: it builds, runs the test suites and the package smoke test,
   then waits for environment approval and publishes `react-docscope` with `npm publish --provenance`,
   and pushes the git tag.

Semantic versioning: breaking API changes → major; new features → minor; fixes → patch.
