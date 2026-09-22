$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$Runtime = Join-Path $env:LOCALAPPDATA "PersonalCalendar"
$Node = Join-Path $Runtime "node\node.exe"
$PgCtl = Join-Path $Runtime "pgsql\bin\pg_ctl.exe"
$PgReady = Join-Path $Runtime "pgsql\bin\pg_isready.exe"
$PgData = Join-Path $Runtime "pgdata"
$PgLog = Join-Path $Runtime "postgres.log"
$LogDir = Join-Path $Root ".local\logs"
$ToolDir = Join-Path $Root ".local\tools"
$Cloudflared = Join-Path $ToolDir "cloudflared.exe"
$StateFile = Join-Path $Root ".local\demo-tunnel.json"

function Get-PortOwner([int]$Port) {
  $match = netstat -ano | Select-String ":$Port\s+.*LISTENING\s+(\d+)\s*$" | Select-Object -First 1
  if ($match) { return [int]$match.Matches[0].Groups[1].Value }
  return $null
}
function Wait-Port([int]$Port, [int]$Seconds = 20) {
  for ($i = 0; $i -lt ($Seconds * 4); $i++) { if (Get-PortOwner $Port) { return $true }; Start-Sleep -Milliseconds 250 }
  return $false
}
function Wait-Http([string]$Url, [int]$Seconds = 30) {
  for ($i = 0; $i -lt $Seconds; $i++) { try { $response = Invoke-WebRequest -UseBasicParsing $Url -TimeoutSec 2; if ($response.StatusCode -eq 200) { return $true } } catch {}; Start-Sleep -Seconds 1 }
  return $false
}
function Stop-ProcessTree([int]$ProcessId) {
  $children = Get-CimInstance Win32_Process -Filter "ParentProcessId = $ProcessId" -ErrorAction SilentlyContinue
  foreach ($child in $children) { Stop-ProcessTree $child.ProcessId }
  Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
}

New-Item -ItemType Directory -Force -Path $LogDir, $ToolDir | Out-Null
if (-not (Test-Path -LiteralPath $Node)) { throw "Node runtime not found: $Runtime" }
$stopScript = Join-Path $Root "stop-demo-tunnel.ps1"
if (Test-Path -LiteralPath $stopScript) { & $stopScript -Quiet }

if (-not (Wait-Port 5432 2)) {
  Write-Host "Starting local PostgreSQL..."
  & $PgCtl -D $PgData -l $PgLog -o '"-p 5432 -h 127.0.0.1"' start
}
for ($i = 0; $i -lt 30; $i++) { & $PgReady -h 127.0.0.1 -p 5432 *> $null; if ($LASTEXITCODE -eq 0) { break }; Start-Sleep -Seconds 1 }
& $PgReady -h 127.0.0.1 -p 5432 *> $null
if ($LASTEXITCODE -ne 0) { throw "PostgreSQL failed to start. See $PgLog" }

