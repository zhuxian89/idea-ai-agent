param([Parameter(Mandatory=$true)][string]$ConfigPath)
$ErrorActionPreference = 'Stop'
$Config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
# A task of its own: stopping the service's tasks must not stop the installer that is replacing them.
$Arguments = '-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" "{1}"' -f $Config.runner, $ConfigPath
$Action = New-ScheduledTaskAction -Execute $Config.powershell -Argument $Arguments
$Principal = New-ScheduledTaskPrincipal -UserId $Config.user_id -LogonType Interactive -RunLevel Limited
$Settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $Config.task -Action $Action -Principal $Principal -Settings $Settings -Force | Out-Null
Start-ScheduledTask -TaskName $Config.task
