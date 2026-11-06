<#
.SYNOPSIS
  Run every SignalBench test layer: firmware unit tests, simulator tests,
  and software-in-the-loop scenarios (the real firmware against the plant model).

.EXAMPLE
  ./test.ps1                                  # all three layers
  ./test.ps1 -Only sil                        # unit | sim | sil
  ./test.ps1 -Only sil -Scenario 03_short_retry_lockout -VerboseLog
#>
param(
    [ValidateSet("all", "unit", "sim", "sil")] [string]$Only = "all",
    [string]$Scenario = "*",
    [switch]$VerboseLog
)
$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$failed = @()

function Step([string]$Name, [scriptblock]$Cmd) {
    Write-Host "`n==> $Name" -ForegroundColor Cyan
    & $Cmd
    if ($LASTEXITCODE -ne 0) { $script:failed += $Name; Write-Host "FAILED: $Name" -ForegroundColor Red }
}

# Make sure what we test is built.
$need = switch ($Only) { "unit" { "firmware" } "sim" { "sim" } "sil" { "all" } default { "all" } }
if ($need -eq "all") {
    & (Join-Path $Root "build.ps1") -Only firmware
    & (Join-Path $Root "build.ps1") -Only sim
} else {
    & (Join-Path $Root "build.ps1") -Only $need
}

if ($Only -in "all", "unit") {
    Step "Firmware unit tests (Unity)" { ctest --test-dir (Join-Path $Root "firmware/build") --output-on-failure }
}
if ($Only -in "all", "sim") {
    Step "Simulator tests" { cargo test --release --manifest-path (Join-Path $Root "sim/Cargo.toml") }
}
if ($Only -in "all", "sil") {
    $exe = Join-Path $Root "firmware/build/bin/app.exe"
    if (-not (Test-Path $exe)) { $exe = Join-Path $Root "firmware/build/bin/app" }
    $sbsim = Join-Path $Root "sim/target/release/sbsim.exe"
    if (-not (Test-Path $sbsim)) { $sbsim = Join-Path $Root "sim/target/release/sbsim" }
    $scripts = Get-ChildItem (Join-Path $Root "firmware/scenarios") -Filter "$Scenario.sbs" | Sort-Object Name
    if (-not $scripts) { throw "no scenarios match '$Scenario'" }
    $argList = @("--firmware", $exe)
    if (-not $VerboseLog) { $argList += "--quiet" }
    foreach ($s in $scripts) { $argList += @("--script", $s.FullName) }
    Step "SIL scenarios ($($scripts.Count))" { & $sbsim @argList }
}

if ($failed) {
    Write-Host "`n$($failed.Count) test stage(s) failed: $($failed -join ', ')" -ForegroundColor Red
    exit 1
}
Write-Host "`nAll tests passed." -ForegroundColor Green
