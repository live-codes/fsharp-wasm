# Prepares the FSharpRunner/refs folder with the BCL reference assemblies and
# FSharp.Core DLLs that FSharp.Compiler.Service needs to compile user code in the browser.
#
# Version-robust: picks the newest installed .NET ref pack (and its newest target
# framework folder) and the exact FSharp.Core version that the pinned
# FSharp.Compiler.Service package resolves to. Run again after upgrading the SDK or FCS.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\prepare-refs.ps1 [-SdkRoot <dotnet root>]

param(
    [string]$SdkRoot = (Join-Path $env:USERPROFILE ".dotnet")
)

$ErrorActionPreference = "Stop"

$nugetPackages = Join-Path $env:USERPROFILE ".nuget\packages"
if (-not (Test-Path $nugetPackages)) {
    $nugetPackages = Join-Path (Split-Path $SdkRoot -Parent) ".nuget\packages"
}
if (-not (Test-Path $nugetPackages)) { throw "NuGet packages folder not found ($nugetPackages)" }

# --- BCL reference assemblies: newest installed ref pack, newest ref/<tfm> folder ---
$refPackDir = Get-ChildItem (Join-Path $SdkRoot "packs\Microsoft.NETCore.App.Ref") -Directory |
    Sort-Object Name -Descending | Select-Object -First 1
if (-not $refPackDir) { throw "Microsoft.NETCore.App.Ref pack not found under $SdkRoot\packs" }
$refDir = Get-ChildItem (Join-Path $refPackDir.FullName "ref") -Directory |
    Sort-Object Name -Descending | Select-Object -First 1 -ExpandProperty FullName
if (-not $refDir) { throw "Ref pack has no target-framework folder under $($refPackDir.FullName)" }

# --- FSharp.Core: exact version resolved by the pinned FSharp.Compiler.Service ---
$assetsPath = Join-Path $PSScriptRoot "..\FSharpRunner\obj\project.assets.json"
$fsharpCore = $null
if (Test-Path $assetsPath) {
    try {
        $assets = Get-Content $assetsPath -Raw | ConvertFrom-Json
        $libEntry = $assets.libraries.PSObject.Properties |
            Where-Object { $_.Name -match '^FSharp\.Core/' } | Select-Object -First 1
        if ($libEntry) {
            $pkgDir = Join-Path $nugetPackages ($libEntry.Value.path)
            $fsharpCore = Get-ChildItem $pkgDir -Recurse -Filter "FSharp.Core.dll" -ErrorAction SilentlyContinue |
                Where-Object { $_.FullName -match '\\lib\\' } | Select-Object -First 1 -ExpandProperty FullName
            Write-Host "Using FSharp.Core from resolved package: $($libEntry.Name)"
        }
    } catch {
        Write-Host "Could not read project.assets.json; falling back to newest cached FSharp.Core."
    }
}
if (-not $fsharpCore) {
    $pkg = Get-ChildItem (Join-Path $nugetPackages "fsharp.core") -Directory |
        Sort-Object Name -Descending | Select-Object -First 1
    $fsharpCore = Get-ChildItem $pkg.FullName -Recurse -Filter "FSharp.Core.dll" |
        Where-Object { $_.FullName -match '\\lib\\' } | Select-Object -First 1 -ExpandProperty FullName
}
if (-not (Test-Path $fsharpCore)) { throw "FSharp.Core.dll not found. Run 'dotnet restore' on FSharpRunner first." }

# --- assemble ---
$target = Join-Path $PSScriptRoot "..\FSharpRunner\refs"
New-Item -ItemType Directory -Path $target -Force | Out-Null
Get-ChildItem $target -Filter *.dll | Remove-Item -Force

Copy-Item (Join-Path $refDir "*.dll") $target
Copy-Item $fsharpCore (Join-Path $target "FSharp.Core.dll") -Force

$count = (Get-ChildItem $target -Filter *.dll).Count
$size = [math]::Round((Get-ChildItem $target -Filter *.dll | Measure-Object Length -Sum).Sum / 1MB, 2)
Write-Host "Prepared $count reference assemblies ($size MB) in $target"
Write-Host "  ref pack:  $($refPackDir.Name)\ref\$([System.IO.Path]::GetFileName($refDir))"
Write-Host "  fsharp.core: $([System.IO.Path]::GetFileName((Split-Path (Split-Path $fsharpCore -Parent) -Parent)))"