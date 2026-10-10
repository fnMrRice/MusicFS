#requires -Version 5.1
<#
.SYNOPSIS
构建 Web 和 Server，生成供手动启动的独立安装目录。
.PARAMETER Output
新的输出目录；相对路径以本脚本所在目录为基准。默认使用带时间戳的 packages 子目录。
.PARAMETER SkipInstall
复用已经按 package-lock.json 安装的 Web 依赖，跳过 npm ci。
.EXAMPLE
./package.ps1
.EXAMPLE
./package.ps1 -Output ./packages/my-build -SkipInstall
#>
[CmdletBinding()]
param(
    [ValidateSet('windows', 'linux')]
    [string]$TargetOS = 'windows',
    [string]$Output = '',
    [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'
$serverRoot = Join-Path $PSScriptRoot 'server'
$webRoot = Join-Path $PSScriptRoot 'web'
$webDist = Join-Path $webRoot 'dist'

foreach ($relative in @('server/go.mod', 'server/scripts/release/main.go', 'web/package.json', 'web/package-lock.json', 'scripts/start.bat')) {
    if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot $relative) -PathType Leaf)) {
        throw "Required source file is missing: $relative. Check out server and web beside this script."
    }
}
foreach ($command in @('go', 'node', 'git')) {
    $null = Get-Command $command -CommandType Application -ErrorAction Stop
}
$npm = if ($env:OS -eq 'Windows_NT') { 'npm.cmd' } else { 'npm' }
$null = Get-Command $npm -CommandType Application -ErrorAction Stop

if ([string]::IsNullOrWhiteSpace($Output)) {
    $Output = 'packages/musicfs-{0}-amd64-{1}' -f $TargetOS, (Get-Date -Format 'yyyyMMdd-HHmmss-fff')
}
if (-not [IO.Path]::IsPathRooted($Output)) {
    $Output = Join-Path $PSScriptRoot $Output
}
$Output = [IO.Path]::GetFullPath($Output)
if (Test-Path -LiteralPath $Output) {
    throw "Output already exists. Choose a new directory: $Output"
}
if ($SkipInstall -and -not (Test-Path -LiteralPath (Join-Path $webRoot 'node_modules') -PathType Container)) {
    throw 'Web dependencies are missing. Run again without -SkipInstall.'
}

Push-Location $webRoot
try {
    if (-not $SkipInstall) {
        Write-Host 'Installing locked Web dependencies...'
        & $npm ci --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'Web dependency installation failed.' }
    }
    Write-Host 'Building Web...'
    & $npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Web build failed.' }
    if (-not (Test-Path -LiteralPath (Join-Path $webDist 'index.html') -PathType Leaf)) {
        throw 'Web build did not produce dist/index.html.'
    }
}
finally {
    Pop-Location
}

# Run the existing Server packager on the host; it sets its own target environment.
$savedEnvironment = @{}
foreach ($name in @('GOOS', 'GOARCH', 'CGO_ENABLED')) {
    $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
    [Environment]::SetEnvironmentVariable($name, $null, 'Process')
}
Push-Location $serverRoot
try {
    Write-Host "Building Server and plugins for $TargetOS/amd64 and bundling Web..."
    Write-Host 'Local build: uncommitted source changes are included.'
    & go run -mod=readonly ./scripts/release --os $TargetOS --output $Output --web-root $webDist --allow-dirty
    if ($LASTEXITCODE -ne 0) { throw 'Server packaging failed. Any .incomplete directory is not ready to use.' }
}
finally {
    Pop-Location
    foreach ($name in $savedEnvironment.Keys) {
        [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process')
    }
}

if ($TargetOS -eq 'windows') {
    $incomplete = Join-Path $Output '.incomplete'
    [IO.File]::WriteAllText($incomplete, "Adding Windows launcher.`n")
    $launcher = Join-Path $Output 'start.bat'
    $batchText = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'scripts/start.bat')) -replace '\r?\n', "`r`n"
    [IO.File]::WriteAllText($launcher, $batchText, [Text.Encoding]::ASCII)
    $hash = (Get-FileHash -LiteralPath $launcher -Algorithm SHA256).Hash.ToLowerInvariant()
    [IO.File]::AppendAllText((Join-Path $Output 'SHA256SUMS'), "$hash  start.bat`n", [Text.Encoding]::ASCII)
    Remove-Item -LiteralPath $incomplete
}

Write-Host "Package ready: $Output"
if ($TargetOS -eq 'windows') { Write-Host 'Double-click start.bat to start Server and serve the Web page.' }
Write-Host 'Configure music/tool paths in configs/server.yaml; bundled plugins start unless explicitly disabled.'
Write-Host 'Manual startup instructions: docs/packaging.md or server/docs/deployment.md in the workspace.'
