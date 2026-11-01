#!/usr/bin/env node
/**
 * Builds the static demo site for GitHub Pages into ./site:
 *   /            playground (mock backend via service worker, large fixtures included)
 *   /storybook/  Storybook
 * Usage: PAGES_BASE=/react-docscope/ node scripts/build-pages.mjs
 */
import { execSync } from 'node:child_process';
import { cpSync, existsSync, rmSync, writeFileSync } from 'node:fs';

const base = process.env.PAGES_BASE ?? '/react-docscope/';
const run = (cmd, env = {}) => execSync(cmd, { stdio: 'inherit', env: { ...process.env, ...env } });

if (!existsSync('tests/fixtures/large/large.pdf')) run('pnpm fixtures');
run('pnpm build');
run('pnpm --filter playground build', {
  PLAYGROUND_BASE: base,
  VITE_DEMO_SW: '1',
  PLAYGROUND_LARGE_FIXTURES: '1',
});
run('pnpm --filter docs build');

rmSync('site', { recursive: true, force: true });
cpSync('apps/playground/dist', 'site', { recursive: true });
cpSync('apps/docs/storybook-static', 'site/storybook', { recursive: true });
// Storybook copies every fixture; its stories only use the small ones.
rmSync('site/storybook/fixtures/large', { recursive: true, force: true });
// Source maps are not needed on the demo site.
run(`find site -name '*.map' -delete`);
writeFileSync('site/.nojekyll', '');
console.log(`\nPages site built in ./site (base ${base})`);
