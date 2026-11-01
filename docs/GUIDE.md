# Project guide

How react-docscope was built, how the Storybook works, how to publish to npm, and how to make and
ship changes. For API details see [API.md](API.md) and [CONFIGURATION.md](CONFIGURATION.md).

Links:

- Library repository: <https://github.com/Busetti/react-docscope>
- Live demo (GitHub Pages): <https://busetti.github.io/react-docscope/>
- Storybook: <https://busetti.github.io/react-docscope/storybook/>
- Sample app (Vercel): <https://github.com/Busetti/docscope-sample>
- npm: <https://www.npmjs.com/package/react-docscope>

---

## 1. What we implemented — in 10 steps

1. **Monorepo foundation.** A pnpm workspace with three parts: the library
   (`packages/react-docscope`), a playground app (`apps/playground`) and Storybook (`apps/docs`).
   TypeScript (strict), ESLint, Prettier, an MIT license and third-party notices.

2. **Storage-agnostic loading (the resolver).** The app passes a `resolver(document, context)`
   that returns a URL (+ optional headers) or a Blob. The library never knows about S3/GCS/Azure;
   it passes an `AbortSignal`, and when a signed URL has expired (HTTP 401/403) it calls the
   resolver once more by itself (`attempt: 1, reason: 'expired'`). Secrets never appear in logs.

3. **Core engine.** Format detection (MIME → extension), a renderer registry where each format is
   a lazily loaded chunk, a per-document state machine (`usePaneController`: resolve → load → render
   → ready / error, with fallback documents), bounded memory caches and download handling.

4. **Eleven renderers.** PDF (pdf.js in a Web Worker, virtualised pages, text layer, password
   prompt), images, Word (docx-preview), PowerPoint (pptxtojson + our own slide and SVG chart
   renderer), Excel (our own read-only reader running in a Web Worker), CSV (Papa Parse, streamed),
   Markdown, plain text/logs, JSON and XML (trees with paths), and video.

5. **User interface.** Inline `<DocumentPreviewer>`, `<PreviewModal>` and the
   `useDocumentPreview()` hook; toolbar driven by what each format supports; search with
   highlights; zoom/fit/rotate; attachments sidebar; details panel; fullscreen; split-screen
   compare; keyboard shortcuts; light/dark themes via CSS variables.

6. **Accessibility and translations.** ARIA grid/tree/listbox patterns, focus-trapped dialog, axe
   checks in tests. Every visible string is a label; German, French, Spanish and Hindi packs ship in
   `react-docscope/locales`.

7. **Security and performance.** No raw HTML from documents, sanitised PPTX text, SVG via `<img>`,
   XML without external entities, read-only Excel. Virtualised grids/lists/trees, Web Workers
   for PDF and Excel, request cancellation, size limits, prefetch of small neighbours only.

8. **Tests.** Jest (287 unit/integration tests, ~96 % statement coverage, 100 % branch coverage on
   critical modules, also run against React 18), Playwright end-to-end tests in Chromium, Firefox
   and WebKit, visual screenshot tests, performance budgets on large files, and a "smoke test"
   that installs the packed npm tarball into fresh React 18 and 19 apps.

9. **Docs and demos.** README, API/configuration/architecture/performance docs, an interactive
   playground (with a mock signed-URL backend), Storybook, and a GitHub Pages site that publishes
   both automatically.

10. **Automation and release.** GitHub Actions for CI (`ci.yml`), the demo site (`pages.yml`),
    regenerating screenshot baselines (`update-snapshots.yml`) and releases (`release.yml`,
    manual, with npm trusted publishing). Changesets manage versions and the changelog. A separate
    sample app (`docscope-sample`) shows real-world use on Vercel.

---

## 2. Storybook — how it was created and how to use it

Storybook lives in `apps/docs` and is a normal workspace package that depends on the library
through `"react-docscope": "workspace:*"`, so it always shows the code in this repository.

**How it was set up**

1. Created `apps/docs` with `storybook`, `@storybook/react-vite` (React + Vite framework) and
   `@storybook/addon-docs` (MDX pages and auto-generated docs).
2. `apps/docs/.storybook/main.ts` — where stories are (`stories/**/*.stories.tsx`, `*.mdx`) and
   `staticDirs` that serves `tests/fixtures` at `/fixtures`, so stories can load real sample files.
3. `apps/docs/.storybook/preview.ts` — imports `react-docscope/styles.css` and sets default
   parameters (layout, controls).
4. Stories: `Introduction.mdx` (landing page), `DocumentPreviewer.stories.tsx` (one story per
   format, failure states, configuration knobs), `PreviewModal.stories.tsx`; shared sample
   documents and a resolver in `stories/docs.ts`.

**Run, build, add a story**

```bash
pnpm build          # Storybook uses the built library (dist), so build it first
pnpm storybook      # dev server at http://localhost:6006
pnpm --filter docs build   # static build into apps/docs/storybook-static
```

To add a story, export a new object from a `*.stories.tsx` file:

