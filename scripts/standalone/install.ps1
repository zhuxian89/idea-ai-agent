param([string]$Prefix = "", [switch]$DeferStart)
$ErrorActionPreference = "Stop"
$Source = $PSScriptRoot
$SourceExecutable = Join-Path $Source "local-ai-agent.exe"
if (-not $Prefix) {
    $Prefix = & $SourceExecutable -installation-dir
    if ($LASTEXITCODE -ne 0) { throw "Cannot read the existing installation directory." }
    if (-not $Prefix) { $Prefix = Join-Path $env:LOCALAPPDATA "Programs\LocalAIAgent" }
}
$Target = [System.IO.Path]::GetFullPath($Prefix)
if ($Target.TrimEnd('\') -eq [System.IO.Path]::GetPathRoot($Target).TrimEnd('\') -or $Target.TrimEnd('\') -eq "$env:USERPROFILE".TrimEnd('\')) {
    throw "Choose a dedicated Local AI Agent installation directory."
}
New-Item -ItemType Directory -Force -Path $Target | Out-Null
$Executable = Join-Path $Target "local-ai-agent.exe"
$Stage = Join-Path $Target ".upgrade"
$Stopped = $false
$Swapped = $false
# Leave the machine usable when the installation stops half way: a first installation must
# not look installed on the next try, and an upgrade must not leave the remote node offline.
try {
    if ($DeferStart) {
        if (Test-Path -LiteralPath $Executable) { throw "Local AI Agent is already installed. Use the existing service or close IDEA before upgrading." }
    } else {
        $Stopped = $true
        # Stop with the incoming CLI, including when installing in place.
        & $SourceExecutable -stop
        if ($LASTEXITCODE -ne 0) { throw "Stop Local AI Agent before upgrading." }
        Write-Host 'Waiting for the local data service to stop...'
        & $SourceExecutable -stop-core
        if ($LASTEXITCODE -ne 0) { throw "Cannot stop the local data service for this update." }
    }
    if ($Target -ne $Source) {
        # Copy everything aside first, so a failed copy leaves the previous installation untouched,
        # then move each item into place. -LiteralPath everywhere: a directory name such as "[ab]"
        # must not be read as a wildcard.
        $Names = @("web", "licenses", "agents.json", "task_template.json", "LICENSE", "NOTICE.md", "local-ai-agent.exe")
        if (Test-Path -LiteralPath $Stage) { Remove-Item -LiteralPath $Stage -Recurse -Force }
        New-Item -ItemType Directory -Path $Stage | Out-Null
        foreach ($Name in $Names) {
            Copy-Item -LiteralPath (Join-Path $Source $Name) -Destination $Stage -Recurse -Force
        }
        $Swapped = $true
        foreach ($Name in @("web", "licenses")) {
            $Old = Join-Path $Target $Name
            if (Test-Path -LiteralPath $Old) { Remove-Item -LiteralPath $Old -Recurse -Force }
        }
        foreach ($Name in $Names) {
            Move-Item -LiteralPath (Join-Path $Stage $Name) -Destination (Join-Path $Target $Name) -Force
        }
        Remove-Item -LiteralPath $Stage -Force
    }
    & $Executable -install
    if ($LASTEXITCODE -ne 0) { throw "Cannot register Local AI Agent for IDEA." }
    if ($DeferStart) {
        Write-Host "Local AI Agent installed. Restart all IDEA instances to use it: $Target"
    } else {
        & $Executable -no-browser
        if ($LASTEXITCODE -ne 0) { throw "Cannot start Local AI Agent." }
        Write-Host "Local AI Agent installed and started: $Target"
    }
    Write-Host "Automatic startup at sign-in is configured."
} catch {
    $Failure = $_
    if (Test-Path -LiteralPath $Stage) { Remove-Item -LiteralPath $Stage -Recurse -Force -ErrorAction SilentlyContinue }
    if ($DeferStart) {
        if ($Swapped) { Remove-Item -LiteralPath $Executable -Force -ErrorAction SilentlyContinue }
    } elseif ($Stopped -and (Test-Path -LiteralPath $Executable)) {
        Write-Warning "Installation failed; restarting Local AI Agent..."
        & $Executable -no-browser
    }
    throw $Failure
}
