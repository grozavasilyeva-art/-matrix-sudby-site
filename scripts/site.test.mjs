import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { calculateMatrix, reduceArcana } from '../src/calculator.mjs';
import { ARCS, MONTHS } from '../src/arcana.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const text = name => readFileSync(join(root, name), 'utf8');
const html = text('index.html');
const app = text('src/app.mjs');
const preview = text('src/pdf-preview.mjs');

test('сайт подключает локальные стили и приложение', () => {
  assert.match(html, /<html lang="ru">/);
  assert.match(html, /href="\.\/assets\/styles\.css"/);
  assert.match(html, /<script type="module" src="\.\/src\/app\.mjs"><\/script>/);
  for (const id of ['calculator', 'matrix-svg', 'day', 'month', 'year', 'checkout-dialog']) {
    assert.ok(html.includes('id="' + id + '"'), 'Нет элемента: ' + id);
  }
  assert.ok(text('assets/styles.css').includes('.hero'));
});

test('все модули проходят проверку синтаксиса Node.js', () => {
  for (const name of ['src/arcana.mjs', 'src/calculator.mjs', 'src/pdf-preview.mjs', 'src/app.mjs', 'scripts/build-static.mjs']) {
    const result = spawnSync(process.execPath, ['--check', join(root, name)], { encoding: 'utf8' });
    assert.equal(result.status, 0, name + ': ' + result.stderr);
  }
});

test('22 аркана имеют необходимые описания', () => {
  assert.equal(Object.keys(ARCS).length, 22);
  assert.equal(MONTHS.length, 12);
  for (let i = 1; i <= 22; i++) {
    assert.ok(ARCS[i]?.name && ARCS[i]?.meaning && ARCS[i]?.question, 'Аркан ' + i);
  }
});

test('приведение к 1–22 работает согласно выбранной системе', () => {
  for (const [value, expected] of [[1,1],[22,22],[23,5],[29,11],[44,8],[99,18]]) {
    assert.equal(reduceArcana(value), expected, 'Число ' + value);
  }
});

test('контрольная дата 23.08.1989: центральные и тематические точки', () => {
  const v = calculateMatrix(23, 8, 1989);
  assert.ok(v);
  assert.deepEqual(
    [v.A,v.C,v.E,v.G,v.I,v.B,v.D,v.F,v.H],
    [5,8,9,22,8,13,17,4,9]
  );
  assert.deepEqual(
    [v.G2,v.G1,v.FL,v.F3,v.FR,v.earth,v.sky,v.personal,v.father,v.mother,v.social],
    [3,7,5,20,10,14,3,17,17,8,7]
  );
});

test('невалидные даты отклоняются: февраль, границы и дробные значения', () => {
  for (const [day,month,year] of [[0,1,2000],[32,1,2000],[31,4,2000],[29,2,1900],[29,2,2001],[1,13,2000],[1,0,2000],[1,1,0],[1,1,-100],[1,1,10000],[1.5,1,2026],[1,2.5,2026],[1,1,2026.3]]) {
    assert.equal(calculateMatrix(day,month,year), null, 'Ожидалась ошибка для ' + day + '.' + month + '.' + year);
  }
  assert.ok(calculateMatrix(29,2,2000));
  assert.ok(calculateMatrix(29,2,2024));
  assert.equal(calculateMatrix(29,2,2025), null);
});

test('основные арканы и линии всегда 1–22 для валидных дат', () => {
  const keys = ['A','B','C','D','E','F','G','H','I','A1','A2','E1','E2','C1','C2','G1','G2','FL','F3','FR'];
  for (const year of [1900,1950,1989,2000,2024,2026]) {
    for (const month of [1,2,4,8,12]) {
      for (const day of [1,14,28]) {
        const v=calculateMatrix(day,month,year);
        assert.ok(v);
        for (const key of keys) assert.ok(Number.isInteger(v[key]) && v[key]>=1 && v[key]<=22, key + ' ' + day + '.' + month + '.' + year);
        assert.equal(v.F3,reduceArcana(v.G2+v.E2));
        assert.equal(v.FL,reduceArcana(v.G2+v.F3));
        assert.equal(v.FR,reduceArcana(v.E2+v.F3));
      }
    }
  }
});

test('клиент не содержит платёжного подключения и полного отчёта', () => {
  assert.match(html, /550 ₽/);
  assert.match(html, /id="checkout-preview"/);
  assert.match(app, /Оплата пока не подключена/);
  assert.doesNotMatch(app + preview, /api\.yookassa\.ru\/v3\/payments/);
  assert.match(preview, /БЕСПЛАТНЫЙ ОБРАЗЕЦ/);
  assert.match(app, /matrix-demo-/);
  assert.doesNotMatch(preview, /const chapters=/);
});

test('локальная сборка включает HTML, CSS и JS без облачных вызовов', () => {
  const result=spawnSync(process.execPath,['scripts/build-static.mjs'],{cwd:root,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const manifest=JSON.parse(readFileSync(join(root,'dist/manifest.json'),'utf8'));
  assert.equal(manifest.format,'static-site-v2');
  for (const name of ['index.html','assets/styles.css','src/arcana.mjs','src/calculator.mjs','src/pdf-preview.mjs','src/app.mjs']) {
    assert.ok(existsSync(join(root,'dist',name)),'Нет файла: '+name);
    assert.match(manifest.files[name],/^[0-9a-f]{64}$/);
  }
});
