import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPrivatePythonRenderer } from '../server/private-python-renderer.mjs';

const job = { schemaVersion: 'matrix-report-v1', product: 'matrix-full-report-v1', orderId: 'order_12345678', birthDate: '1989-08-23' };

async function fixture(pyCode) {
  const dir = await mkdtemp(join(tmpdir(), 'matrix-test-private-'));
  await writeFile(join(dir, 'generate_luxury_report.py'), pyCode);
  return dir;
}

test('runs a private Python renderer without shell or network calls', async () => {
  const dir = await fixture("import argparse\nfrom pathlib import Path\np=argparse.ArgumentParser()\np.add_argument('--date',required=True)\np.add_argument('--out',required=True)\na=p.parse_args()\nassert a.date=='1989-08-23'\nPath(a.out).write_bytes(b'%PDF-1.4\\n'+b'0'*700+b'\\n%%EOF\\n')\n");
  try {
    const renderer=createPrivatePythonRenderer({ bundleDir: dir });
    const pdf=await renderer.render(job);
    assert.ok(pdf.length>500);
    assert.equal(new TextDecoder().decode(pdf.slice(0,5)), '%PDF-');
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test('rejects invalid dates, unsupported products and command injection', async () => {
  const renderer=createPrivatePythonRenderer({bundleDir:'/tmp/nonexistent-private-generator'});
  for(const patch of [{birthDate:'2026-02-30'},{orderId:'bad; echo hi'}, {product:'free'}, {schemaVersion:'wrong'}]) {
    await assert.rejects(renderer.render({...job,...patch}));
  }
});

test('rejects malformed generated PDF', async () => {
  const dir=await fixture("import argparse\nfrom pathlib import Path\np=argparse.ArgumentParser()\np.add_argument('--date')\np.add_argument('--out')\na=p.parse_args()\nPath(a.out).write_bytes(b'FAKE'+b'X'*700)\n");
  try {
    await assert.rejects(createPrivatePythonRenderer({bundleDir:dir}).render(job), /structure invalid/);
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test('limits parallel PDF jobs, accepts a bounded queue and rejects overflow', async () => {
  const dir=await fixture("import argparse,time\nfrom pathlib import Path\np=argparse.ArgumentParser()\np.add_argument('--date')\np.add_argument('--out')\na=p.parse_args()\ntime.sleep(.25)\nPath(a.out).write_bytes(b'%PDF-1.4\\n'+b'1'*700+b'\\n%%EOF\\n')\n");
  try {
    const renderer=createPrivatePythonRenderer({bundleDir:dir,maxConcurrent:1,maxPending:1});
    const first=renderer.render(job);
    const second=renderer.render({...job,orderId:'order_99999999'});
    await assert.rejects(renderer.render({...job,orderId:'order_88888888'}), /queue at capacity/);
    const pdfs=await Promise.all([first,second]);
    assert.equal(pdfs.length,2);
    assert.ok(pdfs.every(pdf=>pdf.length>500));
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test('rejects invalid generator limits before starting any process', async () => {
  for (const options of [{maxConcurrent:0},{maxConcurrent:100},{maxPending:-1},{maxPending:101}]) {
    assert.throws(()=>createPrivatePythonRenderer({bundleDir:'/tmp/private-bundle',...options}),/Invalid/);
  }
});
