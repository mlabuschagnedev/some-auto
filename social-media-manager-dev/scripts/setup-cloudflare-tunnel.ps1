param(
    [Parameter(Mandatory = $true)]
    [string]$Hostname,
    [string]$TunnelName = "social-media-manager",
    [string]$OriginUrl = "http://127.0.0.1:5000",
    [string]$AppStartFile = "start.py"
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

function Ensure-CloudflareLogin {
    param(
        [string]$CloudflaredExe,
        [string]$CertPath
    )

    if (Test-Path $CertPath) {
        return
    }

    Write-Host "No Cloudflare cert found. Starting one-time login flow..."
    & $CloudflaredExe tunnel login

    if (-not (Test-Path $CertPath)) {
        throw "Cloudflare login did not complete. Re-run this script after approving login in your browser."
    }
}

function Upsert-PublicBaseUrl {
    param(
        [string]$StartFilePath,
        [string]$PublicBaseUrl
    )

    if (-not (Test-Path $StartFilePath)) {
        return
    }

    $content = Get-Content -Path $StartFilePath -Raw
    $updated = [regex]::Replace(
        $content,
        'os\.environ\.setdefault\("PUBLIC_BASE_URL",\s*"[^"]*"\)',
        "os.environ.setdefault(`"PUBLIC_BASE_URL`", `"$PublicBaseUrl`")"
    )

    if ($updated -ne $content) {
        Set-Content -Path $StartFilePath -Value $updated -Encoding ascii
        Write-Host "Updated PUBLIC_BASE_URL in $StartFilePath"
    }
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$cloudflaredExe = Get-CloudflaredExe
$cloudflaredDir = Join-Path $HOME ".cloudflared"
$certPath = Join-Path $cloudflaredDir "cert.pem"

Ensure-CloudflareLogin -CloudflaredExe $cloudflaredExe -CertPath $certPath

$existingTunnelsJson = & $cloudflaredExe tunnel list -o json | Out-String
$existingTunnels = $existingTunnelsJson | ConvertFrom-Json
$existingTunnel = $existingTunnels | Where-Object { $_.name -eq $TunnelName } | Select-Object -First 1

if ($existingTunnel) {
    $tunnelId = $existingTunnel.id
    Write-Host "Using existing tunnel '$TunnelName' ($tunnelId)"
}
else {
    Write-Host "Creating tunnel '$TunnelName'..."
    $createdJson = & $cloudflaredExe tunnel create -o json $TunnelName | Out-String
    $createdTunnel = $createdJson | ConvertFrom-Json
    $tunnelId = $createdTunnel.id
    Write-Host "Created tunnel '$TunnelName' ($tunnelId)"
}

if (-not $tunnelId) {
    throw "Tunnel ID could not be resolved."
}

$credentialsPath = Join-Path $cloudflaredDir "$tunnelId.json"
if (-not (Test-Path $credentialsPath)) {
    throw "Tunnel credentials file not found at $credentialsPath"
}

Write-Host "Creating/updating DNS route: $Hostname -> $TunnelName"
& $cloudflaredExe tunnel route dns --overwrite-dns $TunnelName $Hostname | Out-Host

$configDir = Join-Path $repoRoot "runtime\cloudflared"
New-Item -Path $configDir -ItemType Directory -Force | Out-Null
$configPath = Join-Path $configDir "config.yml"
$credentialsPathYaml = $credentialsPath -replace '\\', '/'

$configLines = @(
    "tunnel: $tunnelId",
    "credentials-file: '$credentialsPathYaml'",
    "ingress:",
    "  - hostname: $Hostname",
    "    service: $OriginUrl",
    "  - service: http_status:404"
)
Set-Content -Path $configPath -Value ($configLines -join "`n") -Encoding ascii

$publicBaseUrl = "https://$Hostname"
$appStartPath = Join-Path $repoRoot $AppStartFile
Upsert-PublicBaseUrl -StartFilePath $appStartPath -PublicBaseUrl $publicBaseUrl

Write-Host ""
Write-Host "Permanent tunnel setup complete."
Write-Host "Public URL: $publicBaseUrl"
Write-Host "Config file: $configPath"
Write-Host "Run tunnel with:"
Write-Host "  powershell -ExecutionPolicy Bypass -File `"$repoRoot\scripts\run-cloudflare-tunnel.ps1`" -TunnelName `"$TunnelName`""
