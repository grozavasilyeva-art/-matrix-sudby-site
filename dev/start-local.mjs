/**
 * Start the offline local demo.
 *
 * Example: node dev/start-local.mjs
 * Optional: PRIVATE_PDF_DIR=/absolute/path/to/private-v3 node dev/start-local.mjs
 *
 * Never forward the listening port to the Internet or use this as a payment server.
 */
import { resolve } from 'node:path';
import { createLocalDemo } from './local-demo.mjs';
import { createPrivatePythonRenderer } from '../server/private-python-renderer.mjs';

if(process.env.NODE_ENV==='production') throw Error('Never start this demo in production');
const dataDir=resolve(process.env.MATRIX_DEMO_DATA_DIR || '.matrix-demo-data');
const bundleDir=process.env.PRIVATE_PDF_DIR;
const renderer=bundleDir ? createPrivatePythonRenderer({bundleDir}) : undefined;
const demo=await createLocalDemo({dataDir,renderer});
const url=await demo.listen();
console.log('TEST MODE ONLY. No real payments, no cloud calls.');
console.log('Local API: '+url);
console.log('Private renderer: '+(renderer?'configured':'one-page TEST-ONLY PDF'));
console.log('See docs/local-demo.md for HTTP examples.');
