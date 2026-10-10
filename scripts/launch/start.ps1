$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$server = Join-Path $PSScriptRoot 'bin/musicfs.exe'
if (-not (Test-Path -LiteralPath $server)) { throw 'Missing bin/musicfs.exe. Extract the entire installation package first.' }
if (-not (Test-Path -LiteralPath 'configs/server.yaml')) {
    Copy-Item -LiteralPath 'configs/server.example.yaml' -Destination 'configs/server.yaml'
}
New-Item -ItemType Directory -Path 'music' -Force | Out-Null
if (-not $env:MUSICFS_ADMIN_TOKEN) {
    $token = & $server token
    if ($LASTEXITCODE -ne 0 -or -not $token) { throw 'Failed to generate an administrator token.' }
    $env:MUSICFS_ADMIN_TOKEN = "$token".Trim()
}
Write-Host 'Default web URL: http://127.0.0.1:8080'
Write-Host "Admin login token: $env:MUSICFS_ADMIN_TOKEN"
Write-Host 'Keep this token private. Configure music paths and plugins in configs/server.yaml. Press Ctrl+C to stop.'
& $server serve --config './configs/server.yaml' @args
exit $LASTEXITCODE