$migration = Join-Path $Root "packages\db\migrations\0001_demo_sessions.sql"
$psql = Join-Path $Runtime "pgsql\bin\psql.exe"
$previousPgOptions = $env:PGOPTIONS
$env:PGOPTIONS = "-c client_min_messages=warning"
& $psql -h 127.0.0.1 -U calendar -d calendar -v ON_ERROR_STOP=1 -f $migration *> $null
$migrationExit = $LASTEXITCODE
$env:PGOPTIONS = $previousPgOptions
if ($migrationExit -ne 0) { throw "Demo migration failed" }
$studentMigration = Join-Path $Root (Join-Path "packages" (Join-Path "db" (Join-Path "migrations" "0002_student_core.sql")))
$env:PGOPTIONS = "-c client_min_messages=warning"
& $psql -h 127.0.0.1 -U calendar -d calendar -v ON_ERROR_STOP=1 -f $studentMigration *> $null
$studentMigrationExit = $LASTEXITCODE
$env:PGOPTIONS = $previousPgOptions
if ($studentMigrationExit -ne 0) { throw "Student core migration failed" }
$aiUsageMigration = Join-Path $Root (Join-Path "packages" (Join-Path "db" (Join-Path "migrations" "0003_ai_usage.sql")))
$env:PGOPTIONS = "-c client_min_messages=warning"
& $psql -h 127.0.0.1 -U calendar -d calendar -v ON_ERROR_STOP=1 -f $aiUsageMigration *> $null
$aiUsageMigrationExit = $LASTEXITCODE
$env:PGOPTIONS = $previousPgOptions
if ($aiUsageMigrationExit -ne 0) { throw "AI usage migration failed" }
$courseMigration = Join-Path $Root (Join-Path "packages" (Join-Path "db" (Join-Path "migrations" "0004_course_timetable.sql")))
$env:PGOPTIONS = "-c client_min_messages=warning"
& $psql -h 127.0.0.1 -U calendar -d calendar -v ON_ERROR_STOP=1 -f $courseMigration *> $null
$courseMigrationExit = $LASTEXITCODE
$env:PGOPTIONS = $previousPgOptions
if ($courseMigrationExit -ne 0) { throw "Course timetable migration failed" }
$courseSlotsMigration = Join-Path $Root (Join-Path "packages" (Join-Path "db" (Join-Path "migrations" "0005_course_slots.sql")))
$env:PGOPTIONS = "-c client_min_messages=warning"
& $psql -h 127.0.0.1 -U calendar -d calendar -v ON_ERROR_STOP=1 -f $courseSlotsMigration *> $null
$courseSlotsMigrationExit = $LASTEXITCODE
$env:PGOPTIONS = $previousPgOptions
if ($courseSlotsMigrationExit -ne 0) { throw "Course slots migration failed" }
$courseDateRangeMigration = Join-Path $Root (Join-Path "packages" (Join-Path "db" (Join-Path "migrations" "0006_course_date_range.sql")))
$env:PGOPTIONS = "-c client_min_messages=warning"
& $psql -h 127.0.0.1 -U calendar -d calendar -v ON_ERROR_STOP=1 -f $courseDateRangeMigration *> $null
$courseDateRangeMigrationExit = $LASTEXITCODE
$env:PGOPTIONS = $previousPgOptions
if ($courseDateRangeMigrationExit -ne 0) { throw "Course date range migration failed" }
$password = $null
if (Test-Path -LiteralPath $StateFile) {
  try { $password = (Get-Content -LiteralPath $StateFile | ConvertFrom-Json).password } catch {}
}
if (-not $password) { $password = ([guid]::NewGuid().ToString("N")).Substring(0, 12) }
$env:NODE_ENV = "production"
$env:DEMO_MODE = "true"
$env:DEMO_ACCESS_PASSWORD = $password
$env:DEMO_SESSION_TTL_HOURS = "24"
$env:PORT = "3100"
$env:APP_URL = "http://127.0.0.1:5174"
$env:BETTER_AUTH_URL = "http://127.0.0.1:3100"
$env:CORS_ORIGIN = "http://127.0.0.1:5174"
$env:VITE_API_PROXY_TARGET = "http://127.0.0.1:3100"

Write-Host "Building demo frontend..."
$vite = Join-Path $Root "apps\web\node_modules\vite\bin\vite.js"
Push-Location (Join-Path $Root "apps\web")
try { & $Node $vite build } finally { Pop-Location }
if ($LASTEXITCODE -ne 0) { throw "Demo frontend build failed" }

$apiOut = Join-Path $LogDir "demo-api.out.log"
$apiErr = Join-Path $LogDir "demo-api.err.log"
$webOut = Join-Path $LogDir "demo-web.out.log"
$webErr = Join-Path $LogDir "demo-web.err.log"
$workerOut = Join-Path $LogDir "demo-worker.out.log"
$workerErr = Join-Path $LogDir "demo-worker.err.log"

$apiArgs = @((Join-Path $Root "apps\api\node_modules\tsx\dist\cli.mjs"), "apps/api/src/index.ts")
$api = Start-Process -FilePath $Node -ArgumentList $apiArgs -WorkingDirectory $Root -WindowStyle Hidden -RedirectStandardOutput $apiOut -RedirectStandardError $apiErr -PassThru
if (-not (Wait-Port 3100 60) -or -not (Wait-Http "http://127.0.0.1:3100/health" 30)) { Stop-ProcessTree $api.Id; throw "Demo API failed to start. See $apiErr" }

$webArgs = @($vite, "preview", "--host", "127.0.0.1", "--port", "5174")
$web = Start-Process -FilePath $Node -ArgumentList $webArgs -WorkingDirectory (Join-Path $Root "apps\web") -WindowStyle Hidden -RedirectStandardOutput $webOut -RedirectStandardError $webErr -PassThru
if (-not (Wait-Port 5174 30) -or -not (Wait-Http "http://127.0.0.1:5174" 30)) { Stop-ProcessTree $web.Id; Stop-ProcessTree $api.Id; throw "Demo web failed to start. See $webErr" }

