# Applies category_monthly_sellout migration to remote Supabase.
# Usage:
#   $env:SUPABASE_DB_PASSWORD = "your-db-password"
#   .\scripts\apply-category-monthly-migration.ps1
# Or run without env var — you will be prompted once.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$sqlFile = Join-Path $root "supabase\run-category-monthly-sellout.sql"
$projectRef = "niaexyzfpuzidgrzjhlo"

if (-not (Test-Path $sqlFile)) {
  Write-Error "SQL file not found: $sqlFile"
}

$password = $env:SUPABASE_DB_PASSWORD
if (-not $password) {
  Write-Host "Database password: Supabase Dashboard -> Project Settings -> Database -> Database password"
  $secure = Read-Host "Enter database password" -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  $password = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
}

$encodedPassword = [uri]::EscapeDataString($password)
$dbUrl = "postgresql://postgres:${encodedPassword}@db.${projectRef}.supabase.co:5432/postgres"

Write-Host "Running migration on project $projectRef ..."
Set-Location $root
npx supabase db query --file $sqlFile --db-url $dbUrl --output table --agent no
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Verifying table exists ..."
$checkSql = "select count(*) as table_ok from information_schema.tables where table_schema = 'public' and table_name = 'category_monthly_sellout';"
npx supabase db query $checkSql --db-url $dbUrl --output table --agent no
Write-Host "Done. Re-upload Flipkart master from Upload Center."
