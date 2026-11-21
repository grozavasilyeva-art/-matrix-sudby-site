/**
 * PRIVATE PDF renderer adapter for server-side use only.
 * Connect to a trusted Python bundle outside the public source tree.
 * No HTTP endpoints, secrets, payments, or cloud calls here.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { normalizeBirthDate } from './order-domain.mjs';

const MAX_BYTES = 20 * 1024 * 1024;

export function createPrivatePythonRenderer({ bundleDir, pythonBin='python3', timeoutMs=45000, maxConcurrent=1, maxPending=4 }={}) {
  if (typeof bundleDir !== 'string' || !bundleDir.trim()) throw new TypeError('Private bundle directory required');
  if (typeof pythonBin !== 'string' || !/^[a-zA-Z0-9_./-]+$/.test(pythonBin)) throw new TypeError('Invalid Python executable');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000) throw new RangeError('Invalid timeout');
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 8) throw new RangeError('Invalid concurrency limit');
  if (!Number.isInteger(maxPending) || maxPending < 0 || maxPending > 100) throw new RangeError('Invalid queue limit');
  const dir = resolve(bundleDir);
  let active=0;
  const waiting=[];
  async function renderOne(job) {
    // Caller must be trusted fulfillment code that has independently verified payment.
    if (!job || job.schemaVersion !== 'matrix-report-v1' || job.product !== 'matrix-full-report-v1' ||
      typeof job.orderId !== 'string' || !/^[a-zA-Z0-9_-]{8,96}$/.test(job.orderId)) {
      throw new Error('Untrusted private report job');
    }
    const isoDate = normalizeBirthDate(job.birthDate);
    const script = join(dir, 'generate_luxury_report.py');
    await access(script);
    const folder = await mkdtemp(join(tmpdir(), 'matrix-private-pdf-'));
    const output = join(folder, 'report.pdf');
    try {
      await new Promise((accept, reject) => {
        const child = spawn(pythonBin, ['-B', script, '--date', isoDate, '--out', output], {
          cwd: dir,
          shell: false,
          stdio: ['ignore', 'ignore', 'pipe'],
          env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', PYTHONDONTWRITEBYTECODE: '1', LANG: 'C.UTF-8' }
        });
        let stderr = '';
        let finished = false;
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          fail(new Error('PDF renderer timed out'));
        }, timeoutMs);
        function clean() { clearTimeout(timer); }
        function fail(e) { if (finished) return; finished = true; clean(); reject(e); }
        child.stderr.on('data', buf => {
          if (stderr.length < 4096) stderr += String(buf).slice(0, 4096 - stderr.length);
        });
        child.on('error', fail);
        child.on('close', code => {
          if (finished) return;
          if (code !== 0) return fail(new Error('Private PDF rendering failed (exit '+code+'): '+stderr.slice(0,1000)));
          finished = true; clean(); accept();
        });
      });
      const meta = await stat(output);
      if (!meta.isFile() || meta.size < 500 || meta.size > MAX_BYTES) throw new Error('Generated PDF size invalid');
      const pdf = await readFile(output);
      if (pdf.subarray(0,5).toString('latin1') !== '%PDF-' ||
          !pdf.subarray(-2048).toString('latin1').includes('%%EOF')) {
        throw new Error('Generated PDF structure invalid');
      }
      return new Uint8Array(pdf);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  }
  function drain() {
    while (active < maxConcurrent && waiting.length) {
      const item=waiting.shift();
      active++;
      Promise.resolve().then(()=>renderOne(item.job)).then(item.resolve,item.reject).finally(()=>{
        active--;
        drain();
      });
    }
  }
  function render(job) {
    // Fail fast, before queueing, when the call does not carry a trusted shape.
    if (!job || job.schemaVersion !== 'matrix-report-v1' || job.product !== 'matrix-full-report-v1' ||
        typeof job.orderId !== 'string' || !/^[a-zA-Z0-9_-]{8,96}$/.test(job.orderId)) {
      return Promise.reject(new Error('Untrusted private report job'));
    }
    try { normalizeBirthDate(job.birthDate); }
    catch (error) { return Promise.reject(error); }
    if (active >= maxConcurrent && waiting.length >= maxPending) {
      return Promise.reject(new Error('Private renderer queue at capacity'));
    }
    return new Promise((resolve,reject)=>{
      waiting.push({job,resolve,reject});
      drain();
    });
  }
  return Object.freeze({render});
}
