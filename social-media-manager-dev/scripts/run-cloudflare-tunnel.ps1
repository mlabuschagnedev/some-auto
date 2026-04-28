param(
    [string]$TunnelName = "social-media-manager",
    [string]$ConfigPath = ""
)

$ErrorActionPreference = "Stop"

function Get-CloudflaredExe {
    $defaultPath = Join-Path ${env:ProgramFiles(x86)} "cloudflared\cloudflared.exe"
    if (Test-Path $defaultPath) {
        return $defaultPath
    }

    $cmd = Get-Command cloudflared -ErrorAction SilentlyContinue
    if ($cmd) {
        return $cmd.Source
    }

    throw "cloudflared is not installed. Install it first (winget install Cloudflare.cloudflared)."
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$cloudflaredExe = Get-CloudflaredExe

if (-not $ConfigPath) {
    $ConfigPath = Join-Path $repoRoot "runtime\cloudflared\config.yml"
}

if (-not (Test-Path $ConfigPath)) {
    throw "Config file not found: $ConfigPath`nRun setup-cloudflare-tunnel.ps1 first."
}

Write-Host "Running tunnel '$TunnelName' with config '$ConfigPath'..."
& $cloudflaredExe tunnel --config $ConfigPath run $TunnelName
