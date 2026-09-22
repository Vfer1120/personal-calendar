param(
  [Parameter(Mandatory=$true)][string]$SupabaseDirectUrl,
  [Parameter(Mandatory=$true)][string]$MinioEndpoint,
  [Parameter(Mandatory=$true)][string]$MinioAccessKey,
  [Parameter(Mandatory=$true)][string]$MinioSecretKey,
  [Parameter(Mandatory=$true)][string]$SupabaseEndpoint,
  [Parameter(Mandatory=$true)][string]$SupabaseAccessKey,
  [Parameter(Mandatory=$true)][string]$SupabaseSecretKey,
  [string]$Bucket = "calendar-attachments",
  [string]$LocalDatabaseUrl = $env:DATABASE_URL
)
$ErrorActionPreference = "Stop"
if (-not $LocalDatabaseUrl) { throw "DATABASE_URL is required" }
$env:AWS_ACCESS_KEY_ID = $MinioAccessKey
$env:AWS_SECRET_ACCESS_KEY = $MinioSecretKey
$dump = Join-Path $env:TEMP "calendar-data.sql"
& pg_dump $LocalDatabaseUrl --no-owner --no-acl --data-only `
  --table=user --table=account --table=workspaces --table=calendars `
  --table=items --table=item_tags --table=tags --table=reminder_rules `
  --table=recurrence_exceptions --table=attachments --table=deliveries `
  --table=app_settings --table=schedule_periods --table=ai_usage `
  --file=$dump
if ($LASTEXITCODE -ne 0) { throw "pg_dump failed" }
& psql $SupabaseDirectUrl -v ON_ERROR_STOP=1 -f $dump
if ($LASTEXITCODE -ne 0) { throw "Supabase import failed" }
$download = Join-Path $env:TEMP "calendar-attachments-migration"
New-Item -ItemType Directory -Force -Path $download | Out-Null
& aws s3 sync "s3://$Bucket/attachments" $download --endpoint-url $MinioEndpoint --region us-east-1
if ($LASTEXITCODE -ne 0) { throw "MinIO attachment download failed" }
$env:AWS_ACCESS_KEY_ID = $SupabaseAccessKey
$env:AWS_SECRET_ACCESS_KEY = $SupabaseSecretKey
& aws s3 sync $download "s3://$Bucket/attachments" --endpoint-url $SupabaseEndpoint --region us-east-1
if ($LASTEXITCODE -ne 0) { throw "Supabase attachment upload failed" }
Write-Host "Migration finished. Verify attachment previews and remove local session/passkey rows if they were imported."