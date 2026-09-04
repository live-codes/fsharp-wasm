using System.Runtime.InteropServices.JavaScript;

public partial class FSharpRunner
{
    public static void Main()
    {
        FsharpCompile.LoadRefs(typeof(FSharpRunner).Assembly);
    }

    [JSExport]
    internal static System.Threading.Tasks.Task<string> RunFsharp(string source) =>
        FsharpCompile.Run(source);
}