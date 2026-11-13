param([string]$ConfigPath)
$ErrorActionPreference = 'Stop'
$Config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($Entry in $Config.environment.PSObject.Properties) {
    [Environment]::SetEnvironmentVariable($Entry.Name, [string]$Entry.Value, 'Process')
}
$Arguments = @($Config.arguments)
# Native stderr is a normal log stream, including in Windows PowerShell 5.1.
$ErrorActionPreference = 'Continue'
$global:LASTEXITCODE = 1
& $Config.executable @Arguments 2>&1 | Out-File -LiteralPath $Config.log -Append -Encoding UTF8
exit $LASTEXITCODE
