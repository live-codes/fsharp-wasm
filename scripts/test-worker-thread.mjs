// Runs inside a Node worker_thread, simulating enough of a browser Worker's
// `self` global for fsharp-worker.js, and forwards messages to the parent.
// Usage: spawned by test-worker.mjs.
import { parentPort } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = fileURLToPath(import.meta.url);
// Load the fsharp-worker.js that ships inside the bundle package, so that its
// computed base URL points at the folder containing `_framework/`.
const packageDir = process.env.FSHARP_PACKAGE;
const workerJs = pathToFileURL(path.join(packageDir, 'fsharp-worker.js')).href;

// --- browser-`self` shim ---------------------------------------------------
globalThis.self = globalThis;
globalThis.location = { href: workerJs };
globalThis.postMessage = (msg) => parentPort.postMessage(msg);
globalThis.addEventListener = () => {};

await import(workerJs);

// Forward parent messages to fsharp-worker.js's onmessage with a MessageEvent shape.
parentPort.on('message', (data) => {
  if (globalThis.onmessage) globalThis.onmessage({ data });
});