// Validates fsharp-compiler.js + the fsharp-package bundle end-to-end in Node,
// by mocking the tiny browser surface the wrapper touches.
// Usage: node test-cdn-wrapper.mjs [path-to-fsharp-package]
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---- mock browser globals ----
globalThis.window = globalThis;
globalThis.parent = globalThis;
globalThis.document = { querySelectorAll: () => [] };

const require = createRequire(import.meta.url);
require(path.join(__dirname, '..', 'fsharp-compiler.js')); // runs the IIFE, sets window.FSharpRunner

const packagePath = process.argv[2] || path.join(__dirname, '..', 'fsharp-package');
globalThis.FSharpWasmBaseUrl = 'file://' + path.resolve(packagePath).replace(/\\/g, '/') + '/';

console.log('baseUrl:', globalThis.FSharpWasmBaseUrl);

const source = `module Main

let hello name =
    printfn "Hello, %s!" name

let AsyncMain =
    async {
        hello "from the CDN wrapper"
        let evens = [ 1..20 ] |> List.filter (fun n -> n % 2 = 0)
        printfn "Evens: %A" evens
        printfn "Sum: %d" (evens |> List.sum)
    }
`;

const res = await FSharpRunner.run(source);
console.log(JSON.stringify(res, null, 2));

const ok = res.ok && (res.output || '').includes('Hello, from the CDN wrapper!');
console.log(ok ? '\nPASS' : '\nFAIL');
process.exit(ok ? 0 : 1);