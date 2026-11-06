<#
.SYNOPSIS
  Launch SignalBench.

.EXAMPLE
  ./run.ps1                                   # desktop app (Tauri dev mode)
  ./run.ps1 -Flash app                        # ...and build + flash firmware at start-up
  ./run.ps1 -Flash app -Scenario 00_demo_tour # ...then play a scenario (hands-free demo)
  ./run.ps1 -Headless                         # no UI: firmware + simulator in the terminal
  ./run.ps1 -Headless -Firmware blinky -Duration 10000
#>
param(
    [string]$Flash,
    [string]$Scenario,
    [switch]$Headless,
    [string]$Firmware = "app",
    [int]$Duration = 0
)
$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot

if ($Headless) {
    & (Join-Path $Root "build.ps1") -Only firmware
    & (Join-Path $Root "build.ps1") -Only sim
    $exe = Join-Path $Root "firmware/build/bin/$Firmware.exe"
    if (-not (Test-Path $exe)) { $exe = Join-Path $Root "firmware/build/bin/$Firmware" }
    $argList = @("--firmware", $exe)
    if ($Duration -gt 0) { $argList += @("--duration", $Duration) }
    Write-Host "Running $Firmware headless (Ctrl+C to stop)..." -ForegroundColor Cyan
    $sbsim = Join-Path $Root "sim/target/release/sbsim.exe"
    if (-not (Test-Path $sbsim)) { $sbsim = Join-Path $Root "sim/target/release/sbsim" }
    & $sbsim @argList
    exit $LASTEXITCODE
}

Push-Location (Join-Path $Root "app")
try {
    if (-not (Test-Path "node_modules")) {
        npm ci
        if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }
    }
    $env:SIGNALBENCH_AUTOFLASH = $Flash
    $env:SIGNALBENCH_AUTOSCRIPT = $Scenario
    npm run tauri dev
} finally {
    Remove-Item Env:SIGNALBENCH_AUTOFLASH, Env:SIGNALBENCH_AUTOSCRIPT -ErrorAction SilentlyContinue
    Pop-Location
}
