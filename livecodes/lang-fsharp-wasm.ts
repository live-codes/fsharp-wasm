import type { LanguageSpecs } from '../models';
import { fsharpWasmBaseUrl } from '../vendors';

export const fsharpWasm: LanguageSpecs = {
  name: 'fsharp-wasm',
  title: 'F# (Wasm)',
compiler: {
    factory: () => async (code) => code,
    scripts: [fsharpWasmBaseUrl + 'fsharp-compiler.js'],
    scriptType: 'text/fsharp-wasm',
    compiledCodeLanguage: 'fsharp-wasm',
    // The compiler runs inside a Web Worker that is respawned every few runs, so
    // live reload (in-place updates) is safe: the runtime never accumulates.
    liveReload: true,
  },
  extensions: ['fs', 'fsharp', 'fsx'],
  editor: 'script',
  editorSupport: {
    codejar: { language: 'fsharp' },
  },
  largeDownload: true,
};