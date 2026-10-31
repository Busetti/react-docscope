#!/usr/bin/env node
/**
 * Reports what consumers download: the library's own output (dist) and, from
 * the playground build, the initial JS vs. lazily loaded renderer chunks
 * (minified + gzip, including third-party renderer dependencies).
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const kb = (n) => `${(n / 1024).toFixed(1)} kB`;
const gz = (buf) => gzipSync(buf, { level: 9 }).length;

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const lib = 'packages/react-docscope/dist';
const rows = walk(lib)
  .filter((f) => /\.(js|css)$/.test(f))
  .map((f) => {
    const buf = readFileSync(f);
    return { file: f.replace(`${lib}/`, ''), raw: buf.length, gzip: gz(buf) };
  })
  .sort((a, b) => b.gzip - a.gzip);

console.log('\nLibrary output (unminified ESM, dependencies external)');
for (const r of rows) console.log(`  ${r.file.padEnd(52)} ${kb(r.raw).padStart(10)} ${kb(r.gzip).padStart(10)} gz`);

const app = 'apps/playground/dist';
const html = readFileSync(join(app, 'index.html'), 'utf8');
const initial = [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]);
const assets = walk(join(app, 'assets')).filter((f) => f.endsWith('.js'));
const initialBytes = initial.reduce((n, f) => n + gz(readFileSync(join(app, f))), 0);
const lazy = assets
  .filter((f) => !initial.includes(f.replace(`${app}/`, '')))
  .map((f) => ({ file: f.replace(`${app}/assets/`, ''), gzip: gz(readFileSync(f)) }))
  .sort((a, b) => b.gzip - a.gzip);

console.log('\nPlayground production build (minified, gzip)');
console.log(`  initial load (React + react-docscope core + playground): ${kb(initialBytes)}`);
console.log('  largest lazy chunks:');
for (const l of lazy.slice(0, 12)) console.log(`    ${l.file.padEnd(58)} ${kb(l.gzip).padStart(10)}`);

writeFileSync('tests/performance/bundle-size.json', `${JSON.stringify({ library: rows, initialGzip: initialBytes, lazy }, null, 2)}\n`);
