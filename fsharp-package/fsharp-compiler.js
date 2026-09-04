/*!
 * fsharp-compiler.js — F# in the browser via .NET WebAssembly (Bolero).
 *
 * A self-contained CDN loader for the FSharpRunner wasm bundle. It loads
 * dotnet.js + the .NET runtime + the real F# compiler (FSharp.Compiler.Service)
 * from any static host / CDN, boots the runtime, and exposes:
 *
 *   window.FSharpRunner.init()          -> Promise<void>
 *   window.FSharpRunner.run(source)     -> Promise<{ ok, output, errors[], warnings[] }>
 *   window.FSharpRunner.ready           -> boolean
 *
 * Usage (classic script or module):
 *   <script src="https://cdn.example.com/fsharp/fsharp-compiler.js"></script>
 *   <script>
 *     FSharpRunner.run('printfn "Hello"').then(res => console.log(res.output));
 *   </script>
 *
 * The bundle base URL is configurable (must point to a folder containing
 * `_framework/dotnet.js` and the rest of the publish output):
 *
 *   <script>window.FSharpWasmBaseUrl = 'https://cdn.example.com/fsharp/';</script>
 *
 * Also integrates with LiveCodes by populating the `livecodes.fsharp` namespace.
 */
(function () {
  'use strict';

  var DEFAULT_BASE_URL = 'https://cdn.jsdelivr.net/npm/@live-codes/fsharp-wasm@0.1.0/';

  function getBaseUrl() {
    var base = window.FSharpWasmBaseUrl || DEFAULT_BASE_URL;
    return base.replace(/\/+$/, '') + '/';
  }

  var state = {
    ready: false,
    initPromise: null,
    exports: null,
  };

  function init() {
    if (state.ready) return Promise.resolve();
    if (!state.initPromise) {
      state.initPromise = (async function () {
        var baseUrl = getBaseUrl();
        // webpackIgnore keeps bundlers from trying to resolve the CDN module.
        var dotnetModule = await import(/* webpackIgnore: true */ baseUrl + '_framework/dotnet.js');
        var dotnet = dotnetModule.dotnet;
        var runtime = await dotnet.withDiagnosticTracing(false).create();
        var config = runtime.getConfig();
        state.exports = await runtime.getAssemblyExports(config.mainAssemblyName);
        // runMain() runs the app's Main() but — unlike dotnet.run() — keeps the
        // runtime alive so RunFsharp can be invoked afterwards.
        await runtime.runMain();
        state.ready = true;
      })();
    }
    return state.initPromise;
  }

  /** Compile + run F# source. Resolves to { ok, output, errors[], warnings[] }. */
  function run(source) {
    return init().then(function () {
      return state.exports.FSharpRunner.RunFsharp(String(source)).then(JSON.parse);
    });
  }

  var api = {
    init: init,
    run: run,
    get ready() {
      return state.ready;
    },
  };

  // ---- standalone API ------------------------------------------------------
  window.FSharpRunner = window.FSharpRunner || api;

  // ---- LiveCodes integration ----------------------------------------------
  // LiveCodes injects `window.livecodes = {}` into the result frame and loads
  // this script; user code is placed in <script type="text/fsharp-wasm">.
  if (window.livecodes) {
    window.livecodes.fsharp ??= {};

    var livecodesApi = window.livecodes.fsharp;

    livecodesApi.init ??= (function () {
      if (livecodesApi.ready) return;
      parent.postMessage({ type: 'loading', payload: true }, '*');
      return init()
        .then(function () {
          parent.postMessage({ type: 'loading', payload: false }, '*');
        })
        .catch(function (err) {
          parent.postMessage({ type: 'loading', payload: false }, '*');
          livecodesApi.ready = false;
          livecodesApi.init = null;
          // eslint-disable-next-line no-console
          console.error('Failed to initialize F# environment:', err);
          throw err;
        });
    })();

    livecodesApi.run ??= async function (input) {
      var code = '';
      var scripts = document.querySelectorAll('script[type="text/fsharp-wasm"]');
      scripts.forEach(function (script) {
        code += script.innerHTML + '\n';
      });

      if (!code.trim()) return { output: null, error: null, exitCode: 0 };

      await livecodesApi.init;
      try {
        var result = await run(code);
        if (!result.ok) {
          var error = (result.errors || []).map(formatError).join('\n');
          livecodesApi.output = null;
          livecodesApi.error = error;
          livecodesApi.exitCode = 1;
          livecodesApi.ready = true;
          // eslint-disable-next-line no-console
          console.error(error);
          return { output: null, error: error, exitCode: 1 };
        }
        livecodesApi.output = result.output;
        livecodesApi.error = null;
        livecodesApi.exitCode = 0;
        livecodesApi.ready = true;
        // eslint-disable-next-line no-console
        console.log(result.output || '');
        return { output: result.output, error: null, exitCode: 0 };
      } catch (err) {
        var msg = 'Error: ' + (err && err.message ? err.message : String(err));
        livecodesApi.output = null;
        livecodesApi.error = msg;
        livecodesApi.exitCode = 1;
        livecodesApi.ready = true;
        // eslint-disable-next-line no-console
        console.error(msg);
        return { output: null, error: msg, exitCode: 1 };
      }
    };

    livecodesApi.loaded ??= new Promise(function (resolve) {
      var interval = setInterval(function () {
        if (livecodesApi.ready) {
          clearInterval(interval);
          resolve();
        }
      }, 50);
    });

    window.addEventListener('load', async function () {
      parent.postMessage({ type: 'loading', payload: true }, '*');
      await livecodesApi.run(livecodesApi.input);
      parent.postMessage({ type: 'loading', payload: false }, '*');
    });
  }

  function formatError(e) {
    var line = e.line ? ' (line ' + e.line + ')' : '';
    return 'error FS' + e.errorNumber + line + ': ' + e.message;
  }
})();