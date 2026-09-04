# Prepares the FSharpRunner/refs folder with the BCL reference assemblies and
# FSharp.Core DLLs that FSharp.Compiler.Service needs to compile user code in the browser.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\prepare-refs.ps1 [-SdkRoot <dotnet root>]

param(
    [string]$SdkRoot = (Join-Path $env:USERPROFILE ".dotnet")
)

$ErrorActionPreference = "Stop"

$refPackDir = Get-ChildItem (Join-Path $SdkRoot "packs\Microsoft.NETCore.App.Ref") -Directory |
    Sort-Object Name -Descending | Select-Object -First 1
$refDir = Join-Path $refPackDir.FullName "ref\net10.0"
if (-not (Test-Path $refDir)) {
    $refDir = Get-ChildItem (Join-Path $refPackDir.FullName "ref") -Directory |
        Sort-Object Name -Descending | Select-Object -First 1 -ExpandProperty FullName
}
if (-not (Test-Path $refDir)) { throw "Ref pack not found under $($refPackDir.FullName)" }

$fsharpCorePackage = Get-ChildItem (Join-Path $SdkRoot "..\.nuget\packages\fsharp.core") -Directory |
    Sort-Object Name -Descending | Select-Object -First 1
$fsharpCore = Join-Path $fsharpCorePackage.FullName "lib\netstandard2.1\FSharp.Core.dll"
if (-not (Test-Path $fsharpCore)) {
    $fsharpCore = Get-ChildItem (Join-Path $fsharpCorePackage.FullName "lib") -Directory |
        Sort-Object Name -Descending |
        ForEach-Object { Join-Path $_.FullName "FSharp.Core.dll" } |
        Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not (Test-Path $fsharpCore)) { throw "FSharp.Core.dll not found in $($fsharpCorePackage.FullName)" }

$target = Join-Path $PSScriptRoot "..\FSharpRunner\refs"
New-Item -ItemType Directory -Path $target -Force | Out-Null
Get-ChildItem $target -Filter *.dll | Remove-Item -Force

Copy-Item (Join-Path $refDir "*.dll") $target
Copy-Item $fsharpCore (Join-Path $target "FSharp.Core.dll") -Force

$count = (Get-ChildItem $target -Filter *.dll).Count
$size = [math]::Round((Get-ChildItem $target -Filter *.dll | Measure-Object Length -Sum).Sum / 1MB, 2)
Write-Host "Prepared $count reference assemblies ($size MB) in $target"