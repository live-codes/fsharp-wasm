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
    liveReload: true,
  },
  extensions: ['fs', 'fsharp', 'fsx'],
  editor: 'script',
  editorSupport: {
    codejar: { language: 'fsharp' },
  },
  largeDownload: true,
};