```tsx
export const MyCase: Story = {
  args: { documents: [samples.pdf], config: { theme: 'dark' } },
};
```

New sample files go in `tests/fixtures/` and are referenced as `fixtures/<name>` (relative, so
they also work under `/storybook/` on GitHub Pages).

**Deployment:** every push to `main` runs `pages.yml`, which builds the playground and Storybook
(`pnpm build:pages`) and publishes them to GitHub Pages. Storybook appears at `/storybook/`.

---

## 3. Publishing the library to npm

Publishing public packages on npm is free. Nothing is ever published automatically.

### First release (manual, once)

Prerequisites: an npm account with **two-factor authentication enabled**
(npmjs.com → Account → Two-Factor Authentication) and pnpm installed
(`npm install -g pnpm@10.18.3` if `corepack` fails on your Node version).

```bash
git pull origin main
pnpm install
pnpm build
cd packages/react-docscope
npm login
npm publish --access public --provenance=false   # add --otp=123456 if asked for a code
```

`--provenance=false` is needed on a laptop; provenance statements can only be generated in CI.
Check the result: `npm view react-docscope version`.

### One-time setup for automated releases (after the first publish)

1. **npm trusted publishing:** npmjs.com → package `react-docscope` → Settings → Trusted
   Publisher → GitHub Actions: owner `Busetti`, repository `react-docscope`, workflow
   `release.yml`, environment `npm`. No npm token is stored anywhere.
2. **GitHub environment:** repository → Settings → Environments → New environment `npm` → add
   yourself as a required reviewer (every publish then waits for your approval).
3. **Allow the release bot to open PRs:** Settings → Actions → General → Workflow permissions →
   tick "Allow GitHub Actions to create and approve pull requests".

### Every later release

1. Changes reach `main` with a **changeset** (see section 4).
2. GitHub → **Actions → Release → Run workflow**. It opens a PR called
   _"chore: version packages"_ that bumps the version and writes `CHANGELOG.md`.
3. Review and merge that PR. (PRs created by the workflow's token do not trigger CI on their own;
   close and reopen the PR if you want the checks to run on it.)
4. Run **Actions → Release → Run workflow** again. It builds, tests, runs the package smoke test,
   waits for your approval of the `npm` environment, publishes with provenance and pushes a git tag
   such as `react-docscope@0.2.0`.

Versioning: bug fix → **patch** (0.1.1), new feature → **minor** (0.2.0), breaking API change →
**major** (1.0.0). Until 1.0.0, breaking changes are usually released as minor.

---

## 4. Making changes and shipping them

### Day-to-day loop

```bash
git pull origin main
git checkout -b feat/my-change          # one branch per change
pnpm install
pnpm dev                                # library watch + playground at http://localhost:5173
```

Edit code in `packages/react-docscope/src`, try it in the playground, add or update tests next to
the code (`*.test.ts(x)`), and update docs in `README.md` / `docs/` when behaviour changes.

### Check before pushing

```bash
pnpm lint && pnpm format:check && pnpm typecheck
pnpm test:coverage        # Jest + coverage gates
pnpm test:react18         # same suite on React 18
pnpm test:e2e             # Playwright (builds first; Chromium locally)
pnpm test:smoke           # optional: installs the packed package in fresh apps
```

`pnpm format` fixes formatting automatically.

### Describe the change for the changelog

```bash
pnpm changeset            # pick patch / minor / major and write one line for users
```

This creates a small file in `.changeset/` — commit it with your code. Docs-only or test-only
changes don't need one.

### Push and merge

```bash
git add -A
git commit -m "feat(pdf): describe what changed"
git push -u origin feat/my-change
```

Open a pull request on GitHub. CI runs lint, types, unit tests, Playwright (Chromium, Firefox,
WebKit, visual, performance), the package smoke tests and the Storybook build. Merge when green.
Merging to `main` also redeploys the demo site automatically. To ship the change to npm, follow
"Every later release" above.

### If a visual (screenshot) test fails on purpose

When you intentionally change the look of a previewer, refresh the baselines on GitHub's runner
(fonts differ elsewhere):

```bash
git push origin HEAD:update-snapshots/my-change
```

The _Update visual baselines_ workflow commits new screenshots to that branch. Review the images,
then merge or cherry-pick that commit into your branch.

### Updating the sample app after a release

In `docscope-sample`:

```bash
npm install react-docscope@latest
npm test && npm run build
git commit -am "chore: update react-docscope" && git push
```

Vercel redeploys automatically on every push to its `main` branch.

---

## Repository map

```text
packages/react-docscope/   the library (src/, tests next to code, vite.config.ts builds dist/)
apps/playground/           interactive demo; fixtures-server.ts = mock backend
apps/docs/                 Storybook
tests/                     fixtures, integration tests, Playwright e2e / visual / performance
scripts/                   fixtures generation, smoke test, coverage gate, Pages build
docs/                      API, configuration, architecture, performance, releasing, this guide
.github/workflows/         ci, pages, update-snapshots, release
.changeset/                pending changelog entries
```
