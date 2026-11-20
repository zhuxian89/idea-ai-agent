param([Parameter(Mandatory=$true)][string]$ConfigPath)
$ErrorActionPreference = 'Stop'
$Config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($Variable in $Config.environment.PSObject.Properties) {
    [Environment]::SetEnvironmentVariable($Variable.Name, [string]$Variable.Value, 'Process')
}
$Code = 1
try {
    # The published entry script, pinned to the release the page offered. It stops the service,
    # replaces its files and starts it again; its output goes to the update log.
    $Source = Invoke-RestMethod $Config.script_url -ErrorAction Stop
    & ([scriptblock]::Create($Source.TrimStart([char]0xFEFF))) -Version $Config.version *>&1 |
        ForEach-Object { [IO.File]::AppendAllText($Config.log, "$_`n", [Text.UTF8Encoding]::new($false)) }
    $Code = 0
} catch {
    [IO.File]::AppendAllText($Config.log, "$_`n", [Text.UTF8Encoding]::new($false))
    $Code = 1
}
# The next process reads this to tell a finished update from a failed one.
[IO.File]::WriteAllText($Config.exit_file + '.tmp', [string]$Code)
[IO.File]::Move($Config.exit_file + '.tmp', $Config.exit_file)
Unregister-ScheduledTask -TaskName $Config.task -Confirm:$false -ErrorAction SilentlyContinue
exit $Code
