# Contributing

Thanks for helping! This is a pnpm monorepo (Node ≥ 20.19, pnpm 10).

```bash
corepack enable
pnpm install
pnpm dev                 # library in watch mode + playground on http://localhost:5173
```

## Layout

| Path                                                  | What                                                                                 |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `packages/react-docscope/src/core`                    | Framework-free logic: resolver, sources, caches, registry, config, search, sanitizer |
| `packages/react-docscope/src/renderers`               | One folder per format (lazy chunks) + shared virtualized views                       |
| `packages/react-docscope/src/components`, `hooks`     | Workspace UI, modal, compare, pane controller, public hooks                          |
| `apps/playground`                                     | Demo app consuming the **built** package via its public exports                      |
| `apps/docs`                                           | Storybook                                                                            |
| `tests/fixtures`                                      | Sample documents (regenerate: `python3 scripts/fixtures/generate_fixtures.py`)       |
| `tests/integration`, `tests/e2e`, `tests/performance` | Jest integration, Playwright, perf                                                   |

## Checks (run before opening a PR)

```bash
pnpm lint && pnpm format:check && pnpm typecheck
pnpm test:coverage       # Jest; thresholds ≥95% statements / ≥90% branches, critical core 100% branches
pnpm test:react18        # same suite against React 18
pnpm test:e2e            # Playwright (Chromium); E2E_ALL_BROWSERS=1 adds Firefox & WebKit
pnpm test:visual         # screenshot tests (Linux baselines; update with --update-snapshots)
pnpm test:smoke          # pack + install into a fresh Vite app (+ `-- --react 18`)
```

## Guidelines

- Keep renderers **read-only** and lazy-loaded; declare honest `capabilities`.
- Never log URLs, headers or document content. Use `DocumentPreviewError` with safe messages.
- New behaviour needs tests (unit + a real fixture where possible). Prefer real files over mocks.
- UI must stay keyboard-accessible and pass axe (`jest-axe` / `@axe-core/playwright`).
- Add a changeset (`pnpm changeset`) for user-facing changes.
- Commit messages follow Conventional Commits (`feat:`, `fix:`, `docs:` …).

## Reporting security issues

Please do not open public issues for vulnerabilities — see [SECURITY.md](SECURITY.md).
