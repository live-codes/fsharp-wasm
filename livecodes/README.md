# Integrating F# (Wasm) into LiveCodes

The F# wasm bundle (`@live-codes/fsharp-wasm`) is a normal static npm package.
`fsharp-compiler.js` inside it is a self-contained loader that:

1. imports `_framework/dotnet.js` from the same CDN base URL,
2. boots the .NET WebAssembly runtime + the real F# compiler,
3. exposes `livecodes.fsharp.{init,run,ready,loaded,output,error,exitCode}` so
   LiveCodes can run user F# code in the result frame.

This mirrors the existing `csharp-wasm` language — see
`src/livecodes/languages/csharp-wasm/` for the exact pattern.

## Files in this folder

| File | Purpose |
|------|---------|
| `lang-fsharp-wasm.ts` | The language spec (drop into `src/livecodes/languages/fsharp-wasm/`). |
| `../fsharp-compiler.js` | The CDN loader + LiveCodes glue (already bundled in the npm package; keep in sync with the browser app). |

## Integration steps

### 1. Vendors

In `src/livecodes/vendors.ts` add:

```ts
export const fsharpWasmBaseUrl = /* @__PURE__ */ getUrl('@live-codes/fsharp-wasm@0.1.0/');
```

### 2. Language spec

Create `src/livecodes/languages/fsharp-wasm/lang-fsharp-wasm.ts` with the
contents of `lang-fsharp-wasm.ts` from this folder (adjust the import of
`fsharpWasmBaseUrl`).

### 3. Language registry

In `src/livecodes/languages/languages.ts`:

```ts
import { fsharpWasm } from './fsharp-wasm';
// ...
export const languages = {
  // ...
  fsharpWasm,
  // ...
};
```

### 4. compiledCodeLanguage type

In `src/livecodes/models.ts`, add `'text/fsharp-wasm'` to the
`compiledCodeLanguage` union (next to `'text/csharp-wasm'`).

### 5. i18n

Add a display name for the language, e.g. in
`src/livecodes/i18n/locales/en/translation.ts` (all other locale files are
generated from it):

```ts
fsharp-wasm: 'F# (Wasm)',
```

### 6. (Optional) Starter template

Add a `src/livecodes/templates/starter/fsharp-wasm-starter.ts` modeled on
`csharp-wasm-starter.ts` and register it in
`src/livecodes/templates/starter/index.ts`. The starter markup can use
`livecodes.fsharp.run()` / `livecodes.fsharp.loaded` the same way the C#
starter does.

## How the pieces fit

```
LiveCodes (parent)
  └─ result frame
       ├─ <script type="text/fsharp-wasm">…user F# code…</script>   (from scriptType)
       └─ fsharp-compiler.js  (loaded via compiler.scripts from the CDN)
            └─ import { dotnet } from '<cdn>/_framework/dotnet.js'
                 └─ dotnet.create() → getAssemblyExports('FSharpRunner.dll')
                      └─ runMain()   (keeps the runtime alive)
                           └─ FSharpRunner.RunFsharp(source) → { ok, output, errors[], warnings[] }
```

`fsharp-compiler.js` posts `{ type: 'loading', payload: bool }` to the parent so
LiveCodes shows the download/init progress (same contract as `csharp-wasm`).

## Publishing the bundle

```powershell
scripts\prepare-refs.ps1                                   # once
dotnet publish FSharpRunner -c Release -o FSharpRunner\publish
scripts\make-package.ps1 -Version 0.1.0                    # → fsharp-package/
npm publish fsharp-package                                 # jsDelivr: https://cdn.jsdelivr.net/npm/@live-codes/fsharp-wasm@0.1.0/
```

If you host the `fsharp-package/` folder elsewhere (GitHub Pages, S3, ...),
point `fsharpWasmBaseUrl` at that URL instead.