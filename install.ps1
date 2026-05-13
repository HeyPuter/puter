#!/usr/bin/env pwsh
# Self-hosted Puter — one-shot installer (PowerShell port of install.sh).
#
# Usage (interactive):
#   .\install.ps1
#
# Usage (one-liner, like curl|sh):
#   irm https://raw.githubusercontent.com/HeyPuter/puter/main/install.ps1 | iex
#   (when piped through iex, params can't be passed; use env vars below)
#
# What this does, in order:
#   1. Checks that docker (with the compose plugin) exists.
#   2. Creates ./puter-selfhosted/ (override with $env:PUTER_DIR).
#   3. Downloads docker-compose.yml + nginx.conf from the OSS repo.
#   4. Generates fresh secrets and writes .env + puter/config/config.json.
#   5. Runs `docker compose up -d` and prints how to find the admin password.
#
# Re-running in an already-initialised directory is a no-op for config
# (it won't clobber existing .env / config.json) and just refreshes the
# compose file + brings the stack up. Set PUTER_FORCE=1 to overwrite.
#
# Tunable env vars (or pass as -Parameters when running the file directly):
#   PUTER_DIR     install directory                       (default: ./puter-selfhosted)
#   PUTER_URL     base URL to fetch docker-compose.yml    (default: GitHub raw, main branch)
#   PUTER_DOMAIN  domain Puter will serve on              (default: puter.localhost)
#   PUTER_PORT    HTTP port for nginx                     (default: 80)
#   PUTER_FORCE   set to 1 to overwrite existing .env / config.json

[CmdletBinding()]
param(
    [string]$PuterDir    = $(if ($env:PUTER_DIR)    { $env:PUTER_DIR }         else { 'puter-selfhosted' }),
    [string]$PuterUrl    = $(if ($env:PUTER_URL)    { $env:PUTER_URL }         else { 'https://raw.githubusercontent.com/HeyPuter/puter/main' }),
    [string]$PuterDomain = $(if ($env:PUTER_DOMAIN) { $env:PUTER_DOMAIN }      else { 'puter.localhost' }),
    [int]   $PuterPort   = $(if ($env:PUTER_PORT)   { [int]$env:PUTER_PORT }   else { 80 }),
    [switch]$Force       = $($env:PUTER_FORCE -eq '1')
)

$ErrorActionPreference = 'Stop'

function Write-Log  { param($Msg) Write-Host "[puter-install] $Msg" -ForegroundColor Cyan }
function Write-Warn { param($Msg) Write-Host "[puter-install] $Msg" -ForegroundColor Yellow }
function Die        { param($Msg) Write-Host "[puter-install] $Msg" -ForegroundColor Red; exit 1 }

function Test-Command {
    param([string]$Name)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        Die "missing required command: $Name"
    }
}

function New-HexSecret {
    param([int]$Bytes)
    $buf = New-Object byte[] $Bytes
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($buf) } finally { $rng.Dispose() }
    # BitConverter is portable across PS 5.1 and 7+ (ToHexString is 7+ only).
    return [System.BitConverter]::ToString($buf).Replace('-', '').ToLowerInvariant()
}

function Write-Utf8NoBomLF {
    param([string]$Path, [string]$Content)
    $full = if ([System.IO.Path]::IsPathRooted($Path)) { $Path } else { Join-Path (Get-Location) $Path }
    $lf   = $Content -replace "`r`n", "`n"
    [System.IO.File]::WriteAllText($full, $lf, (New-Object System.Text.UTF8Encoding $false))
}

# ── Step 1: dependency check ────────────────────────────────────────
Write-Log 'checking dependencies'
Test-Command docker
# curl + openssl aren't required on Windows; PowerShell + .NET cover both.

$null = & docker compose version 2>&1
if ($LASTEXITCODE -ne 0) {
    Die "docker compose plugin not found — install Docker Desktop (or enable the v2 compose plugin)"
}

# ── Step 2: install dir ─────────────────────────────────────────────
$null = New-Item -ItemType Directory -Force -Path $PuterDir
Set-Location $PuterDir
$null = New-Item -ItemType Directory -Force -Path 'puter/config', 'puter/data', 'puter/tls'
Write-Log "install dir: $((Get-Location).Path)"

# ── Step 3: docker-compose.yml + nginx config ──────────────────────
Write-Log "downloading docker-compose.yml from $PuterUrl"
try {
    Invoke-WebRequest -Uri "$PuterUrl/docker-compose.yml" -OutFile 'docker-compose.yml' -UseBasicParsing
} catch {
    Die "could not fetch $PuterUrl/docker-compose.yml — $_"
}

