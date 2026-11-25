param(
    [Parameter(Mandatory = $true)][string]$Deployment,
    [Parameter(Mandatory = $true)][ValidatePattern('^S-1-5-21-[0-9-]+$')][string]$AccountSid,
    [Parameter(Mandatory = $true)][string]$ResultFile
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

try {
    $deploymentPath = (Resolve-Path -LiteralPath $Deployment).Path
    $target = Join-Path $deploymentPath 'data\online\apple-public\credentials\key'
    $item = Get-Item -LiteralPath $target -Force
    if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw 'The credential key must be a regular file.'
    }
    # Restrict ownership and read permission repair to this single credential key.
    $expectedPath = [IO.Path]::GetFullPath($target)
    if ($item.FullName -ne $expectedPath -or -not $expectedPath.StartsWith($deploymentPath + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw 'The credential path is outside the deployment.'
    }
    & takeown.exe /F $target | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Cannot take ownership of the credential key.' }
    & icacls.exe $target /grant ('*' + $AccountSid + ':R') /Q | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Cannot grant the requested account read access.' }
    'Credential permissions repaired.' | Set-Content -LiteralPath $ResultFile -Encoding UTF8
} catch {
    ('Permission repair failed: ' + $_.Exception.Message) | Set-Content -LiteralPath $ResultFile -Encoding UTF8
    exit 1
}
