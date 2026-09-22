param([switch]$Quiet)
$ErrorActionPreference = "SilentlyContinue"
$Root = $PSScriptRoot
$Runtime = Join-Path $env:LOCALAPPDATA "PersonalCalendar"
$PgData = Join-Path $Runtime "pgdata"
$StateFile = Join-Path $Root ".local\demo-tunnel.json"
$Cloudflared = Join-Path $Root ".local\tools\cloudflared.exe"
$stopIds = New-Object System.Collections.Generic.HashSet[int]

function Get-PortOwner([int]$Port) {
  $match = netstat -ano | Select-String ":$Port\s+.*LISTENING\s+(\d+)\s*$" | Select-Object -First 1
  if ($match) { return [int]$match.Matches[0].Groups[1].Value }
  return $null
}
function Add-ProcessId([int]$ProcessId) { if ($ProcessId -gt 0) { [void]$stopIds.Add($ProcessId) } }
function Stop-ProcessTree([int]$ProcessId) {
  $children = Get-CimInstance Win32_Process -Filter "ParentProcessId = $ProcessId" -ErrorAction SilentlyContinue
  foreach ($child in $children) { Stop-ProcessTree $child.ProcessId }
  Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
}

$state = $null
if (Test-Path -LiteralPath $StateFile) {
  try { $state = Get-Content -LiteralPath $StateFile | ConvertFrom-Json } catch {}
  Add-ProcessId ([int]$state.apiPid); Add-ProcessId ([int]$state.webPid); Add-ProcessId ([int]$state.workerPid); Add-ProcessId ([int]$state.tunnelPid)
}
foreach ($port in @(3100, 5174)) {
  $owner = Get-PortOwner $port
  if ($owner) {
    $commandLine = (Get-CimInstance Win32_Process -Filter "ProcessId = $owner").CommandLine
    if ($commandLine -like "*$Root*" -or $commandLine -like "*vite*" -or $commandLine -like "*tsx*") { Add-ProcessId $owner }
  }
}
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*$Cloudflared*" -or $_.CommandLine -like "*cloudflared*tunnel*--url*5174*" -or $_.CommandLine -like "*serveo.net*" -or $_.CommandLine -like "*serveousercontent.com*" } | ForEach-Object { Add-ProcessId $_.ProcessId }
foreach ($id in $stopIds) { Stop-ProcessTree $id }

$psql = Join-Path $Runtime "pgsql\bin\psql.exe"
if (Test-Path -LiteralPath $psql) {
  $sql1 = "delete from workspaces where owner_id = 'demo-owner';"
  & $psql -h 127.0.0.1 -U calendar -d calendar -v ON_ERROR_STOP=1 -c $sql1 *> $null
  $sql2 = "delete from public.`"user`" where id = 'demo-owner';"
  & $psql -h 127.0.0.1 -U calendar -d calendar -v ON_ERROR_STOP=1 -c $sql2 *> $null
}

$password = if ($state) { $state.password } else { $null }
if ($password) { @{ password = $password } | ConvertTo-Json | Set-Content -LiteralPath $StateFile -Encoding UTF8 } else { Remove-Item -LiteralPath $StateFile -Force -ErrorAction SilentlyContinue }
if (-not $Quiet) { Write-Host "Temporary public demo stopped." -ForegroundColor Green }
