[CmdletBinding()]
param(
    [string]$Version = "",
    [string]$Prefix = "",
    [switch]$DeferStart
)

# Invoke-Expression receives the BOM as a character when reading raw GitHub content.
$Source = Invoke-RestMethod "https://raw.githubusercontent.com/zhuxian89/idea-ai-agent/main/scripts/standalone/download.ps1" -ErrorAction Stop
& ([scriptblock]::Create($Source.TrimStart([char]0xFEFF))) -Version $Version -Prefix $Prefix -DeferStart:$DeferStart
