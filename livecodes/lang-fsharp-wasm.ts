import type { LanguageSpecs } from '../models';
import { fsharpWasmBaseUrl } from '../vendors';

export const fsharpWasm: LanguageSpecs = {
  name: 'fsharp-wasm',
  title: 'F# (Wasm)',
  compiler: {
    factory: () => async (code) => code,
    // fsharp-compiler.js (in the wasm bundle npm package) loads dotnet.js from the
    // same CDN, boots the .NET runtime and exposes livecodes.fsharp.{init,run,...}.
    scripts: [fsharpWasmBaseUrl + 'fsharp-compiler.js'],
    scriptType: 'text/fsharp-wasm',
    compiledCodeLanguage: 'fsharp-wasm',
    // liveReload must stay OFF: with live reload LiveCodes keeps the result frame
    // alive and the .NET/F# compiler runtime accumulates across runs and hangs
    // (deadlocks) after ~4 compiles on the single-threaded wasm runtime. With
    // liveReload off, LiveCodes rebuilds the result frame on each run, giving a
    // fresh runtime instance (no hang).
    liveReload: false,
  },
  extensions: ['fs', 'fsharp', 'fsx'],
  editor: 'script',
  editorSupport: {
    codejar: { language: 'fsharp' },
  },
  largeDownload: true,
};