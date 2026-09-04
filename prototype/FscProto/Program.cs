using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Threading.Tasks;
using FSharp.Compiler.CodeAnalysis;
using FSharp.Compiler.Diagnostics;
using FSharp.Compiler.IO;
using Microsoft.FSharp.Control;

class Program
{
    static async Task<int> Main()
    {
        var vfs = new VirtualFileSystem();
        FileSystemAutoOpens.FileSystem = vfs;

        var checker = FSharpChecker.Create(
            null, null, null, null, null, null, null, null, null, null, null, null, null, null);

        const string source = @"
let x = 1
printfn ""Hello from F#! x = %d"" x
let evens = [ 1..10 ] |> List.filter (fun n -> n % 2 = 0)
printfn ""Evens: %A"" evens
";

        // Prepare references: full ref pack + FSharp.Core
        var refDir = Directory.GetDirectories(
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                    ".dotnet", "packs", "Microsoft.NETCore.App.Ref"))
            .SelectMany(d => Directory.GetDirectories(Path.Combine(d, "ref")))
            .First();
        var fsharpCore = Directory.GetDirectories(
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                    ".nuget", "packages", "fsharp.core"))
            .OrderByDescending(Path.GetFileName)
            .Select(p => Path.Combine(p, "lib", "netstandard2.1", "FSharp.Core.dll"))
            .First(File.Exists);

        vfs.AddFile("/lib/FSharp.Core.dll", File.ReadAllBytes(fsharpCore));
        foreach (var dll in Directory.GetFiles(refDir, "*.dll"))
            vfs.AddFile("/lib/" + Path.GetFileName(dll), File.ReadAllBytes(dll));

        vfs.AddFile("/tmp/Main.fs", source);

        var args = new List<string>
        {
            "fsc.exe",
            "--simpleresolution",
            "--optimize-",
            "--nowin32manifest",
            "--noframework",
            "--targetprofile:netcore",
            "--fullpaths",
            "--warn:3",
            "--target:exe",
            "/tmp/Main.fs",
        };
        foreach (var dll in vfs.EnumerateFilesShim("/lib", "*.dll"))
            args.Add("-r:" + dll);
        args.Add("-o:/tmp/out.exe");

        var options = checker.GetProjectOptionsFromCommandLineArgs("/tmp/out.fsproj", args.Skip(1).ToArray(), null, null, null);

        Console.WriteLine("Compiling (virtual fs)...");
        var sw = System.Diagnostics.Stopwatch.StartNew();
        var checkRes = await FSharpAsync.StartAsTask(checker.ParseAndCheckProject(options, null), null, null);
        sw.Stop();
        Console.WriteLine($"Parse+Check: {sw.Elapsed}");
        foreach (var e in checkRes.Diagnostics)
            Console.WriteLine($"[{e.Severity}] {e.StartLine}:{e.StartColumn} FS{e.ErrorNumber} {e.Message}");

        if (checkRes.Diagnostics.Any(e => e.Severity == FSharpDiagnosticSeverity.Error))
        {
            Console.WriteLine("COMPILE FAILED");
            return 1;
        }

        Console.WriteLine("Emitting...");
        sw.Restart();
        var emit = await FSharpAsync.StartAsTask(checker.Compile(args.ToArray(), null), null, null);
        sw.Stop();
        Console.WriteLine($"Compile: {sw.Elapsed}, ex={emit.Item2}");
        if (emit.Item2 != null || emit.Item1.Any(e => e.Severity == FSharpDiagnosticSeverity.Error))
        {
            Console.WriteLine("EMIT FAILED");
            return 1;
        }

        var bytes = vfs.GetFile("/tmp/out.exe");
        Console.WriteLine($"Assembly size: {bytes.Length} bytes");
        var asm = Assembly.Load(bytes);
        Console.WriteLine($"EntryPoint: {asm.EntryPoint?.DeclaringType?.FullName}::{asm.EntryPoint?.Name}");

        Console.WriteLine("=== OUTPUT ===");
        var sw2 = new StringWriter();
        var oldOut = Console.Out;
        var oldErr = Console.Error;
        Console.SetOut(sw2);
        Console.SetError(sw2);
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
                    sw2.WriteLine($"(exit code: {ret})");
            }
        }
        finally
        {
            Console.SetOut(oldOut);
            Console.SetError(oldErr);
        }
        Console.WriteLine(sw2.ToString());
        Console.WriteLine("=== END OUTPUT ===");
        return 0;
    }
}