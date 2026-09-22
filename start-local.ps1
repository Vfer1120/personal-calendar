$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$Runtime = Join-Path $env:LOCALAPPDATA "PersonalCalendar"
$Node = Join-Path $Runtime "node\node.exe"
$PgCtl = Join-Path $Runtime "pgsql\bin\pg_ctl.exe"
$PgReady = Join-Path $Runtime "pgsql\bin\pg_isready.exe"
$PgData = Join-Path $Runtime "pgdata"
$PgLog = Join-Path $Runtime "postgres.log"
$PidFile = Join-Path $Root ".local\pids.json"
$LogDir = Join-Path $Root ".local\logs"

function Get-ListeningProcessIds([int]$Port) {
  $matches = netstat -ano | Select-String ":$Port\s+.*LISTENING\s+(\d+)\s*$"
  return @($matches | ForEach-Object { [int]$_.Matches[0].Groups[1].Value } | Sort-Object -Unique)
}
function Test-Port([int]$Port) { return (Get-ListeningProcessIds $Port).Count -gt 0 }
function Get-ProcessCommandLine([int]$ProcessId) {
  try { return (Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction Stop).CommandLine } catch { return $null }
}
function Get-LanIPv4Address {
  try {
    $addresses = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop | Where-Object { $_.IPAddress -notmatch "^(127\.|169\.254\.)" -and ($_.IPAddress -match "^192\.168\." -or $_.IPAddress -match "^10\." -or $_.IPAddress -match "^172\.(1[6-9]|2[0-9]|3[01])\.") } | Sort-Object InterfaceMetric
    $wifi = $addresses | Where-Object { $_.InterfaceAlias -match "WLAN|Wi-Fi|无线" } | Select-Object -First 1
    $selected = if ($wifi) { $wifi } else { $addresses | Select-Object -First 1 }
    if ($selected) { return $selected.IPAddress }
  } catch {}
  $match = [regex]::Match((ipconfig | Out-String), "IPv4[^\r\n]*:\s*([0-9.]+)")
  if ($match.Success) { return $match.Groups[1].Value }
  return $null
}
function Wait-Port([int]$Port, [int]$Seconds = 20) {
  for ($i = 0; $i -lt ($Seconds * 4); $i++) { if (Test-Port $Port) { return $true }; Start-Sleep -Milliseconds 250 }
  return $false
}
function Wait-Http([string]$Url, [int]$Seconds = 30) {
  for ($i = 0; $i -lt $Seconds; $i++) {
    try { $response = Invoke-WebRequest -UseBasicParsing $Url -TimeoutSec 2; if ($response.StatusCode -eq 200) { return $true } } catch {}
    Start-Sleep -Seconds 1
  }
  return $false
}
function Stop-CalendarProcesses([string]$Marker) {
  $processes = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*$Marker*" }
  foreach ($process in $processes) { Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue }
}
function Stop-PortOwnerIfCalendar([int]$Port) {
  foreach ($processId in Get-ListeningProcessIds $Port) {
    $commandLine = Get-ProcessCommandLine $processId
    if ($commandLine -and ($commandLine -like "*$Root*" -or $commandLine -like "*apps/api/src/index.ts*" -or $commandLine -like "*tsx*" -or $commandLine -like "*vite*")) {
      Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    }
  }
}
function Start-HiddenNode([string[]]$Arguments, [string]$WorkingDirectory, [string]$Name) {
  $stdout = Join-Path $LogDir "$Name.out.log"
  $stderr = Join-Path $LogDir "$Name.err.log"
  return Start-Process -FilePath $Node -ArgumentList $Arguments -WorkingDirectory $WorkingDirectory -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
}
function Assert-NewPortOwner([int]$Port, [datetime]$NotBefore, [string]$Label) {
  $owners = @(Get-ListeningProcessIds $Port)
  if ($owners.Count -eq 0) { throw "$Label did not bind port $Port" }
  foreach ($processId in $owners) {
    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if (-not $process -or $process.StartTime -lt $NotBefore.AddSeconds(-2)) { throw "$Label port $Port is still owned by an old process (PID $processId)" }
    $commandLine = Get-ProcessCommandLine $processId
    if ($commandLine -and $commandLine -notlike "*$Root*" -and $commandLine -notlike "*apps/api/src/index.ts*" -and $commandLine -notlike "*vite*") {
      throw "$Label port $Port is owned by an unexpected process: PID $processId"
    }
  }
}

