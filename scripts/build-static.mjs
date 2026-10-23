#!/usr/bin/env node
/**
 * Provider-neutral static build. Does not contact Netlify, Yandex Cloud or any other service.
 * Produces an upload-ready directory for any ordinary static web hosting.
 */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const html = await readFile(join(root, 'index.html'), 'utf8');
if (!html.includes('<html lang="ru">') || !html.includes('id="calculator"')) {
  throw new Error('The site entrypoint is missing or incomplete');
}
if (/<script[^>]*\bsrc=["'][^"']*checkout/i.test(html)) {
  throw new Error('Unexpected checkout script in static build');
}
await mkdir(dist, { recursive: true });
await writeFile(join(dist, 'index.html'), html, 'utf8');
const sha256 = createHash('sha256').update(html).digest('hex');
await writeFile(join(dist, 'manifest.json'), JSON.stringify({
  format: 'static-site-v1',
  entrypoint: 'index.html',
  sha256,
  // This manifest deliberately contains no credentials, analytics IDs, or personal data.
}, null, 2) + '\n', 'utf8');
console.log('Static bundle prepared in dist/; index.html sha256: ' + sha256);
