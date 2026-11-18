param([Parameter(Mandatory=$true)][string]$Zip, [Parameter(Mandatory=$true)][string]$Version)
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1) {
    throw 'Package verification requires Windows PowerShell 5.1.'
}
# Runs the package's own install.ps1 with the real executable in isolated directories:
# first install, repeated first install, directory guard, upgrade, failed upgrade, removal.
$Work = Join-Path ([IO.Path]::GetTempPath()) ('standalone-verify-' + [IO.Path]::GetRandomFileName())
New-Item -ItemType Directory -Path $Work | Out-Null
$Target = Join-Path $Work 'installed'
$env:IDE_AGENT_REMOTE_HOST_DIR = Join-Path $Work 'remote'
$env:MINDFS_RELAY_BASE_URL = 'http://127.0.0.1:1'
Remove-Item Env:IDE_AGENT_DATA_DIR, Env:IDE_AGENT_TOKEN, Env:MINDFS_STATIC_DIR -ErrorAction SilentlyContinue

function Invoke-Native([string]$Program, [string[]]$Arguments) {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { $text = (& $Program @Arguments 2>&1 | Out-String) } finally { $ErrorActionPreference = $previous }
    [pscustomobject]@{ Code = $LASTEXITCODE; Output = $text }
}
function Invoke-Installer([string]$Bundle, [string[]]$Arguments) {
    Invoke-Native 'powershell.exe' (@('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $Bundle 'install.ps1')) + $Arguments)
}
function Assert([bool]$Condition, [string]$Message, $Result) {
    if (-not $Condition) {
        if ($Result) { Write-Host $Result.Output }
        throw "FAILED: $Message"
    }
    Write-Host "ok: $Message"
}

try {
    Expand-Archive -LiteralPath $Zip -DestinationPath (Join-Path $Work 'package')
    $Bundle = @(Get-ChildItem -LiteralPath (Join-Path $Work 'package') -Directory)[0].FullName
    $Executable = Join-Path $Target 'local-ai-agent.exe'
    Assert ((& (Join-Path $Bundle 'local-ai-agent.exe') -version) -eq "Local AI Agent $Version") "package executable reports $Version"

    $first = Invoke-Installer $Bundle @('-Prefix', $Target, '-DeferStart')
    Assert ($first.Code -eq 0) 'first installation with -DeferStart succeeds' $first
    Assert ((Test-Path -LiteralPath (Join-Path $env:IDE_AGENT_REMOTE_HOST_DIR 'installation.json')) -and (Test-Path -LiteralPath $Executable)) 'installation is recorded' $first
    Assert (@(Get-ScheduledTask | Where-Object { $_.TaskName -like 'LocalAIAgent-*' }).Count -ge 2) 'login tasks are registered' $first

    $again = Invoke-Installer $Bundle @('-Prefix', $Target, '-DeferStart')
    Assert (($again.Code -ne 0) -and ($again.Output -match 'already installed')) 'a second first-installation is refused' $again

    $guard = Invoke-Installer $Bundle @('-Prefix', ($env:USERPROFILE + '\'))
    Assert (($guard.Code -ne 0) -and ($guard.Output -match 'dedicated')) 'the profile directory is refused even with a trailing backslash' $guard

    $upgrade = Invoke-Installer $Bundle @('-Prefix', $Target)
    Assert ($upgrade.Code -eq 0) 'upgrade succeeds and starts the service' $upgrade
    $status = Invoke-Native $Executable @('-status')
    Assert (($status.Code -eq 0) -and ($status.Output -match "Local AI Agent $([regex]::Escape($Version)) running")) 'the service is running after the upgrade' $status

    $Broken = Join-Path $Work 'broken'
    Copy-Item -LiteralPath $Bundle -Destination $Broken -Recurse
    Remove-Item -LiteralPath (Join-Path $Broken 'NOTICE.md')
    $failed = Invoke-Installer $Broken @('-Prefix', $Target)
    Assert ($failed.Code -ne 0) 'an upgrade with a missing file fails' $failed
    Assert (($failed.Output -match 'restarting') -and (Test-Path -LiteralPath (Join-Path $Target 'NOTICE.md')) -and -not (Test-Path -LiteralPath (Join-Path $Target '.upgrade'))) 'the previous files are intact and nothing is left staged' $failed
    $status = Invoke-Native $Executable @('-status')
    Assert (($status.Code -eq 0) -and ($status.Output -match 'running')) 'the service is running again after the failed upgrade' $status
} finally {
    if (Test-Path -LiteralPath (Join-Path $Target 'local-ai-agent.exe')) {
        Invoke-Native (Join-Path $Target 'local-ai-agent.exe') @('-unregister') | Out-Null
    }
    Remove-Item -LiteralPath $Work -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Host 'Windows package verification passed.'
