# Starts an Orbs of Magic server on this machine:
#   1. pulls the latest code (git pull --ff-only, when this folder has a git upstream)
#   2. installs npm packages and builds the game client (dist/)
#   3. with -HostOnline, opens a Cloudflare quick tunnel to port 2567 and prints the
#      public URL for friends
#   4. hosts the server in this window (the tunnel goes first so the URL isn't buried
#      under the server's output)
#
#   .\start-server.ps1                     this PC/LAN only
#   .\start-server.ps1 -HostOnline         the same, plus a public URL for friends
#   .\start-server.ps1 --port 8080
#   start-server.cmd -HostOnline           from cmd or a shortcut (a double-click hosts locally)
#
# Anything the script doesn't know is passed to the server (see server/index.ts).
# The script's own options:
#   -SkipPull           don't update the code first
#   -SkipInstall        don't run npm install
#   -SkipBuild          don't rebuild the client (uses the dist/ already there)
#   -HostOnline         open a Cloudflare tunnel so friends can join over the internet
#                       (--host-online works too)
#   -Cloudflared PATH   where cloudflared.exe is. Otherwise: $env:CLOUDFLARED, then
#                       PATH, then ..\cloudflared\cloudflared.exe next to this folder.
#
# Ctrl+C stops the server, then the tunnel is closed.
# Logs: logs/tunnel.log. The last URL is kept in logs/tunnel-url.txt.

$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
Set-Location $Root

$skipPull = $false; $skipInstall = $false; $skipBuild = $false; $hostOnline = $false; $cloudflared = $env:CLOUDFLARED
$serverArgs = @()
for ($i = 0; $i -lt $args.Count; $i++) {
  $a = [string]$args[$i]
  switch ($a) {
    '-SkipPull'    { $skipPull = $true }
    '-SkipInstall' { $skipInstall = $true }
    '-SkipBuild'   { $skipBuild = $true }
    '-HostOnline'  { $hostOnline = $true }
    '--host-online' { $hostOnline = $true }
    '-Cloudflared' { $i++; $cloudflared = [string]$args[$i] }
    default        { $serverArgs += $a }
  }
}

# The port the server will listen on, so the tunnel and the wait use the same one.
$port = 2567
if ($env:PORT) { $port = [int]$env:PORT }
for ($i = 0; $i -lt $serverArgs.Count; $i++) {
  if ($serverArgs[$i] -eq '--port' -and $i + 1 -lt $serverArgs.Count) { $port = [int]$serverArgs[$i + 1] }
  elseif ($serverArgs[$i] -like '--port=*') { $port = [int]$serverArgs[$i].Substring(7) }
}

function Step($text) { Write-Host ''; Write-Host "== $text" -ForegroundColor Cyan }
function Fail($text) { Write-Host $text -ForegroundColor Red; exit 1 }

function Test-Port($p) {
  $client = New-Object System.Net.Sockets.TcpClient
  try { $client.Connect('127.0.0.1', $p); return $true } catch { return $false } finally { $client.Close() }
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail 'Node.js is not installed (version 22 or newer): https://nodejs.org/' }
if (Test-Port $port) { Fail "Something is already listening on port $port. Stop the old server first (or pass --port)." }

# 1. Pull the latest
Step '1/4 Pulling the latest code'
if ($skipPull) {
  Write-Host 'Skipped (-SkipPull).'
} elseif (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Host 'git is not installed, so the code was not updated.' -ForegroundColor Yellow
} else {
  & git -C $Root rev-parse --is-inside-work-tree *> $null
  $isRepo = ($LASTEXITCODE -eq 0)
  $upstream = $null
  if ($isRepo) { $upstream = & git -C $Root rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2> $null }
  if (-not $isRepo) {
    Write-Host 'This folder is not a git checkout, so the code was not updated.' -ForegroundColor Yellow
  } elseif (-not $upstream) {
    Write-Host 'This branch has no upstream (no remote to pull from), so the code was not updated.' -ForegroundColor Yellow
  } else {
    & git -C $Root pull --ff-only
    if ($LASTEXITCODE -ne 0) { Fail "git pull failed (local changes, or the branch has diverged from $upstream). Sort it out, or run with -SkipPull." }
  }
}

# 2. Build
Step '2/4 Installing packages and building'
if ($skipInstall) {
  Write-Host 'Skipped (-SkipInstall).'
} else {
  & npm install --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { Fail 'npm install failed.' }
}
if ($skipBuild) {
  Write-Host 'Client build skipped (-SkipBuild).'
} else {
  & npm run build
  if ($LASTEXITCODE -ne 0) { Fail 'npm run build failed.' }
}
if (-not (Test-Path (Join-Path $Root 'dist/index.html'))) { Fail 'There is no built client in dist/. Run without -SkipBuild.' }

