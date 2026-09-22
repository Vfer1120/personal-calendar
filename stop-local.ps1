$ErrorActionPreference = "SilentlyContinue"
$Root = $PSScriptRoot
$Runtime = Join-Path $env:LOCALAPPDATA "PersonalCalendar"
$PgCtl = Join-Path $Runtime "pgsql\bin\pg_ctl.exe"
$PgData = Join-Path $Runtime "pgdata"
$PidFile = Join-Path $Root ".local\pids.json"
$processIds = @()

if (Test-Path -LiteralPath $PidFile) {
  $pids = Get-Content -LiteralPath $PidFile | ConvertFrom-Json
  foreach ($name in @("web", "worker", "api")) {
    if ($pids.$name) { $processIds += [int]$pids.$name }
  }
}

foreach ($port in @(5173, 3000)) {
  $matches = netstat -ano | Select-String ":$port\s+.*LISTENING\s+(\d+)"
  foreach ($match in $matches) { $processIds += [int]$match.Matches[0].Groups[1].Value }
}

foreach ($id in ($processIds | Sort-Object -Unique)) {
  Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
}
Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
& $PgCtl -D $PgData stop -m fast
Write-Host "Personal Calendar stopped." -ForegroundColor Green