param([Parameter(Mandatory=$true)][string]$Zip, [Parameter(Mandatory=$true)][string]$Version)
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.ToString() -notlike '5.1.*') { throw 'Windows PowerShell 5.1 required.' }

$Work = Join-Path ([IO.Path]::GetTempPath()) ('standalone-self-update-' + [IO.Path]::GetRandomFileName())
$Root = Join-Path $Work 'http'
$VersionDir = Join-Path $Root "standalone-v$Version"
$Target = Join-Path $Work 'installed'
$env:IDE_AGENT_REMOTE_HOST_DIR = Join-Path $Work 'remote'
$env:MINDFS_RELAY_BASE_URL = 'http://127.0.0.1:1'
Remove-Item Env:IDE_AGENT_DATA_DIR, Env:IDE_AGENT_TOKEN, Env:MINDFS_STATIC_DIR -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $VersionDir | Out-Null
$Executable = Join-Path $Target 'local-ai-agent.exe'
$Log = Join-Path $env:IDE_AGENT_REMOTE_HOST_DIR 'logs\update.log'
try {
    $Name = "local-ai-agent-$Version-windows-amd64.zip"
    Copy-Item -LiteralPath $Zip -Destination (Join-Path $VersionDir $Name)
    Copy-Item -LiteralPath "$Zip.sha256" -Destination (Join-Path $VersionDir "$Name.sha256")
    Copy-Item -LiteralPath "$PSScriptRoot/../install.ps1" -Destination $Root
    Expand-Archive -LiteralPath $Zip -DestinationPath (Join-Path $Work 'package')
    $Bundle = Join-Path $Work ("package/" + [IO.Path]::GetFileNameWithoutExtension($Name))
    $OldVersion = "$Version-standalone.1"
    Push-Location "$PSScriptRoot/../../runtime"
    try {
        & go build -trimpath "-ldflags=-X main.version=$OldVersion" -o (Join-Path $Bundle 'local-ai-agent.exe') ./server/cmd/mindfs-server
        if ($LASTEXITCODE -ne 0) { throw 'Could not build the old-version updater fixture.' }
    } finally { Pop-Location }
    $Listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    $Listener.Start()
    $Port = $Listener.LocalEndpoint.Port
    $Listener.Stop()
    $env:LOCAL_AI_AGENT_INSTALL_SCRIPT_BASE_URL = "http://127.0.0.1:$Port"
    $env:LOCAL_AI_AGENT_DOWNLOAD_BASE_URL = $env:LOCAL_AI_AGENT_INSTALL_SCRIPT_BASE_URL
    $Server = Start-Process python -ArgumentList @('-m','http.server',"$Port",'--bind','127.0.0.1') -WorkingDirectory $Root -PassThru
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Bundle 'install.ps1') -Prefix $Target
    if ($LASTEXITCODE -ne 0) { throw 'Failed to install old-version updater fixture.' }
    $HostFile = Join-Path $env:IDE_AGENT_REMOTE_HOST_DIR 'host.json'
    $Before = Get-Content -LiteralPath $HostFile -Raw | ConvertFrom-Json
    $null = Invoke-WebRequest -UseBasicParsing "$($Before.url)/?ide_token=$($Before.token)" -SessionVariable Browser
    $Body = @{ version = $Version } | ConvertTo-Json
    $Started = Invoke-RestMethod "$($Before.url)/api/standalone/update" -WebSession $Browser -Method Post -ContentType 'application/json' -Body $Body
    if ($Started.phase -ne 'installing') { throw 'The update did not enter the installing state.' }
    $Deadline = [DateTime]::UtcNow.AddMinutes(3)
    while ([DateTime]::UtcNow -lt $Deadline) {
        try {
            $After = Get-Content -LiteralPath $HostFile -Raw | ConvertFrom-Json
            $null = Invoke-WebRequest -UseBasicParsing "$($After.url)/?ide_token=$($After.token)" -SessionVariable Browser -TimeoutSec 4
            $Status = Invoke-RestMethod "$($After.url)/api/standalone/update" -WebSession $Browser -TimeoutSec 4
        } catch { Start-Sleep -Seconds 1; continue }
        if ($Status.phase -eq 'failed') { throw "$($Status.error): $($Status.log)" }
        if ($Status.phase -eq 'done') {
            if ($Status.current -ne $Version -or $After.url -ne $Before.url) { throw 'The updated version or service address is incorrect.' }
            Write-Host "Verified browser-triggered upgrade from $OldVersion to $Version with the port preserved."
            return
        }
        Start-Sleep -Seconds 1
    }
    throw 'The update did not finish.'
} finally {
    if (Test-Path -LiteralPath $Log) { Get-Content -LiteralPath $Log }
    if (Test-Path -LiteralPath $Executable) { & $Executable -unregister }
    if ($Server) { Stop-Process -Id $Server.Id -ErrorAction SilentlyContinue }
    Remove-Item -LiteralPath $Work -Recurse -Force -ErrorAction SilentlyContinue
}
