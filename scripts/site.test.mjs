import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { Script } from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(root, 'index.html'), 'utf8');
const script = html.match(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/i)?.[1];

test('главная страница имеет калькулятор', () => {
  assert.match(html, /<html lang="ru">/);
  for (const id of ['calculator', 'matrix-svg', 'day', 'month', 'year']) {
    assert.ok(html.includes('id="' + id + '"'), 'Нет элемента: ' + id);
  }
});

test('JavaScript сайта синтаксически корректен', () => {
  assert.ok(script, 'Не найден встроенный JavaScript');
  assert.doesNotThrow(() => new Script(script, { filename: 'index-inline.js' }));
});

test('платный отчёт за 550 ₽ пока недоступен', () => {
  assert.match(html, /550 ₽/);
  assert.match(html, /id="checkout-preview"/);
  assert.match(html, /Оплата пока не подключена/);
  assert.match(html, /id="checkout-dialog"/);
  assert.doesNotMatch(html, /api\.yookassa\.ru\/v3\/payments/);
});

test('PDF в открытом коде является бесплатным образцом', () => {
  assert.match(html, /БЕСПЛАТНЫЙ ОБРАЗЕЦ/);
  assert.match(html, /matrix-demo-/);
  assert.match(html, /pdfChapterPages\('Личность · фрагмент',\['I','A'\]/);
  const gen = html.match(/function saveRealPdf\(\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.ok(gen);
  assert.doesNotMatch(gen, /const chapters=/);
});