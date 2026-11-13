param(
    [ValidateSet('install', 'start', 'stop', 'remove')][string]$Operation,
    [string]$ConfigPath
)
$ErrorActionPreference = 'Stop'
$Config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
switch ($Operation) {
    'install' {
        $Arguments = '-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" "{1}"' -f $Config.runner, $ConfigPath
        $Action = New-ScheduledTaskAction -Execute $Config.powershell -Argument $Arguments
        $Trigger = New-ScheduledTaskTrigger -AtLogOn -User $Config.user_id
        $Principal = New-ScheduledTaskPrincipal -UserId $Config.user_id -LogonType Interactive -RunLevel Limited
        $Settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) `
            -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
            -MultipleInstances IgnoreNew -StartWhenAvailable `
            -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
        Register-ScheduledTask -TaskName $Config.name -Action $Action -Trigger $Trigger `
            -Principal $Principal -Settings $Settings -Force | Out-Null
    }
    'start' { Start-ScheduledTask -TaskName $Config.name }
    'stop' {
        Stop-ScheduledTask -TaskName $Config.name
        # Windows keeps the executable locked until the task has fully exited.
        $Deadline = [DateTime]::UtcNow.AddSeconds(30)
        while ((Get-ScheduledTask -TaskName $Config.name).State -eq 'Running') {
            if ([DateTime]::UtcNow -ge $Deadline) { throw "Task did not stop: $($Config.name)" }
            Start-Sleep -Milliseconds 100
        }
    }
    'remove' { Unregister-ScheduledTask -TaskName $Config.name -Confirm:$false }
}
