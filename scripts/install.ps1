[CmdletBinding()]
param(
    [string]$Version = "",
    [string]$Prefix = "",
    [switch]$DeferStart
)

$ErrorActionPreference = "Stop"
$DownloadBase = "https://github.com/zhuxian89/idea-ai-agent/releases/download"
# The checksum travels with the archive, so a redirect to plain HTTP would let a tampered
# archive arrive with a matching checksum. Only an explicit local override (used by the
# tests) may use another base URL or scheme.
$AllowInsecure = $false
if ($env:LOCAL_AI_AGENT_DOWNLOAD_BASE_URL) {
    $DownloadBase = $env:LOCAL_AI_AGENT_DOWNLOAD_BASE_URL.TrimEnd('/')
    $AllowInsecure = $true
}

function Get-HttpsContent {
    param([string]$Uri, [string]$OutFile)
    # Follow redirects by hand so every hop can be checked; a response that is not HTTPS is refused.
    $current = $Uri
    for ($hop = 0; $hop -lt 5; $hop++) {
        if (-not $AllowInsecure -and $current -notmatch '^https://') {
            throw "Refusing a non-HTTPS download location: $current"
        }
        $parameters = @{ Uri = $current; UseBasicParsing = $true; MaximumRedirection = 0; ErrorAction = 'Stop' }
        if ($OutFile) { $parameters.OutFile = $OutFile }
        try {
            $response = Invoke-WebRequest @parameters
            return $response
        } catch {
            $status = $_.Exception.Response.StatusCode.value__
            $location = $_.Exception.Response.Headers.Location
            if ($status -in 301, 302, 303, 307, 308 -and $location) {
                $current = ([System.Uri]::new([System.Uri]$current, $location)).AbsoluteUri
                continue
            }
            throw
        }
    }
    throw "Too many redirects while downloading $Uri"
}

$Architecture = $env:PROCESSOR_ARCHITEW6432
if (-not $Architecture) { $Architecture = $env:PROCESSOR_ARCHITECTURE }
switch ($Architecture) {
    "AMD64" { $Arch = "amd64" }
    "ARM64" { $Arch = "arm64" }
    default { throw "Supported architectures: x64 and ARM64. Detected: $Architecture" }
}

if (-not $Version) {
    $Version = ((Get-HttpsContent -Uri "https://raw.githubusercontent.com/zhuxian89/idea-ai-agent/main/scripts/standalone/version.txt").Content).Trim()
}
if ($Version -cnotmatch '^[0-9][0-9A-Za-z.+-]*$') {
    throw "Invalid standalone version: $Version"
}

$Bundle = "local-ai-agent-$Version-windows-$Arch"
$Archive = "$Bundle.zip"
$Url = "$DownloadBase/standalone-v$Version/$Archive"
$WorkDir = Join-Path ([System.IO.Path]::GetTempPath()) ("local-ai-agent-install-" + [System.IO.Path]::GetRandomFileName())
New-Item -ItemType Directory -Path $WorkDir | Out-Null

try {
    Write-Host "Installing Local AI Agent $Version (windows/$Arch)"
    Write-Host "Downloading $Url"
    $ArchivePath = Join-Path $WorkDir $Archive
    Get-HttpsContent -Uri $Url -OutFile $ArchivePath | Out-Null
    $ChecksumPath = Join-Path $WorkDir "checksum"
    Get-HttpsContent -Uri "$Url.sha256" -OutFile $ChecksumPath | Out-Null
    $Checksum = Get-Content -LiteralPath $ChecksumPath -Raw
    $Expected = ($Checksum.Trim() -split '\s+')[0]
    $Actual = (Get-FileHash -Path $ArchivePath -Algorithm SHA256).Hash
    if ($Expected -ine $Actual) {
        throw "SHA-256 verification failed; installation was not changed."
    }

    Expand-Archive -Path $ArchivePath -DestinationPath $WorkDir
    $PowerShell = (Get-Process -Id $PID).Path
    $InstallArguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $WorkDir "$Bundle/install.ps1"))
    if ($Prefix) { $InstallArguments += @('-Prefix', $Prefix) }
    if ($DeferStart) { $InstallArguments += '-DeferStart' }
    & $PowerShell @InstallArguments
    if ($LASTEXITCODE -ne 0) { throw "Local AI Agent installation failed." }
} finally {
    Remove-Item -LiteralPath $WorkDir -Recurse -Force
}
