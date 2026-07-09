#Requires -Version 7.0
<#
.SYNOPSIS
    Bootstraps the development environment for unplugin-dotnet-wasm.

.DESCRIPTION
    Installs or verifies all required tooling:
      - Node.js >= 20
      - pnpm >= 9        (via corepack)
      - .NET 10 SDK      (with wasm-tools workload)
      - pnpm dependencies
      - Playwright browsers (Chromium)

    Run from the repo root:  pwsh ./dev-env-init.ps1
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-Step { param([string]$Message) Write-Host "`n>> $Message" -ForegroundColor Cyan }
function Write-Ok   { param([string]$Message) Write-Host "   $Message" -ForegroundColor Green }
function Write-Warn { param([string]$Message) Write-Host "   $Message" -ForegroundColor Yellow }
function Write-Fail { param([string]$Message) Write-Host "   $Message" -ForegroundColor Red }

# ---------------------------------------------------------------------------
# Node.js
# ---------------------------------------------------------------------------
Write-Step "Checking Node.js"
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Fail "Node.js is not installed. Install Node >= 20 from https://nodejs.org"
    exit 1
}
$nodeVersion = (node --version) -replace '^v'
$nodeMajor = [int]($nodeVersion -split '\.')[0]
if ($nodeMajor -lt 24) {
    Write-Fail "Node $nodeVersion found — this repo requires >= 24."
    exit 1
}
Write-Ok "Node $nodeVersion"

# ---------------------------------------------------------------------------
# pnpm via corepack
# ---------------------------------------------------------------------------
Write-Step "Enabling corepack & activating pnpm"
corepack enable
if ($LASTEXITCODE -ne 0) {
    Write-Warn "corepack enable failed — falling back to npm global install"
    npm install -g pnpm
}

$pnpmVersion = (pnpm --version 2>$null)
if (-not $pnpmVersion) {
    Write-Fail "pnpm could not be activated. Install manually: npm i -g pnpm"
    exit 1
}
$pnpmMajor = [int]($pnpmVersion -split '\.')[0]
if ($pnpmMajor -lt 9) {
    Write-Warn "pnpm $pnpmVersion found — upgrading to latest"
    corepack prepare pnpm@latest --activate
}
Write-Ok "pnpm $(pnpm --version)"

# ---------------------------------------------------------------------------
# .NET SDK
# ---------------------------------------------------------------------------
Write-Step "Checking .NET SDK"
$dotnet = Get-Command dotnet -ErrorAction SilentlyContinue
if (-not $dotnet) {
    Write-Fail ".NET SDK is not installed. Install .NET 10 from https://dotnet.microsoft.com/download/dotnet/10.0"
    exit 1
}

$sdks = dotnet --list-sdks
$hasNet10 = $sdks | Where-Object { $_ -match '^10\.' }
if (-not $hasNet10) {
    Write-Fail "No .NET 10 SDK found. Install from https://dotnet.microsoft.com/download/dotnet/10.0"
    Write-Fail "Installed SDKs:`n$sdks"
    exit 1
}
Write-Ok ".NET SDK: $($hasNet10 | Select-Object -First 1)"

# ---------------------------------------------------------------------------
# .NET wasm-tools workload
# ---------------------------------------------------------------------------
Write-Step "Ensuring .NET wasm-tools workload"
$workloads = dotnet workload list
$hasWasm = $workloads | Where-Object { $_ -match 'wasm-tools' }
if (-not $hasWasm) {
    Write-Warn "Installing wasm-tools workload (may require elevation)..."
    dotnet workload install wasm-tools
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "Failed to install wasm-tools workload. Try running as admin:"
        Write-Fail "  dotnet workload install wasm-tools"
        exit 1
    }
}
Write-Ok "wasm-tools workload installed"

# ---------------------------------------------------------------------------
# Bun (optional — needed for bun bundler integration tests)
# ---------------------------------------------------------------------------
Write-Step "Checking Bun (optional)"
$bun = Get-Command bun -ErrorAction SilentlyContinue
if (-not $bun) {
    Write-Warn "Bun is not installed — bun bundler integration tests will be skipped"
    Write-Warn "Install from https://bun.sh or run: powershell -c 'irm bun.sh/install.ps1 | iex'"
} else {
    $bunVersion = (bun --version)
    $bunParts = $bunVersion -split '\.'
    $bunMinor = [int]$bunParts[1]
    if ([int]$bunParts[0] -lt 1 -or ([int]$bunParts[0] -eq 1 -and $bunMinor -lt 3)) {
        Write-Warn "Bun $bunVersion found — >= 1.3 recommended"
    } else {
        Write-Ok "Bun $bunVersion"
    }
}

# ---------------------------------------------------------------------------
# pnpm install
# ---------------------------------------------------------------------------
Write-Step "Installing npm dependencies"
pnpm install
if ($LASTEXITCODE -ne 0) {
    Write-Fail "pnpm install failed"
    exit 1
}
Write-Ok "Dependencies installed"

# ---------------------------------------------------------------------------
# Playwright browsers
# ---------------------------------------------------------------------------
Write-Step "Installing Playwright browsers (Chromium)"
pnpm --filter @dotnet-wasm-bundler/integration-tests exec playwright install chromium --with-deps
if ($LASTEXITCODE -ne 0) {
    Write-Warn "Playwright browser install failed — browser E2E tests won't work"
} else {
    Write-Ok "Playwright Chromium installed"
}

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
Write-Host "`n-------------------------------------------" -ForegroundColor Cyan
Write-Host " Dev environment ready." -ForegroundColor Green
Write-Host " Build the plugin:  pnpm build:plugin" -ForegroundColor White
Write-Host " Run tests:         pnpm test" -ForegroundColor White
Write-Host "-------------------------------------------`n" -ForegroundColor Cyan
