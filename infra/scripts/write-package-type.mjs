#!/usr/bin/env node
// Проставляет { "type": ... } в каталог сборки, чтобы Node различал CJS и ESM.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [dir, type] = process.argv.slice(2);
if (!dir || !type) {
  console.error('usage: write-package-type.mjs <dir> <module|commonjs>');
  process.exit(1);
}
const target = resolve(process.cwd(), dir);
mkdirSync(target, { recursive: true });
writeFileSync(resolve(target, 'package.json'), JSON.stringify({ type }, null, 2) + '\n');