if (-not (Test-Path -LiteralPath $Node)) { throw "Runtime not found: $Runtime" }
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
if (-not (Test-Path -LiteralPath (Join-Path $Root ".env"))) { Copy-Item -LiteralPath (Join-Path $Root ".env.example") -Destination (Join-Path $Root ".env") }
$LanIP = Get-LanIPv4Address
$LanOrigin = if ($LanIP) { "http://${LanIP}:5173" } else { $null }
$env:CORS_ORIGIN = if ($LanOrigin) { "http://localhost:5173,$LanOrigin" } else { "http://localhost:5173" }
if (-not (Test-Port 5432)) { Write-Host "Starting database..."; & $PgCtl -D $PgData -l $PgLog -o '"-p 5432 -h 127.0.0.1"' start }
for ($i = 0; $i -lt 30; $i++) { & $PgReady -h 127.0.0.1 -p 5432 *> $null; if ($LASTEXITCODE -eq 0) { break }; Start-Sleep -Seconds 1 }
& $PgReady -h 127.0.0.1 -p 5432 *> $null; if ($LASTEXITCODE -ne 0) { throw "Database failed to start. See $PgLog" }

$StudentMigration = Join-Path $Root (Join-Path "packages" (Join-Path "db" (Join-Path "migrations" "0002_student_core.sql")))
$Psql = Join-Path $Runtime "pgsql\\bin\\psql.exe"
if ((Test-Path -LiteralPath $StudentMigration) -and (Test-Path -LiteralPath $Psql)) {
  $previousPgOptions = $env:PGOPTIONS
  $env:PGOPTIONS = "-c client_min_messages=warning"
  & $Psql -h 127.0.0.1 -p 5432 -U calendar -d calendar -v ON_ERROR_STOP=1 -f $StudentMigration *> $null
  $migrationExit = $LASTEXITCODE
  $env:PGOPTIONS = $previousPgOptions
  if ($migrationExit -ne 0) { throw "Database migration failed: $StudentMigration" }
}

$AiUsageMigration = Join-Path $Root (Join-Path "packages" (Join-Path "db" (Join-Path "migrations" "0003_ai_usage.sql")))
if ((Test-Path -LiteralPath $AiUsageMigration) -and (Test-Path -LiteralPath $Psql)) {
  $previousPgOptions = $env:PGOPTIONS
  $env:PGOPTIONS = "-c client_min_messages=warning"
  & $Psql -h 127.0.0.1 -p 5432 -U calendar -d calendar -v ON_ERROR_STOP=1 -f $AiUsageMigration *> $null
  $migrationExit = $LASTEXITCODE
  $env:PGOPTIONS = $previousPgOptions
  if ($migrationExit -ne 0) { throw "AI usage migration failed: $AiUsageMigration" }
}

$CourseMigration = Join-Path $Root (Join-Path "packages" (Join-Path "db" (Join-Path "migrations" "0004_course_timetable.sql")))
if ((Test-Path -LiteralPath $CourseMigration) -and (Test-Path -LiteralPath $Psql)) {
  $previousPgOptions = $env:PGOPTIONS
  $env:PGOPTIONS = "-c client_min_messages=warning"
  & $Psql -h 127.0.0.1 -p 5432 -U calendar -d calendar -v ON_ERROR_STOP=1 -f $CourseMigration *> $null
  $migrationExit = $LASTEXITCODE
  $env:PGOPTIONS = $previousPgOptions
  if ($migrationExit -ne 0) { throw "Course timetable migration failed: $CourseMigration" }
}

$CourseSlotsMigration = Join-Path $Root (Join-Path "packages" (Join-Path "db" (Join-Path "migrations" "0005_course_slots.sql")))
if ((Test-Path -LiteralPath $CourseSlotsMigration) -and (Test-Path -LiteralPath $Psql)) {
  $previousPgOptions = $env:PGOPTIONS
  $env:PGOPTIONS = "-c client_min_messages=warning"
  & $Psql -h 127.0.0.1 -p 5432 -U calendar -d calendar -v ON_ERROR_STOP=1 -f $CourseSlotsMigration *> $null
  $migrationExit = $LASTEXITCODE
  $env:PGOPTIONS = $previousPgOptions
  if ($migrationExit -ne 0) { throw "Course slots migration failed: $CourseSlotsMigration" }
}

