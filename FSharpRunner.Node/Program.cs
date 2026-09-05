using System;
using System.Threading.Tasks;
using Microsoft.FSharp.Control;

if (args.Length > 0 && args[0] == "rich")
{
    // Validated in a fresh process: JSON, regex, anonymous records, async.
    const string rich = @"
module Main

open System.Text.Json
let json = JsonSerializer.Serialize({| name = ""F#""; year = 2026 |})
printfn ""JSON: %s"" json
let m = System.Text.RegularExpressions.Regex(""(\d+)-(\d+)"").Match(""12-34"")
printfn ""Regex: %s %s"" m.Groups.[1].Value m.Groups.[2].Value

let AsyncMain =
    async {
        let sum = [ 1..10 ] |> List.sum
        printfn ""Async sum: %d"" sum
    }
";
    Console.WriteLine(await FsharpCompile.Run(rich));
    return 0;
}

Console.WriteLine("== test A: top-level statements ==");
const string a = "printfn \"Hello, world!\"\nlet evens = [ 1..10 ] |> List.filter (fun n -> n % 2 = 0)\nprintfn \"Evens: %A\" evens\n";
Console.WriteLine(await FsharpCompile.Run(a));

Console.WriteLine("== test B: module Main + AsyncMain ==");
const string b = @"
module Main

let hello name =
    printfn ""Hello, %s!"" name

let AsyncMain =
    async {
        hello ""from WebAssembly""
        let evens = [ 1..20 ] |> List.filter (fun n -> n % 2 = 0)
        printfn ""Evens: %A"" evens
        printfn ""Sum: %d"" (evens |> List.sum)
    }
";
Console.WriteLine(await FsharpCompile.Run(b));

Console.WriteLine("== test C: compile error ==");
const string c = "let x = 'a'\nprintfn \"%s\" x\n";
Console.WriteLine(await FsharpCompile.Run(c));

// Note: a single runtime instance can only safely run ~3 compiles before it hangs
// (see README). The "rich" test runs in a fresh process via: dotnet run -- rich.

return 0;

public partial class Program
{
}