Write-Log "downloading nginx/nginx.conf from $PuterUrl"
$null = New-Item -ItemType Directory -Force -Path 'nginx'
# If the path was previously auto-created as a directory by a failed
# `compose up`, remove it so we can write the file there.
if (Test-Path 'nginx/nginx.conf' -PathType Container) {
    Remove-Item 'nginx/nginx.conf' -Recurse -Force
}
try {
    Invoke-WebRequest -Uri "$PuterUrl/nginx/nginx.conf" -OutFile 'nginx/nginx.conf' -UseBasicParsing
} catch {
    Die "could not fetch $PuterUrl/nginx/nginx.conf — $_"
}

# ── Step 4: secrets, .env, config.json ──────────────────────────────
$writeConfig = $true
if ((Test-Path '.env') -and (Test-Path 'puter/config/config.json') -and -not $Force) {
    Write-Log ".env + config.json already present — keeping existing secrets (PUTER_FORCE=1 or -Force to overwrite)"
    $writeConfig = $false
}

if ($writeConfig) {
    Write-Log 'generating secrets'
    $mariadbRootPw = New-HexSecret 32
    $mariadbPw     = New-HexSecret 32
    $s3SecretKey   = New-HexSecret 32
    $jwtSecret     = New-HexSecret 64
    $urlSigSecret  = New-HexSecret 64

    $envContent = @"
HTTP_PORT=$PuterPort
# HTTPS_PORT=443     # uncomment after enabling TLS (see doc/selfhosting/full-stack.md)

MARIADB_ROOT_PASSWORD=$mariadbRootPw
MARIADB_DATABASE=puter
MARIADB_USER=puter
MARIADB_PASSWORD=$mariadbPw

S3_ACCESS_KEY=puter
S3_SECRET_KEY=$s3SecretKey
S3_BUCKET=puter-local
"@
    Write-Utf8NoBomLF -Path '.env' -Content $envContent

    Write-Log 'writing puter/config/config.json'
    $config = [ordered]@{
        domain                         = $PuterDomain
        protocol                       = 'http'
        pub_port                       = $PuterPort
        env                            = 'prod'
        static_hosting_domain          = "site.$PuterDomain"
        static_hosting_domain_alt      = "host.$PuterDomain"
        private_app_hosting_domain     = "app.$PuterDomain"
        private_app_hosting_domain_alt = "dev.$PuterDomain"
        jwt_secret                     = $jwtSecret
        url_signature_secret           = $urlSigSecret
        database = [ordered]@{
            engine         = 'mysql'
            host           = 'mariadb'
            port           = 3306
            user           = 'puter'
            password       = $mariadbPw
            database       = 'puter'
            migrationPaths = @('/opt/puter/dist/src/backend/clients/database/migrations/mysql')
        }
        redis = [ordered]@{
            startupNodes = @(
                [ordered]@{ host = 'valkey'; port = 6379 }
            )
            tls = $false
        }
        dynamo = [ordered]@{
            endpoint        = 'http://dynamo:8000'
            bootstrapTables = $true
            aws = [ordered]@{
                access_key = 'fake'
                secret_key = 'fake'
                region     = 'us-east-1'
            }
        }
        s3 = [ordered]@{
            s3Config = [ordered]@{
                endpoint        = 'http://s3:9000'
                publicEndpoint  = "http://s3.$PuterDomain"
                accessKeyId     = 'puter'
                secretAccessKey = $s3SecretKey
                region          = 'us-east-1'
                forcePathStyle  = $true
            }
        }
        s3_bucket = 'puter-local'
        s3_region = 'us-east-1'
        providers = [ordered]@{
            ollama = [ordered]@{ enabled = $false }
        }
        trust_proxy = 1
    }
    $configJson = $config | ConvertTo-Json -Depth 10
    Write-Utf8NoBomLF -Path 'puter/config/config.json' -Content $configJson
}

# ── Step 5: bring it up ─────────────────────────────────────────────
Write-Log 'docker compose up -d'
& docker compose up -d
if ($LASTEXITCODE -ne 0) { Die 'docker compose up failed' }

Write-Log ''
Write-Log 'stack starting. first boot takes ~30s while MariaDB initialises.'
Write-Log 'follow puter logs:'
Write-Log "    cd $PuterDir; docker compose logs -f puter"
Write-Log ''
Write-Log "open http://${PuterDomain}:${PuterPort} once the puter container is healthy."
Write-Log 'first-boot admin password is logged once — grab it with:'
Write-Log "    cd $PuterDir; docker compose logs puter | Select-String password"