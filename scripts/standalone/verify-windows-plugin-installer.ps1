param([Parameter(Mandatory=$true)][string]$PluginZip, [string]$Version)
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1) {
    throw 'Release verification requires Windows PowerShell 5.1.'
}
if (-not $Version) { $Version = (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'version.txt') -Raw).Trim() }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$Work = Join-Path ([IO.Path]::GetTempPath()) ([IO.Path]::GetRandomFileName())
New-Item -ItemType Directory -Path $Work | Out-Null
$PreviousSource = $env:INSTALL_TEST_ONLINE_SCRIPT
$PreviousRuntime = $env:INSTALL_TEST_POWERSHELL
try {
    $Outer = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $PluginZip))
    try {
        $JarEntry = @($Outer.Entries | Where-Object { $_.FullName -match '^idea-ai-agent/lib/idea-ai-agent-[^/]+\.jar$' })
        if ($JarEntry.Count -ne 1) { throw 'Expected one plugin JAR.' }
        $Jar = Join-Path $Work 'plugin.jar'
        [IO.Compression.ZipFileExtensions]::ExtractToFile($JarEntry[0], $Jar)
    } finally { $Outer.Dispose() }
    $Inner = [IO.Compression.ZipFile]::OpenRead($Jar)
    try {
        $Script = Join-Path $Work 'install.ps1'
        $Entry = $Inner.GetEntry('installers/install.ps1')
        if (-not $Entry) { throw 'Plugin installer is missing.' }
        [IO.Compression.ZipFileExtensions]::ExtractToFile($Entry, $Script)
    } finally { $Inner.Dispose() }
    $Bytes = [IO.File]::ReadAllBytes($Script)
    if ($Bytes.Length -lt 3 -or $Bytes[0] -ne 239 -or $Bytes[1] -ne 187 -or $Bytes[2] -ne 191) {
        throw 'The packaged installer must use UTF-8 with BOM.'
    }
    $Expected = [IO.File]::ReadAllBytes((Join-Path $PSScriptRoot 'download.ps1'))
    if ([Convert]::ToBase64String($Bytes) -cne [Convert]::ToBase64String($Expected)) {
        throw 'The packaged installer differs from source.'
    }
    foreach ($File in @($Script, (Join-Path $PSScriptRoot 'install.ps1'))) {
        $Errors = $null
        [System.Management.Automation.Language.Parser]::ParseFile($File, [ref]$null, [ref]$Errors) | Out-Null
        if ($Errors) { throw ($Errors | Out-String) }
    }
    # Read the exact packaged file through the default PowerShell 5.1 reader.
    $Source = Get-Content -LiteralPath $Script -Raw
    $Start = $Source.IndexOf('function Get-HttpsContent {')
    $End = $Source.IndexOf([char]10 + '$Architecture =', $Start)
    . ([scriptblock]::Create($Source.Substring($Start, $End - $Start)))
    $AllowInsecure = $false
    $Name = "local-ai-agent-$Version-windows-amd64.zip"
    $Url = "https://github.com/zhuxian89/idea-ai-agent/releases/download/standalone-v$Version/$Name"
    $Archive = Join-Path $Work $Name
    $Checksum = Join-Path $Work 'checksum'
    Get-HttpsContent -Uri $Url -OutFile $Archive
    Get-HttpsContent -Uri "$Url.sha256" -OutFile $Checksum
    $Digest = ((Get-Content -LiteralPath $Checksum -Raw).Trim() -split '\s+')[0]
    if ((Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash -ine $Digest) { throw 'Public archive checksum mismatch.' }
    $env:INSTALL_TEST_ONLINE_SCRIPT = $Script
    $env:INSTALL_TEST_POWERSHELL = (Get-Process -Id $PID).Path
    & node --test (Join-Path $PSScriptRoot 'download-redirect.test.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Packaged installer download regression failed.' }
    Write-Host "Verified packaged installer with PowerShell $($PSVersionTable.PSVersion), UTF-8 BOM and public Windows $Version archive SHA-256 $Digest"
} finally {
    $env:INSTALL_TEST_ONLINE_SCRIPT = $PreviousSource
    $env:INSTALL_TEST_POWERSHELL = $PreviousRuntime
    Remove-Item -LiteralPath $Work -Recurse -Force
}
