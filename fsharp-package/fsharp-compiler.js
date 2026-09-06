/*!
 * fsharp-compiler.js — F# in the browser via .NET WebAssembly (Bolero).
 *
 * A self-contained CDN loader for the FSharpRunner wasm bundle. It runs the .NET
 * runtime + the real F# compiler (FSharp.Compiler.Service) inside a Web Worker
 * (falling back to the main thread when workers are unavailable), and exposes:
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
 * `_framework/dotnet.js`, `fsharp-worker.js` and the rest of the publish output):
 *
 *   <script>window.FSharpWasmBaseUrl = 'https://cdn.example.com/fsharp/';</script>
 *
 * Also integrates with LiveCodes by populating the `livecodes.fsharp` namespace.
 *
 * Why a worker: a single .NET-wasm runtime instance can only safely run ~3 F#
 * compiles before FCS deadlocks on the single-threaded wasm runtime. Running the
 * compiler in a worker lets us terminate + respawn the worker (a fresh runtime)
 * before that limit, giving fast in-place updates without the crash.
 */
(function () {
  'use strict';

  var CURRENT_BASE_URL = document.currentScript?.src?.replace(/fsharp-compiler\.js[^/]*$/, '');
  var DEFAULT_BASE_URL = 'https://cdn.jsdelivr.net/npm/@live-codes/fsharp-wasm/';

  // Safe number of compiles per worker before respawning (the 4th one hangs).
  var MAX_RUNS = 3;
  // Per-run timeout: if a compile never answers (hang), kill + respawn the worker.
  var RUN_TIMEOUT_MS = 30000;
  // Worker boot timeout: if it never becomes ready, fall back to main thread.
  var BOOT_TIMEOUT_MS = 60000;

  function getBaseUrl() {
    var base = window.FSharpWasmBaseUrl || CURRENT_BASE_URL || DEFAULT_BASE_URL;
    console.log(base.replace(/\/+$/, '') + '/');
    return base.replace(/\/+$/, '') + '/';
  }

  // ---- main-thread runner (fallback) -------------------------------------
  function createMainThreadRunner(getBaseUrl) {
    var state = { ready: false, initPromise: null, exports: null };

    function init() {
      if (state.ready) return Promise.resolve();
      if (!state.initPromise) {
        state.initPromise = (async function () {
          var baseUrl = getBaseUrl();
          var dotnetModule = await import(/* webpackIgnore: true */ baseUrl + '_framework/dotnet.js');
          var runtime = await dotnetModule.dotnet.withDiagnosticTracing(false).create();
          var config = runtime.getConfig();
          state.exports = await runtime.getAssemblyExports(config.mainAssemblyName);
          await runtime.runMain();
          state.ready = true;
        })();
      }
      return state.initPromise;
    }

    function run(source, input) {
      return init().then(function () {
        return state.exports.FSharpRunner.RunFsharp(
          String(source),
          String(input || ""),
        ).then(JSON.parse);
      });
    }

    return {
      init: init,
      run: run,
      get ready() {
        return state.ready;
      },
    };
  }

  // ---- worker runner -------------------------------------------------------
  function createWorkerRunner(getBaseUrl) {
    var worker = null;
    var readyPromise = null;
    var resolveReady = null;
    var rejectReady = null;
    var pending = {};
    var nextId = 1;
    var runsOnWorker = 0;

    function onMessage(e) {
      var msg = e.data || {};
      if (msg.type === 'ready') {
        if (resolveReady) {
          resolveReady();
          resolveReady = null;
          rejectReady = null;
        }
      } else if (msg.type === 'fatal') {
        // Boot failed — tear down and reject init so the caller falls back.
        if (worker) {
          worker.terminate();
          worker = null;
        }
        if (rejectReady) {
          rejectReady(new Error('F# worker failed to start: ' + msg.message));
          resolveReady = null;
          rejectReady = null;
        }
      } else if (msg.type === 'result') {
        var p = pending[msg.id];
        if (p) {
          delete pending[msg.id];
          clearTimeout(p.timer);
          p.resolve(JSON.parse(msg.json));
        }
      } else if (msg.type === 'error') {
        var pe = pending[msg.id];
        if (pe) {
          delete pending[msg.id];
          clearTimeout(pe.timer);
          pe.reject(new Error(msg.message));
        }
      }
    }

    function onError(err) {
      rejectAll(new Error('F# worker crashed: ' + (err && err.message ? err.message : 'unknown')));
      if (worker) {
        worker.terminate();
        worker = null;
      }
    }

    function rejectAll(err) {
      for (var id in pending) {
        var p = pending[id];
        clearTimeout(p.timer);
        p.reject(err);
      }
      pending = {};
    }

    function spawn() {
      runsOnWorker = 0;
      readyPromise = new Promise(function (resolve, reject) {
        resolveReady = resolve;
        rejectReady = reject;
      });
      try {
        var toDataUrl = (content, type = "text/javascript") =>
          `data:${type};charset=UTF-8;base64,` + btoa(content);
        var workerUrl = toDataUrl(`
          self.baseUrl = "${getBaseUrl()}";
          self.dotnetSidecar = true;
          importScripts("${getBaseUrl() + 'fsharp-worker.js'}");
        `);
        worker = new Worker(workerUrl);
        worker.onmessage = onMessage;
        worker.onerror = onError;
      } catch (err) {
        // Workers unavailable in this context (e.g. sandbox restrictions).
        worker = null;
        readyPromise = null;
        resolveReady = null;
        rejectReady = null;
        throw err;
      }
    }

    function ensureWorker() {
      if (!worker) spawn();
    }

    function init() {
      try {
        ensureWorker();
      } catch (err) {
        return Promise.reject(err);
      }
      return new Promise(function (resolve, reject) {
        var timer = setTimeout(function () {
          if (worker) {
            worker.terminate();
            worker = null;
          }
          reject(new Error('F# worker failed to start (timeout)'));
        }, BOOT_TIMEOUT_MS);
        readyPromise.then(
          function () {
            clearTimeout(timer);
            resolve();
          },
          function (err) {
            clearTimeout(timer);
            reject(err);
          },
        );
      });
    }

    function run(source, input) {
      try {
        ensureWorker();
      } catch (err) {
        return Promise.reject(err);
      }
      return readyPromise.then(function () {
        if (runsOnWorker >= MAX_RUNS) {
          // Respawn a fresh runtime before the next compile (avoid the hang).
          worker.terminate();
          worker = null;
          spawn();
          return readyPromise.then(function () {
            return runNow(source, input);
          });
        }
        return runNow(source, input);
      });
    }

    function runNow(source, input) {
      var id = nextId++;
      var sourceText = String(source);
      runsOnWorker++;
      return new Promise(function (resolve, reject) {
        var timer = setTimeout(function () {
          // The worker hung (FCS deadlock) — kill it and let the next run respawn.
          delete pending[id];
          if (worker) {
            worker.terminate();
            worker = null;
          }
          reject(new Error('F# compile timed out; restarted the compiler.'));
        }, RUN_TIMEOUT_MS);
        pending[id] = { resolve: resolve, reject: reject, timer: timer };
        worker.postMessage({ type: "compile", source: sourceText, stdin: String(input || ""), id: id });
      });
    }

    return {
      init: init,
      run: run,
      get ready() {
        return !!worker && resolveReady === null;
      },
    };
  }

  // ---- choose runner --------------------------------------------------------
  function isNode() {
    return (
      typeof process !== 'undefined' &&
      process.versions != null &&
      process.versions.node != null
    );
  }

  function createRunner(getBaseUrl) {
    var useWorker = !isNode() && typeof Worker === 'function';
    var runner = useWorker ? createWorkerRunner(getBaseUrl) : null;
    var mainRunner = createMainThreadRunner(getBaseUrl);
    var fellBack = false;

    function init() {
      if (runner && !fellBack) {
        return runner.init().catch(function (err) {
          // eslint-disable-next-line no-console
          console.error('F# worker unavailable, falling back to main thread:', err);
          fellBack = true;
          runner = null;
          return mainRunner.init();
        });
      }
      return mainRunner.init();
    }

    function run(source, input) {
      return init().then(function () {
        return (runner && !fellBack ? runner : mainRunner).run(source, input);
      });
    }

    return {
      init: init,
      run: run,
      get ready() {
        return runner && !fellBack ? runner.ready : mainRunner.ready;
      },
    };
  }

  var runner = createRunner(getBaseUrl);

  var api = {
    init: runner.init,
    run: runner.run,
    get ready() {
      return runner.ready;
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
      return runner
        .init()
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
        var result = await runner.run(code, livecodesApi.input);
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
