// Loads the .NET WebAssembly runtime and exposes FSharpRunner.RunFsharp(source).
// The runtime + F# compiler are served from this app's _framework folder.
import { dotnet } from './_framework/dotnet.js'

const status = document.getElementById('status');
const runBtn = document.getElementById('run');
const codeEl = document.getElementById('code');
const outputEl = document.getElementById('output');

let exports;

async function boot() {
    status.textContent = 'downloading .NET runtime + F# compiler…';
    status.className = 'loading';

const { setModuleImports, getAssemblyExports, getConfig, runMain } = await dotnet
    .withDiagnosticTracing(false)
    .withApplicationArgumentsFromQuery()
    .create();

const config = getConfig();
exports = await getAssemblyExports(config.mainAssemblyName);

// runMain runs the app's Main() but — unlike dotnet.run() — keeps the runtime
// alive so FSharpRunner.RunFsharp can be called afterwards.
await runMain();

runBtn.disabled = false;
    status.textContent = 'ready';
    status.className = 'ready';
    outputEl.textContent = '';
}

function write(text, cls) {
    const node = document.createElement('div');
    node.className = cls || '';
    node.textContent = text;
    outputEl.appendChild(node);
}

async function run() {
    if (!exports) return;
    runBtn.disabled = true;
    outputEl.textContent = '';
    write('Compiling…');
    // let the browser paint the "Compiling…" message before the synchronous wasm work
    await new Promise(r => setTimeout(r, 50));

    const json = await exports.FSharpRunner.RunFsharp(codeEl.value);
    const result = JSON.parse(json);

    outputEl.textContent = '';
    if (!result.ok) {
        if (result.errors && result.errors.length) {
            for (const e of result.errors) {
                write(`FS${e.errorNumber}: ${e.message}`, 'error');
                write(`  at line ${e.line}, column ${e.column}`, 'error');
            }
        } else if (result.output) {
            write(result.output, 'error');
        }
        return;
    }

    write(result.output || '(no output)');
    for (const w of result.warnings || []) {
        write(`warning FS${w.errorNumber}: ${w.message} (line ${w.line})`, 'warning');
    }
    runBtn.disabled = false;
}

runBtn.addEventListener('click', run);

boot().catch(err => {
    status.textContent = 'failed to start';
    status.className = '';
    outputEl.textContent = String(err);
});