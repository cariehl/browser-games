<#
.SYNOPSIS
  Remove build outputs. Add -All to also remove node_modules.
#>
param([switch]$All)
$Root = $PSScriptRoot
$paths = @("firmware/build", "sim/target", "app/dist", "app/src-tauri/target")
if ($All) { $paths += "app/node_modules" }
foreach ($p in $paths) {
    $full = Join-Path $Root $p
    if (Test-Path $full) {
        Write-Host "removing $p"
        Remove-Item -Recurse -Force $full
    }
}
Write-Host "Clean." -ForegroundColor Green
