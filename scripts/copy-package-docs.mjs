#!/usr/bin/env node
// Copies the root README, LICENSE and third-party notices into the package before packing.
import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const pkg = join(root, 'packages', 'react-docscope');
for (const file of ['README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md']) {
  if (existsSync(join(root, file))) copyFileSync(join(root, file), join(pkg, file));
}
