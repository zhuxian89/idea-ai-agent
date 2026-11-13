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
if ($Target.TrimEnd('\') -eq [System.IO.Path]::GetPathRoot($Target).TrimEnd('\') -or $Target -eq $env:USERPROFILE) {
    throw "Choose a dedicated Local AI Agent installation directory."
}
New-Item -ItemType Directory -Force -Path $Target | Out-Null
$Executable = Join-Path $Target "local-ai-agent.exe"
if ($DeferStart) {
    if (Test-Path -LiteralPath $Executable) { throw "Local AI Agent is already installed. Use the existing service or close IDEA before upgrading." }
} else {
    # Stop with the incoming CLI, including when installing in place.
    & $SourceExecutable -stop
    if ($LASTEXITCODE -ne 0) { throw "Stop Local AI Agent before upgrading." }
    Write-Host 'Waiting for the local data service to stop...'
    & $SourceExecutable -stop-core
    if ($LASTEXITCODE -ne 0) { throw "Cannot stop the local data service for this update." }
}
if ($Target -ne $Source) {
    Copy-Item -LiteralPath (Join-Path $Source "local-ai-agent.exe") -Destination $Executable -Force
    $Web = Join-Path $Target "web"
    # -LiteralPath everywhere: a directory name such as "[ab]" must not be read as a wildcard.
    if (Test-Path -LiteralPath $Web) { Remove-Item -LiteralPath $Web -Recurse -Force }
    foreach ($Name in @("web", "agents.json", "task_template.json", "LICENSE", "NOTICE.md", "licenses")) {
        Copy-Item -LiteralPath (Join-Path $Source $Name) -Destination $Target -Recurse -Force
    }
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