# 3. The tunnel
$logs = Join-Path $Root 'logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$tunnel = $null
$url = $null
if (-not $hostOnline) {
  Step '3/4 No tunnel (pass -HostOnline for a public URL)'
} else {
  Step '3/4 Opening a Cloudflare tunnel'
  if (-not $cloudflared) {
    $onPath = Get-Command cloudflared -ErrorAction SilentlyContinue
    if ($onPath) { $cloudflared = $onPath.Source }
    else { $cloudflared = Join-Path (Join-Path (Split-Path $Root -Parent) 'cloudflared') 'cloudflared.exe' }
  }
  if (-not (Test-Path $cloudflared)) { Fail "cloudflared not found at $cloudflared. Pass -Cloudflared <path>, set CLOUDFLARED, or leave out -HostOnline." }

  # Close a tunnel an earlier run left behind (only ever the one it recorded).
  $pidFile = Join-Path $logs 'tunnel.pid'
  if (Test-Path $pidFile) {
    $old = Get-Process -Id ([int](Get-Content $pidFile -Raw)) -ErrorAction SilentlyContinue
    if ($old -and $old.ProcessName -like 'cloudflared*') { Stop-Process -Id $old.Id -Force }
    Remove-Item $pidFile -Force
  }

  # cloudflared writes its log, URL included, to stderr.
  $log = Join-Path $logs 'tunnel.log'
  # Hidden, in its own console: Ctrl+C goes to the server, and the script closes the tunnel after.
  $start = @{
    FilePath = $cloudflared; PassThru = $true
    ArgumentList = @('tunnel', '--no-autoupdate', '--url', "http://localhost:$port")
    RedirectStandardError = $log; RedirectStandardOutput = (Join-Path $logs 'tunnel.out.log')
  }
  if ($env:OS -eq 'Windows_NT') { $start.WindowStyle = 'Hidden' }
  $tunnel = Start-Process @start
  Set-Content -Path $pidFile -Value $tunnel.Id

  $deadline = (Get-Date).AddSeconds(45)
  while (-not $url -and (Get-Date) -lt $deadline -and -not $tunnel.HasExited) {
    Start-Sleep -Milliseconds 500
    try {
      $stream = [System.IO.File]::Open($log, 'Open', 'Read', 'ReadWrite')
      $text = (New-Object System.IO.StreamReader($stream)).ReadToEnd()
      $stream.Close()
      $m = [regex]::Match($text, 'https://(?!api\.)[a-z0-9-]+\.trycloudflare\.com')
      if ($m.Success) { $url = $m.Value }
    } catch { }
  }
  if (-not $url) {
    if (-not $tunnel.HasExited) { Stop-Process -Id $tunnel.Id -Force }
    Fail "The tunnel didn't give a URL. See $log, or leave out -HostOnline."
  }
  Set-Content -Path (Join-Path $logs 'tunnel-url.txt') -Value $url
  try { Set-Clipboard -Value $url } catch { }
  try { $Host.UI.RawUI.WindowTitle = "Orbs of Magic server - $url" } catch { }
}

Write-Host ''
Write-Host '  ===========================================================' -ForegroundColor Green
if ($url) {
  Write-Host "  Friends join at:  $url" -ForegroundColor Green
  Write-Host '  (copied to the clipboard, and in the window title)' -ForegroundColor Green
}
if ($url) { Write-Host "  You can also use:  http://localhost:$port/" -ForegroundColor Green }
else { Write-Host "  Play at:  http://localhost:$port/  (friends on your network: http://<this PC's address>:$port/)" -ForegroundColor Green }
Write-Host '  Ctrl+C stops everything.' -ForegroundColor Green
Write-Host '  ===========================================================' -ForegroundColor Green

# 4. Host the server, in this window, so Ctrl+C reaches it.
Step '4/4 Starting the server'
try {
  # The server is TypeScript, so it runs through the tsx that npm install put in node_modules.
  $env:NODE_ENV = 'production'
  & node (Join-Path $Root 'node_modules/tsx/dist/cli.mjs') (Join-Path $Root 'server/index.ts') @serverArgs
} finally {
  if ($tunnel -and -not $tunnel.HasExited) {
    Write-Host 'Closing the tunnel.'
    Stop-Process -Id $tunnel.Id -Force -ErrorAction SilentlyContinue
  }
  Remove-Item (Join-Path $logs 'tunnel.pid') -Force -ErrorAction SilentlyContinue
}