$workerArgs = @((Join-Path $Root "apps\worker\node_modules\tsx\dist\cli.mjs"), "apps/worker/src/index.ts")
$worker = Start-Process -FilePath $Node -ArgumentList $workerArgs -WorkingDirectory $Root -WindowStyle Hidden -RedirectStandardOutput $workerOut -RedirectStandardError $workerErr -PassThru
Start-Sleep -Seconds 2
if ($worker.HasExited) { Stop-ProcessTree $web.Id; Stop-ProcessTree $api.Id; throw "Demo worker failed to start. See $workerErr" }
$tunnelOut = Join-Path $LogDir "demo-tunnel.out.log"
$tunnelErr = Join-Path $LogDir "demo-tunnel.err.log"
Remove-Item -LiteralPath $tunnelOut, $tunnelErr -Force -ErrorAction SilentlyContinue
if (-not (Test-Path -LiteralPath $Cloudflared) -or (Get-Item -LiteralPath $Cloudflared).Length -lt 20000000) {
  Write-Host "Downloading Cloudflare cloudflared (one time)..."
  $download = "https://gh-proxy.com/https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
  & curl.exe -L --fail --retry 2 --silent --show-error -o $Cloudflared $download
  if (-not (Test-Path -LiteralPath $Cloudflared) -or (Get-Item -LiteralPath $Cloudflared).Length -lt 20000000) { $download = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"; & curl.exe -L --fail --retry 2 --silent --show-error -o $Cloudflared $download }
}
$useCloudflared = (Test-Path -LiteralPath $Cloudflared) -and ((Get-Item -LiteralPath $Cloudflared).Length -ge 20000000)
if ($useCloudflared) {
  Write-Host "Starting Cloudflare Quick Tunnel..."
  $tunnelArgs = @("tunnel", "--url", "http://127.0.0.1:5174", "--no-autoupdate")
  $tunnel = Start-Process -FilePath $Cloudflared -ArgumentList $tunnelArgs -WorkingDirectory $Root -WindowStyle Hidden -RedirectStandardOutput $tunnelOut -RedirectStandardError $tunnelErr -PassThru
  $tunnelKind = "cloudflared"
} else {
  Write-Host "Starting built-in SSH tunnel via serveo.net..."
  $tunnelArgs = @("-T", "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=NUL", "-o", "ServerAliveInterval=30", "-o", "ServerAliveCountMax=3", "-o", "ExitOnForwardFailure=yes", "-R", "80:localhost:5174", "serveo.net")
  $tunnel = Start-Process -FilePath "ssh.exe" -ArgumentList $tunnelArgs -WorkingDirectory $Root -WindowStyle Hidden -RedirectStandardOutput $tunnelOut -RedirectStandardError $tunnelErr -PassThru
  $tunnelKind = "serveo"
}
$url = $null
for ($i = 0; $i -lt 60 -and -not $url; $i++) {
  Start-Sleep -Seconds 1
  $logText = @()
  if (Test-Path -LiteralPath $tunnelOut) { $logText += Get-Content -LiteralPath $tunnelOut -Raw -ErrorAction SilentlyContinue }
  if (Test-Path -LiteralPath $tunnelErr) { $logText += Get-Content -LiteralPath $tunnelErr -Raw -ErrorAction SilentlyContinue }
  $match = [regex]::Match(($logText -join "`n"), "https://(?:[a-z0-9-]+\.trycloudflare\.com|[a-z0-9-]+\.serveousercontent\.com)")
  if ($match.Success) { $url = $match.Value }
}
if (-not $url) {
  Stop-ProcessTree $tunnel.Id; Stop-ProcessTree $worker.Id; Stop-ProcessTree $web.Id; Stop-ProcessTree $api.Id
  throw "Could not obtain temporary tunnel URL. See $tunnelErr"
}
@{ password = $password; url = $url; tunnelKind = $tunnelKind; apiPid = $api.Id; webPid = $web.Id; workerPid = $worker.Id; tunnelPid = $tunnel.Id; startedAt = (Get-Date).ToString("o") } | ConvertTo-Json | Set-Content -LiteralPath $StateFile -Encoding UTF8
Write-Host ""
Write-Host "Temporary public demo is running:" -ForegroundColor Green
Write-Host "URL: $url" -ForegroundColor Cyan
Write-Host "Invite password: $password" -ForegroundColor Cyan
Write-Host "Keep this computer awake and online while others are experiencing the site."
Write-Host "Run stop-demo-tunnel.cmd to stop the demo and close the public link."
