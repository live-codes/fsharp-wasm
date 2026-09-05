# F# in the browser (.NET WebAssembly)

Run F# code entirely in the browser — no backend. The real F# compiler
(`FSharp.Compiler.Service`) runs on the .NET WebAssembly runtime, compiles user code to a .NET assembly in memory, loads it, and
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

| Project              | Purpose                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------- |
| `FSharpRunner`       | The browser app (`wasmbrowser`). Exposes `FSharpRunner.RunFsharp` via `[JSExport]`.         |
| `FSharpRunner.Node`  | Test harness: same compile+run logic running under the wasm runtime in Node.js.             |
| `prototype/FscProto` | Fast-iteration console app used to develop the FCS pipeline on .NET before porting to wasm. |
| `scripts`            | `prepare-refs.ps1` (build ref assemblies) and `serve.js` (static server).                   |

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
  via the generated entry point, and `Main.AsyncMain` (a module _property_ in
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
<script>
  FSharpRunner.run('printfn "Hello"').then((r) => console.log(r.output));
</script>
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

## Stability & performance (important)

The .NET/F# compiler runs on the **single-threaded** wasm runtime. Two measured
facts (see `FSharpRunner.Node`):

1. **One runtime instance can only handle ~3 successful F# compiles.** The 4th
   `FSharpChecker.Compile` deadlocks (this reproduces reliably on the wasm
   runtime; the same code runs 20+ compiles fine on desktop CoreCLR). It is not
   a managed-memory leak (managed heap is flat, GC runs) — it is an FCS-on-wasm
   limitation we could not root-cause further.
2. A fresh compile costs ~1–3 s (first run imports all reference assemblies;
   warm in-place compiles are ~0.5 s).

Because of (1), the LiveCodes language spec uses **`liveReload: false`**. With
live reload enabled, LiveCodes keeps the result frame alive and posts updates
in place, so the compiler runtime accumulates and the page crashes after ~4
edits. With live reload off, LiveCodes **rebuilds the result frame on every
run**, giving the F# runtime a fresh instance each time — no accumulation, no
crash. The trade-off is that each run is a full reload (~2–3 s) rather than an
in-place warm update.

If you want fast in-place updates again, the fix is to run the compiler in a
**Web Worker** and terminate/recreate the worker (fresh runtime) before it hits
the ~3-compile limit. LiveCodes result frames allow workers
(`sandbox="allow-same-origin allow-forms allow-scripts"`), so this is feasible;
it is not implemented yet.

User code should avoid blocking calls (`Async.RunSynchronously`, `.Wait()`,
`.Result`) — they deadlock the single-threaded runtime. Use the
`Main.AsyncMain` pattern (awaited cooperatively) instead.

## Upgrading .NET

### What is pinned, and where

| Piece                                     | Where                                                                                                          | How to change                                                          |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| .NET SDK                                  | `global.json` (`sdk.version`)                                                                                  | bump it, or install a newer SDK with `dotnet-install.ps1 -Channel <x>` |
| Target framework                          | `<TargetFramework>` in `FSharpRunner/FSharpRunner.csproj` and `FSharpRunner.Node/FSharpRunner.Node.csproj`     | edit the TFM                                                           |
| FSharp.Compiler.Service (the F# compiler) | `PackageReference` in the same two csproj files                                                                | bump the version                                                       |
| BCL reference assemblies (167 DLLs)       | copied into `FSharpRunner/refs/` by `scripts/prepare-refs.ps1` from the SDK's `Microsoft.NETCore.App.Ref` pack | re-run the script                                                      |
| FSharp.Core                               | the exact version FCS depends on, copied by `prepare-refs.ps1`                                                 | re-run the script                                                      |
| .NET wasm runtime + BCL `.wasm` files     | regenerated by `dotnet publish` from the installed SDK                                                         | republish                                                              |

### Upgrade procedure

1. Install a newer SDK, e.g. `dotnet-install.ps1 -Channel 11.0`.
2. Bump `global.json` (and the `<TargetFramework>`s if moving to a new major).
3. Bump `FSharp.Compiler.Service` in both csproj files (this pulls the matching
   FSharp.Core automatically).
4. `dotnet restore FSharpRunner`
5. `powershell -ExecutionPolicy Bypass -File scripts\prepare-refs.ps1` —
   re-copies the BCL refs from the new SDK pack and the FCS-pinned FSharp.Core.
6. Republish: `dotnet publish FSharpRunner -c Release -o FSharpRunner\publish`
7. Re-validate:
   - `dotnet run --project FSharpRunner.Node` — runs the compile+run pipeline on
     the real wasm runtime (Node).
   - `node scripts\test-cdn-wrapper.mjs` — validates the CDN wrapper + package.
8. Regenerate the deployable package:
   `scripts\make-package.ps1 -Version x.y.z`
9. In LiveCodes, bump `fsharpWasmBaseUrl` to the new package version.

### Things that commonly break on upgrade

- **FCS API changes** — FCS 43+ reorganized namespaces to `FSharp.Compiler.*`
  and uses `FSharpAsync` (not `Task`) return types. Check
  `FSharpRunner/CompileService.cs` against the F# compiler guide
  (<https://fsharp.github.io/fsharp-compiler-docs/fcs/>) after bumping FCS.
- **FSharp.Core/sigdata mismatch** — if the `refs/` FSharp.Core is older or newer
  than what FCS supports, compilation fails with `printfn is not defined` /
  `p_tyar_spec`. Always re-run `prepare-refs.ps1` after changing FCS.
- **The critical flags** — `--parallelcompilation-`, `--noframework`,
  `--nowin32manifest`, and `useTransparentCompiler: false`. If a new FCS
  renames/drops these, compilation will hang (spin) or throw
  _"Cannot wait on monitors on this runtime"_; make sure sequential mode is
  still forced.
- **dotnet.js API** — `dotnet.create()`, `runMain()`, `getAssemblyExports()` and
  the asset layout (content-hashed `.wasm` names) can change between .NET
  versions; `main.js` and `fsharp-compiler.js` may need small updates.
