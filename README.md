# F# in the browser (Bolero / .NET WebAssembly)

Run F# code entirely in the browser — no backend. The real F# compiler
(`FSharp.Compiler.Service`) runs on the .NET WebAssembly runtime (the same stack
Bolero uses), compiles user code to a .NET assembly in memory, loads it, and
executes it. Program output (`printfn` …) is captured and returned.

This is the modern equivalent of
[TryFSharpOnWasm](https://github.com/fsbolero/TryFSharpOnWasm) (which used the
ancient Mono Blazor 0.7 runtime). Here we use .NET 10 + the current
`browser-wasm` runtime.

## Try it

1. Publish the browser app (requires .NET SDK 10):

   ```powershell
   scripts\prepare-refs.ps1          # one-time: copies BCL ref assemblies + FSharp.Core into FSharpRunner\refs
   dotnet publish FSharpRunner -c Release -o FSharpRunner\publish
   ```

2. Serve the published `wwwroot` folder:

   ```powershell
   node scripts\serve.js FSharpRunner\publish\wwwroot 8080
   ```

3. Open <http://localhost:8080/> — edit the F# code and click **Run**.

## Projects

| Project          | Purpose                                                            |
|------------------|--------------------------------------------------------------------|
| `FSharpRunner`   | The browser app (`wasmbrowser`). Exposes `FSharpRunner.RunFsharp` via `[JSExport]`. |
| `FSharpRunner.Node` | Test harness: same compile+run logic running under the wasm runtime in Node.js. |
| `prototype/FscProto` | Fast-iteration console app used to develop the FCS pipeline on .NET before porting to wasm. |
| `scripts`        | `prepare-refs.ps1` (build ref assemblies) and `serve.js` (static server). |

## How it works

`FSharpRunner/CompileService.cs`:

1. **Reference assemblies** — the full BCL reference set (`Microsoft.NETCore.App.Ref`
   ref pack, ~167 DLLs) plus `FSharp.Core.dll` are embedded in the app assembly and
   extracted into an in-memory virtual file system at startup.
2. **Virtual file system** — `VirtualFileSystem.cs` implements FCS's
   `FSharp.Compiler.IO.IFileSystem` entirely in memory (no browser file system
   needed). Source files, reference DLLs and the emitted assembly all live there.
3. **Compile** — `FSharpChecker.Compile(...)` runs the self-contained `fsc`
   driver. User code is written to `/tmp/Main.fs`, compiled with
   `--noframework --simpleresolution --nowin32manifest` and all refs via `-r:`.
4. **Execute** — the emitted `/tmp/out.exe` is loaded with `Assembly.Load` and its
   entry point invoked. If the code defines `module Main` with
   `AsyncMain : Async<unit>`, that is awaited too. `Console` output is captured.

## Key findings (gotchas)

These were the hard-won fixes needed to run modern FCS on the single-threaded
wasm runtime:

- **`--noframework` is required.** Without it FCS auto-resolves the framework
  from `RuntimeEnvironment.GetRuntimeDirectory()`, which doesn't work on wasm
  (and the runtime doesn't ship `.dll` bytes). We pass the ref pack explicitly.
- **`--nowin32manifest`** avoids FCS looking for `default.win32manifest`.
- **`--parallelcompilation-`** is the critical flag. The default parallel/graph
  type-checking machinery blocks on `Task.Result` / `Async.RunSynchronously`
  (`FrameworkImportsCache`, `MultipleDiagnosticsLoggers.Parallel`), which the
  single-threaded wasm runtime forbids ("Cannot wait on monitors on this
  runtime"). Sequential mode completes synchronously and works.
- **Disable the transparent compiler** (`FSharpChecker.Create(..., useTransparentCompiler: false)`)
  for the same reason.
- **`FSharpChecker.Compile` (the fsc driver) works on wasm; the background
  checker (`ParseAndCheckProject`) does not** — it uses blocking waits. Use the
  driver.
- The user code is compiled as a console-style **exe**; top-level statements run
  via the generated entry point, and `Main.AsyncMain` (a module *property* in
  F# 10, not a method) is invoked explicitly.

## Notes for LiveCodes integration

- The whole thing is static files — it can be hosted on any CDN/static host.
- Bundle size is large by necessity (the real compiler runs in the browser):
  ~100 MB uncompressed, ~35–40 MB gzipped/brotli. The biggest items are
  `FSharp.Compiler.Service` (~19 MB wasm) and the BCL wasm files. gzip/brotli
  variants are already emitted by the publish step and served automatically by
  a CDN.
- `dotnet.js`/`dotnet.native.wasm` and all `*.wasm` files under `_framework/`
  are the .NET runtime; `FSharpRunner.*.wasm` is the app with the embedded refs.
- First load compiles F# the first time ~2–5 s (interpreter); subsequent runs are
  warm.

## CDN loading (LiveCodes / any page)

`fsharp-compiler.js` is a self-contained loader that pulls the whole wasm bundle
from any static host/CDN and exposes `FSharpRunner.run(source)`:

```html
<script src="https://cdn.example.com/fsharp/fsharp-compiler.js"></script>
<script>FSharpRunner.run('printfn "Hello"').then(r => console.log(r.output));</script>
```

It also wires up the `livecodes.fsharp` namespace automatically when loaded
inside a LiveCodes result frame. The bundle base URL is configurable via
`window.FSharpWasmBaseUrl`.

- `fsharp-compiler.js` — the loader (also ships inside the npm package).
- `scripts/make-package.ps1` — assembles `fsharp-package/` (npm-package layout)
  from the publish output.
- `demo-cdn.html` — standalone demo: loads the wrapper + package and runs F#.
  Open `http://localhost:8080/demo-cdn.html` (server serving the repo root).
- `livecodes/` — LanguageSpecs + integration steps for the LiveCodes repo.
- `scripts/test-cdn-wrapper.mjs` — end-to-end validation of the wrapper +
  package in Node (`node scripts/test-cdn-wrapper.mjs`).

Deploy `fsharp-package/` to npm (jsDelivr: `https://cdn.jsdelivr.net/npm/@live-codes/fsharp-wasm@0.1.0/`)
or any static host, then point `fsharpWasmBaseUrl` at it.