$CourseDateRangeMigration = Join-Path $Root (Join-Path "packages" (Join-Path "db" (Join-Path "migrations" "0006_course_date_range.sql")))
if ((Test-Path -LiteralPath $CourseDateRangeMigration) -and (Test-Path -LiteralPath $Psql)) {
  $previousPgOptions = $env:PGOPTIONS
  $env:PGOPTIONS = "-c client_min_messages=warning"
  & $Psql -h 127.0.0.1 -p 5432 -U calendar -d calendar -v ON_ERROR_STOP=1 -f $CourseDateRangeMigration *> $null
  $migrationExit = $LASTEXITCODE
  $env:PGOPTIONS = $previousPgOptions
  if ($migrationExit -ne 0) { throw "Course date range migration failed: $CourseDateRangeMigration" }
}
$existing = if (Test-Path -LiteralPath $PidFile) { Get-Content -LiteralPath $PidFile | ConvertFrom-Json } else { $null }
Write-Host "Stopping old API and worker..."
Stop-CalendarProcesses "apps/api/src/index.ts"
Stop-CalendarProcesses "apps/worker/src/index.ts"
Stop-PortOwnerIfCalendar 3000
for ($i = 0; $i -lt 20 -and (Test-Port 3000); $i++) { Start-Sleep -Milliseconds 250 }
if (Test-Port 3000) {
  $owner = (Get-ListeningProcessIds 3000 | Select-Object -First 1)
  $commandLine = Get-ProcessCommandLine $owner
  throw "Port 3000 is occupied and could not be safely replaced. PID $owner, command: $commandLine"
}

Write-Host "Starting latest API..."
$apiStartedAt = Get-Date
$api = Start-HiddenNode @((Join-Path $Root "apps\api\node_modules\tsx\dist\cli.mjs"), "apps/api/src/index.ts") $Root "api"
if (-not (Wait-Port 3000 60)) { throw "API failed to bind port 3000. See $(Join-Path $LogDir 'api.err.log')" }
Assert-NewPortOwner 3000 $apiStartedAt "API"
if (-not (Wait-Http "http://127.0.0.1:3000/health" 30)) { throw "API health check failed. See $(Join-Path $LogDir 'api.err.log')" }

Write-Host "Stopping old web app..."
Stop-PortOwnerIfCalendar 5173
for ($i = 0; $i -lt 20 -and (Test-Port 5173); $i++) { Start-Sleep -Milliseconds 250 }
if (Test-Port 5173) {
  $owner = (Get-ListeningProcessIds 5173 | Select-Object -First 1)
  $commandLine = Get-ProcessCommandLine $owner
  throw "Port 5173 is occupied and could not be safely replaced. PID $owner, command: $commandLine"
}
Write-Host "Starting web app..."
$webStartedAt = Get-Date
$web = Start-HiddenNode @((Join-Path $Root "apps\web\node_modules\vite\bin\vite.js"), "--host", "0.0.0.0", "--port", "5173") (Join-Path $Root "apps\web") "web"
if (-not (Wait-Port 5173 20)) { throw "Web failed to bind port 5173. See $(Join-Path $LogDir 'web.err.log')" }
Assert-NewPortOwner 5173 $webStartedAt "Web"
$worker = Start-HiddenNode @((Join-Path $Root "apps\worker\node_modules\tsx\dist\cli.mjs"), "apps/worker/src/index.ts") $Root "worker"
if (-not (Wait-Http "http://127.0.0.1:5173" 30)) { throw "Web app failed to start. See $(Join-Path $LogDir 'web.err.log')" }

@{ api = $api.Id; worker = $worker.Id; web = if ($web) { $web.Id } else { $null }; startedAt = (Get-Date).ToString("o") } | ConvertTo-Json | Set-Content -LiteralPath $PidFile -Encoding UTF8
Write-Host ""; Write-Host "Personal Calendar is running: http://127.0.0.1:5173" -ForegroundColor Green; if ($LanOrigin) { Write-Host "Other devices on the same Wi-Fi: $LanOrigin" -ForegroundColor Green } else { Write-Host "LAN address not detected; use ipconfig to find this computer IPv4 address." -ForegroundColor Yellow }; Write-Host "Login email: owner@local.test"
Start-Process "http://127.0.0.1:5173"