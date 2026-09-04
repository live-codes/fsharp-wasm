using System;
using System.Threading.Tasks;
using Microsoft.FSharp.Control;

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

return 0;

public partial class Program
{
}