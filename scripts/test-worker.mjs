// Validates fsharp-worker.js (the F# compiler Web Worker) on the real wasm
// runtime, using Node's worker_threads as a stand-in for a browser Worker.
// The worker thread boots dotnet.js + the F# compiler, then compiles+runs code.
// Usage: node scripts/test-worker.mjs [path-to-fsharp-package]
import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packagePath = process.argv[2] || path.join(__dirname, '..', 'fsharp-package');

// The worker needs to know where the bundle lives; it computes its base from
// self.location.href, so pass the bundle dir via an env var to the shim.
process.env.FSHARP_PACKAGE = packagePath;

const source = `module Main
let hello name = printfn "Hello, %s!" name
let AsyncMain =
    async {
        hello "from the Web Worker"
        let evens = [ 1..20 ] |> List.filter (fun n -> n % 2 = 0)
        printfn "Evens: %A" evens
        printfn "Sum: %d" (evens |> List.sum)
    }
`;

const worker = new Worker(new URL('./test-worker-thread.mjs', import.meta.url), {
  env: process.env,
});

const timeout = setTimeout(() => {
  console.error('TIMEOUT: worker did not respond');
  worker.terminate();
  process.exit(1);
}, 180000);

worker.on('message', async (msg) => {
  if (msg.type === 'ready') {
    console.log('worker ready, compiling...');
    worker.postMessage({ type: 'compile', source, id: 1 });
  } else if (msg.type === 'result') {
    clearTimeout(timeout);
    const result = JSON.parse(msg.json);
    console.log('result:', JSON.stringify(result, null, 2));
    const ok = result.ok && (result.output || '').includes('Hello, from the Web Worker!');
    console.log(ok ? '\nPASS' : '\nFAIL');
    worker.terminate();
    process.exit(ok ? 0 : 1);
  } else if (msg.type === 'error') {
    clearTimeout(timeout);
    console.error('worker error:', msg.message);
    worker.terminate();
    process.exit(1);
  } else if (msg.type === 'fatal') {
    clearTimeout(timeout);
    console.error('worker fatal:', msg.message);
    worker.terminate();
    process.exit(1);
  }
});

worker.on('error', (err) => {
  clearTimeout(timeout);
  console.error('worker thread error:', err);
  process.exit(1);
});