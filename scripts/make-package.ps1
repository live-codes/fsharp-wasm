# Assembles a deployable npm-package folder for the F# wasm bundle.
# The result can be published to npm (for jsDelivr) or uploaded to any static host/CDN.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\make-package.ps1 [-Version x.y.z]

param(
    [string]$Version = "0.1.0"
)

$ErrorActionPreference = "Stop"

$root = Join-Path $PSScriptRoot ".."
$wwwroot = Join-Path $root "FSharpRunner\publish\wwwroot"
if (-not (Test-Path (Join-Path $wwwroot "_framework\dotnet.js"))) {
    throw "Publish output not found. Run: dotnet publish FSharpRunner -c Release -o FSharpRunner\publish"
}

$out = Join-Path $root "fsharp-package"
New-Item -ItemType Directory -Path $out -Force | Out-Null

# Copy the static wasm bundle (dotnet.js, runtime, F# compiler, BCL, app assembly)
Copy-Item (Join-Path $wwwroot "*") $out -Recurse -Force

# The CDN loader wrapper
Copy-Item (Join-Path $root "fsharp-compiler.js") $out -Force

# npm metadata (jsDelivr serves package files at https://cdn.jsdelivr.net/npm/<name>@<version>/)
$packageJson = @{
    name        = "@live-codes/fsharp-wasm"
    version     = $Version
    description = "F# in the browser: the real F# compiler (FSharp.Compiler.Service) running on .NET WebAssembly via Bolero. No backend."
    type        = "module"
    main        = "fsharp-compiler.js"
    files       = @("_framework", "fsharp-compiler.js", "index.html", "main.js")
    keywords    = @("fsharp", "f#", "wasm", "webassembly", "bolero", "compiler", "playground", "livecodes")
    license     = "MIT"
    homepage    = "https://github.com/live-codes/livecodes"
} | ConvertTo-Json -Depth 4
Set-Content -Path (Join-Path $out "package.json") -Value $packageJson -Encoding UTF8

$sizeMb = [math]::Round((Get-ChildItem $out -Recurse -File | Measure-Object Length -Sum).Sum / 1MB, 2)
Write-Host "Created npm package folder: $out"
Write-Host "  version: $Version"
Write-Host "  size:    $sizeMb MB"
Write-Host "Deploy it to npm (jsDelivr: https://cdn.jsdelivr.net/npm/@live-codes/fsharp-wasm@$Version/) or to any static host."