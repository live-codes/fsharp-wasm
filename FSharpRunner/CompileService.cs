using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text.Json;
using System.Threading.Tasks;
using FSharp.Compiler.CodeAnalysis;
using FSharp.Compiler.Diagnostics;
using FSharp.Compiler.IO;
using Microsoft.FSharp.Control;
using Microsoft.FSharp.Core;

/// <summary>Shared compile + execute logic used by both the browser app and the Node test harness.</summary>
public static class FsharpCompile
{
    static readonly VirtualFileSystem Vfs = new VirtualFileSystem();
    static bool _refsLoaded;

    static readonly FSharpChecker Checker = FSharpChecker.Create(
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        FSharpOption<bool>.Some(false), // useTransparentCompiler: false — the transparent compiler blocks on
                                         // Async.RunSynchronously/SemaphoreSlim, which is unsupported on the
                                         // single-threaded WebAssembly runtime
        null,
        FSharpOption<bool>.Some(false), // parallelReferenceResolution: false — avoid parallel import machinery
                                         // that blocks the single-threaded runtime
        null,
        null,
        null,
        null);

    public static Task<string> Run(string source) => RunAsync(source);

    public static void LoadRefs(Assembly resourceAssembly, string resourcePrefix = "lib.")
    {
        if (_refsLoaded) return;
        _refsLoaded = true;

        // Avoid the parallel import machinery (MultipleDiagnosticsLoggers.Parallel), which
        // yields and then blocks on the single-threaded WebAssembly runtime.
        // (Setting the env var is best-effort; the --parallelcompilation- flag already covers it.)
        try { Environment.SetEnvironmentVariable("FCS_ParallelReferenceResolution", "false"); }
        catch (Exception) { }

        foreach (var name in resourceAssembly.GetManifestResourceNames()
                     .Where(n => n.StartsWith(resourcePrefix, StringComparison.Ordinal)))
        {
            using var stream = resourceAssembly.GetManifestResourceStream(name);
            using var ms = new MemoryStream();
            stream.CopyTo(ms);
            var fileName = name.Substring(resourcePrefix.Length);
            var bytes = ms.ToArray();
            Vfs.AddFile("/lib/" + fileName, bytes);
            // Also expose at the root: FCS searches its implicit include dir ("/") when
            // resolving the primary assembly and other library files.
            Vfs.AddFile("/" + fileName, bytes);
        }

        FileSystemAutoOpens.FileSystem = Vfs;
    }

    static async Task<string> RunAsync(string source)
    {
        LoadRefs(typeof(FsharpCompile).Assembly);
        try
        {
            Vfs.AddFile("/tmp/Main.fs", source);

            var args = BuildArgs("/tmp/out.exe");

            // FSharpChecker.Compile runs the self-contained fsc driver, which uses
            // Async.RunSynchronouslyImmediate (non-blocking) and works on the
            // single-threaded WebAssembly runtime. The background checker
            // (ParseAndCheckProject) relies on blocking waits unsupported on wasm.
            var emit = await FSharpAsync.StartAsTask(Checker.Compile(args, null), null, null);

            var errors = emit.Item1;
            var exceptionOpt = emit.Item2;

            // "--parallelcompilation-" is an internal/test-only flag we need on wasm; filter its warning.
            var realErrors = errors.Where(e => e.Severity == FSharpDiagnosticSeverity.Error).ToArray();
            var warnings = errors.Where(e => e.Severity == FSharpDiagnosticSeverity.Warning && e.ErrorNumber != 75).ToArray();
            if (realErrors.Any())
                return Result(false, output: "", errors: realErrors, warnings: warnings);

            // A real crash (not the normal "StopProcessingExn" abort used to signal compile errors).
            if (exceptionOpt != null && exceptionOpt.GetType().Name != "StopProcessingExn")
                return Result(false, exceptionOpt.ToString(), Array.Empty<FSharpDiagnostic>(), Array.Empty<FSharpDiagnostic>());

            var bytes = Vfs.GetFile("/tmp/out.exe");
            var asm = Assembly.Load(bytes);

            var output = await Execute(asm);
            return Result(true, output, Array.Empty<FSharpDiagnostic>(), warnings);
        }
        catch (Exception ex)
        {
            return Result(false, ex.ToString(), Array.Empty<FSharpDiagnostic>(), Array.Empty<FSharpDiagnostic>());
        }
    }

    static string[] BuildArgs(string outFile)
    {
        var args = new List<string>
        {
            "fsc.exe",
            "--simpleresolution",
            "--optimize-",
            "--nowin32manifest",
            "--noframework",
            "--parallelcompilation-",
            "--targetprofile:netcore",
            "--fullpaths",
            "--warn:3",
            "--target:exe",
            "/tmp/Main.fs",
        };
        foreach (var dll in Vfs.EnumerateFilesShim("/lib", "*.dll").OrderBy(p => p))
            args.Add("-r:" + dll);
        args.Add("-o:" + outFile);
        return args.ToArray();
    }

    static async Task<string> Execute(Assembly asm)
    {
        var sw = new StringWriter();
        var oldOut = Console.Out;
        var oldErr = Console.Error;
        Console.SetOut(sw);
        Console.SetError(sw);
        try
        {
            var ep = asm.EntryPoint;
            if (ep != null)
            {
                object[] argv = ep.GetParameters().Length == 1
                    ? new object[] { Array.Empty<string>() }
                    : Array.Empty<object>();
                var ret = ep.Invoke(null, argv);
                if (ret != null)
                    sw.WriteLine($"(exit code: {ret})");
            }

            var mainType = asm.GetType("Main");
            if (mainType != null)
            {
                // F# module values compile to properties (e.g. Main.AsyncMain : Async<unit>).
                var asyncMainProp = mainType.GetProperty("AsyncMain", BindingFlags.Static | BindingFlags.Public);
                if (asyncMainProp != null)
                {
                    var res = asyncMainProp.GetValue(null);
                    var task = (Task)FSharpAsync.StartAsTask((FSharpAsync<Unit>)res, null, null);
                    await task;
                }
                else
                {
                    var asyncMain = mainType.GetMethod("AsyncMain", BindingFlags.Static | BindingFlags.Public);
                    if (asyncMain != null)
                    {
                        var res = asyncMain.Invoke(null, null);
                        var task = (Task)FSharpAsync.StartAsTask((FSharpAsync<Unit>)res, null, null);
                        await task;
                    }
                }
            }
        }
        finally
        {
            Console.SetOut(oldOut);
            Console.SetError(oldErr);
        }
        return sw.ToString();
    }

    static string Result(bool ok, string output, FSharpDiagnostic[] errors, FSharpDiagnostic[] warnings)
    {
        var result = new Dictionary<string, object>
        {
            ["ok"] = ok,
            ["output"] = output,
            ["errors"] = errors.Select(ToDiagnostic),
            ["warnings"] = warnings.Select(ToDiagnostic),
        };
        return JsonSerializer.Serialize(result);
    }

    static object ToDiagnostic(FSharpDiagnostic d) => new
    {
        message = d.Message,
        line = d.StartLine,
        column = d.StartColumn,
        errorNumber = d.ErrorNumber,
        severity = d.Severity.ToString(),
    };
}