/*!
 * fsharp-worker.js — F# compiler Web Worker.
 *
 * Loaded by fsharp-compiler.js via `new Worker(<base>/fsharp-worker.js)`.
 * Boots the .NET WebAssembly runtime (dotnet.js) and the real F# compiler in
 * the worker thread, and compiles/runs F# on request. Because the runtime lives
 * in the worker, the main thread never blocks, and the loader can simply
 * terminate + recreate this worker to get a fresh runtime (see MAX_RUNS in
 * fsharp-compiler.js) — which avoids the FCS-on-wasm hang after ~3 compiles.
 *
 * Protocol (worker <-> main):
 *   main -> worker: { type: 'compile', source, id }
 *   worker -> main: { type: 'ready' } | { type: 'fatal', message }
 *   worker -> main: { type: 'result', id, json }
 *                   | { type: 'error', id, message }
 */
"use strict";
var DEFAULT_BASE_URL = "https://cdn.jsdelivr.net/npm/@live-codes/fsharp-wasm/";
var baseUrl = self.baseUrl || DEFAULT_BASE_URL;
console.log(baseUrl);
var ready = false;
var exportsObj = null;
var queue = [];

self.onmessage = function (e) {
  var data = e.data || {};
  if (data.type !== "compile") return;
  if (!ready || !exportsObj) queue.push(data);
  else compile(data);
};

async function compile(msg) {
  try {
    var json = await exportsObj.FSharpRunner.RunFsharp(
      msg.source,
      msg.stdin || "",
    );
    self.postMessage({ type: "result", id: msg.id, json: json });
  } catch (err) {
    self.postMessage({
      type: "error",
      id: msg.id,
      message: String((err && err.stack) || err),
    });
  }
}

(async function () {
  try {
    // webpackIgnore keeps bundlers from trying to resolve the CDN module.
    var dotnetModule = await import(
      /* webpackIgnore: true */ baseUrl + "_framework/dotnet.js"
    );
    var runtime = await dotnetModule.dotnet.withDiagnosticTracing(false).create();
    var config = runtime.getConfig();
    exportsObj = await runtime.getAssemblyExports(config.mainAssemblyName);
    // runMain() runs the app's Main() but keeps the runtime alive.
    await runtime.runMain();
    ready = true;
    queue.splice(0).forEach(compile);
    self.postMessage({ type: "ready" });
  } catch (err) {
    self.postMessage({
      type: "fatal",
      message: String((err && err.stack) || err),
    });
  }
})();
