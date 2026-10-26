<#
.SYNOPSIS
  Build SignalBench: firmware (CMake), simulator (Cargo) and the desktop app frontend.

.EXAMPLE
  ./build.ps1                    # everything
  ./build.ps1 -Only firmware     # just one part: firmware | sim | app
  ./build.ps1 -Bundle            # also produce the Windows installer (tauri build)
#>
param(
    [ValidateSet("all", "firmware", "sim", "app")] [string]$Only = "all",
    [switch]$Bundle
)
$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot

function Step([string]$Name, [scriptblock]$Cmd) {
    Write-Host "`n==> $Name" -ForegroundColor Cyan
    & $Cmd
    if ($LASTEXITCODE -ne 0) { throw "$Name failed (exit $LASTEXITCODE)" }
}

function Build-Firmware {
    $src = Join-Path $Root "firmware"
    $bld = Join-Path $src "build"
    if (-not (Test-Path (Join-Path $bld "CMakeCache.txt"))) {
        $gen = @()
        # Prefer MinGW gcc on Windows unless MSVC is on PATH.
        if ($IsWindows -ne $false -and (Get-Command gcc -ErrorAction SilentlyContinue) -and -not (Get-Command cl -ErrorAction SilentlyContinue)) {
            $gen = @("-G", "MinGW Makefiles")
        }
        Step "Configure firmware" { cmake -S $src -B $bld @gen }
    }
    Step "Build firmware, examples and tests" { cmake --build $bld -j 8 }
}

function Build-Sim {
    Step "Build simulator + sbsim" { cargo build --release --manifest-path (Join-Path $Root "sim/Cargo.toml") }
}

function Build-App {
    Push-Location (Join-Path $Root "app")
    try {
        if (-not (Test-Path "node_modules")) { Step "Install app dependencies" { npm ci } }
        if ($Bundle) {
            Step "Build desktop app installer" { npm run tauri build }
        } else {
            Step "Build app frontend" { npm run build }
            Step "Check Tauri shell" { cargo check --manifest-path src-tauri/Cargo.toml }
        }
    } finally { Pop-Location }
}

if ($Only -in "all", "firmware") { Build-Firmware }
if ($Only -in "all", "sim")      { Build-Sim }
if ($Only -in "all", "app")      { Build-App }
Write-Host "`nBuild complete." -ForegroundColor Green
