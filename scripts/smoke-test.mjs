#!/usr/bin/env node
/**
 * Package smoke test: packs react-docscope, installs the tarball into a fresh
 * Vite + React + TypeScript app (React 19 by default, `--react 18` for 18),
 * type-checks and builds it, then (if Playwright is available) opens the built
 * app in Chromium and verifies a PDF, an XLSX and a Markdown file render
 * without console errors. Nothing is published.
 */
import { execSync, spawn } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const reactMajor = process.argv.includes('--react') ? process.argv[process.argv.indexOf('--react') + 1] : '19';
const keep = process.argv.includes('--keep');
const run = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'inherit', env: { ...process.env, CI: '1' } });

const work = mkdtempSync(join(tmpdir(), 'docscope-smoke-'));
console.log(`› workspace ${work} (React ${reactMajor})`);
try {
  run('pnpm --filter react-docscope build', root);
  run(`pnpm pack --pack-destination ${work}`, join(root, 'packages/react-docscope'));
  const tarball = readdirSync(work).find((f) => f.endsWith('.tgz'));
  const app = join(work, 'app');
  mkdirSync(join(app, 'src'), { recursive: true });
  mkdirSync(join(app, 'public'), { recursive: true });
  for (const f of ['sample.pdf', 'budget.xlsx', 'readme.md']) cpSync(join(root, 'tests/fixtures', f), join(app, 'public', f));
  const reactVersion = reactMajor === '18' ? '^18.3.1' : '^19.3.1';
  writeFileSync(
    join(app, 'package.json'),
    JSON.stringify(
      {
        name: 'docscope-smoke-app',
        private: true,
        type: 'module',
        scripts: { build: 'tsc --noEmit && vite build' },
        dependencies: { 'react-docscope': `file:../${tarball}`, react: reactVersion, 'react-dom': reactVersion },
        devDependencies: {
          '@types/react': reactMajor === '18' ? '^18.3.12' : '^19.3.0',
          '@types/react-dom': reactMajor === '18' ? '^18.3.1' : '^19.3.0',
          '@vitejs/plugin-react': '^6.1.2',
          typescript: '~6.0.3',
          vite: '^8.3.5',
        },
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(app, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx', strict: true, skipLibCheck: false, noEmit: true, types: ['vite/client'] }, include: ['src'] }, null, 2),
  );
  writeFileSync(join(app, 'vite.config.ts'), `import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\nexport default defineConfig({ plugins: [react()] });\n`);
  writeFileSync(join(app, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><title>smoke</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>`);
  // The consumer integration from the README, verbatim in spirit (~15 lines).
  writeFileSync(
    join(app, 'src/main.tsx'),
    `import { createRoot } from 'react-dom/client';
import { DocumentPreviewer, type DocumentResolver, type PreviewDocument } from 'react-docscope';
import 'react-docscope/styles.css';

const documents: PreviewDocument[] = [
  { id: 'pdf', name: 'sample.pdf' },
  { id: 'xlsx', name: 'budget.xlsx' },
  { id: 'md', name: 'readme.md' },
];
const resolver: DocumentResolver = async (doc) => ({ kind: 'url', url: '/' + doc.name });

createRoot(document.getElementById('root')!).render(
  <DocumentPreviewer documents={documents} resolver={resolver} config={{ height: 700 }} />,
);
`,
  );
  run('npm install --no-audit --no-fund --loglevel=error', app);
  run('npm run build', app);
  console.log('✓ typecheck + production build succeeded');

  let playwright;
  for (const name of ['playwright', '@playwright/test']) {
    try {
      playwright = await import(name);
      break;
    } catch {
      /* try next */
    }
  }
  if (!playwright) console.log('ℹ playwright not available — skipping browser check');
  if (playwright) {
    const port = 4400 + Math.floor(Math.random() * 500);
    const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { cwd: app, stdio: 'ignore', detached: true });
    for (let i = 0; i < 60; i += 1) {
      try {
        if ((await fetch(`http://localhost:${port}/`)).ok) break;
      } catch {
        /* not up yet */
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    const browser = await playwright.chromium.launch();
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    try {
      await page.goto(`http://localhost:${port}/`);
      await page.waitForSelector('.dsc-pdf-page canvas[data-rendered="true"]', { timeout: 30000 });
      await page.getByRole('button', { name: 'Next document' }).click();
      await page.getByText('FY2026 Budget').waitFor({ timeout: 30000 });
      await page.getByRole('button', { name: 'Next document' }).click();
      await page.getByRole('heading', { name: 'DocScope Markdown sample' }).waitFor({ timeout: 30000 });
      if (errors.length) throw new Error(`Console errors:\n${errors.join('\n')}`);
      console.log('✓ PDF (bundled worker), XLSX and Markdown render in Chromium with no console errors');
    } finally {
      await browser.close();
      process.kill(-server.pid); // whole process group (npx + vite)
    }
  }
} finally {
  if (keep) console.log(`(kept ${work})`);
  else rmSync(work, { recursive: true, force: true });
}
