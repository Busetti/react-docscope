#!/usr/bin/env node
/**
 * Enforces stricter coverage for the critical document-management, resolver,
 * registry and configuration modules (Jest excludes path-specific files from
 * its global threshold, so this check runs separately on coverage-summary.json).
 */
import { readFileSync } from 'node:fs';

const CRITICAL = [
  'source',
  'config',
  'registry',
  'cache',
  'errors',
  'detect',
  'download',
  'search',
];
const MIN = { statements: 97, branches: 100, functions: 100, lines: 99 };

const summary = JSON.parse(readFileSync('coverage/coverage-summary.json', 'utf8'));
let failed = false;
for (const [file, data] of Object.entries(summary)) {
  const m = /packages\/react-docscope\/src\/core\/(\w+)\.ts$/.exec(file);
  if (!m || !CRITICAL.includes(m[1])) continue;
  for (const [metric, min] of Object.entries(MIN)) {
    const pct = data[metric].pct;
    if (pct < min) {
      failed = true;
      console.error(`✗ core/${m[1]}.ts ${metric} ${pct}% < ${min}%`);
    }
  }
}
const total = summary.total;
console.log(
  `Overall: statements ${total.statements.pct}% · branches ${total.branches.pct}% · functions ${total.functions.pct}% · lines ${total.lines.pct}%`,
);
if (failed) process.exit(1);
console.log(`✓ Critical modules (${CRITICAL.join(', ')}) meet ${JSON.stringify(MIN)}`);
