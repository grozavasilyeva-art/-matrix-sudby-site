#!/usr/bin/env node
/**
 * Build the entire provider-neutral static site locally.
 * No network calls, no hosting SDKs, no environment credentials.
 * Paid reports and payment secrets are intentionally absent.
 */
import { readFile, mkdir, writeFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const publicFiles = [
  'index.html',
  'assets/styles.css',
  'src/arcana.mjs',
  'src/calculator.mjs',
  'src/pdf-preview.mjs',
  'src/app.mjs'
];
const html = await readFile(join(root, 'index.html'), 'utf8');
if (!html.includes('<html lang="ru">') || !html.includes('id="calculator"')) {
  throw new Error('The site entrypoint is missing or incomplete');
}
for (const ref of ['./assets/styles.css', './src/app.mjs']) {
  if (!html.includes(ref)) throw new Error('Missing public reference: ' + ref);
}
const fileHashes = {};
for (const name of publicFiles) {
  const source = await readFile(join(root, name));
  const target = join(dist, name);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(join(root, name), target);
  fileHashes[name] = createHash('sha256').update(source).digest('hex');
}
await writeFile(join(dist, 'manifest.json'), JSON.stringify({
  format: 'static-site-v2',
  files: fileHashes
}, null, 2) + '\n', 'utf8');
console.log('Portable site built: ' + publicFiles.length + ' files in dist/. No cloud calls.');
