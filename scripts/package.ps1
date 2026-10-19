param(
    [ValidateSet('windows', 'linux')][string]$TargetOS = 'windows',
    [string]$Output = '',
    [switch]$AllowDirty,
    [switch]$SkipInstall,
    [switch]$SkipWebBuild
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = Split-Path $PSScriptRoot -Parent
$originalLocation = Get-Location

function Invoke-Checked {
    param([string]$Program, [string[]]$Arguments)
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program failed with exit code $LASTEXITCODE" }
}

try {
    foreach ($tool in @('git', 'go', 'node', 'npm')) {
        if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
            throw "Missing $tool. Install the toolchain documented in docs/packaging.md and add it to PATH."
        }
    }
    foreach ($file in @('server/go.mod', 'web/package-lock.json')) {
        if (-not (Test-Path -LiteralPath (Join-Path $root $file))) {
            throw 'Missing submodules. Run git submodule update --init --recursive first.'
        }
    }
    if (-not $Output) {
        $Output = Join-Path $root "deploy/musicfs-$TargetOS-amd64"
    }
    $Output = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Output)
    $helper = Join-Path $PSScriptRoot 'package-files.mjs'
    Invoke-Checked 'node' @($helper, 'check', $Output)
    $Output = $Output.TrimEnd([char[]]'\/')
    $stageName = '.' + (Split-Path $Output -Leaf) + '.build-' + [guid]::NewGuid().ToString()
    $stage = Join-Path (Split-Path $Output -Parent) $stageName
    $webStatus = & git -C (Join-Path $root 'web') status --porcelain
    if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect Web working tree.' }
    if ($webStatus -and -not $AllowDirty) {
        throw 'Web working tree is dirty. Commit changes or use -AllowDirty for a validation package.'
    }
    if (-not $SkipWebBuild) {
        Set-Location (Join-Path $root 'web')
        if ($SkipInstall) {
            if (-not (Test-Path -LiteralPath 'node_modules' -PathType Container)) {
                throw 'Web dependencies are missing. Run again without -SkipInstall.'
            }
        } else {
            Invoke-Checked 'npm' @('ci', '--no-audit', '--no-fund')
        }
        Invoke-Checked 'npm' @('run', 'build')
    }
    $webRoot = Join-Path $root 'web/dist'
    if (-not (Test-Path -LiteralPath (Join-Path $webRoot 'index.html'))) {
        throw 'Missing Web artifact: web/dist/index.html'
    }
    Set-Location (Join-Path $root 'server')
    $releaseArgs = @('run', '-mod=readonly', './scripts/release', '--os', $TargetOS,
        '--output', $stage, '--web-root', $webRoot)
    if ($AllowDirty) { $releaseArgs += '--allow-dirty' }
    # The release builder runs on the host and selects its own target.
    $savedEnvironment = @{}
    foreach ($name in @('GOOS', 'GOARCH', 'CGO_ENABLED')) {
        $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
        [Environment]::SetEnvironmentVariable($name, $null, 'Process')
    }
    try {
        Invoke-Checked 'go' $releaseArgs
    } finally {
        foreach ($name in $savedEnvironment.Keys) {
            [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process')
        }
    }

    $webRevision = & git -C (Join-Path $root 'web') rev-parse HEAD
    if ($LASTEXITCODE -ne 0) { throw 'Cannot read Web revision.' }
    $webDirty = ([bool]$webStatus).ToString().ToLowerInvariant()
    $webRebuilt = (-not [bool]$SkipWebBuild).ToString().ToLowerInvariant()
    Invoke-Checked 'node' @($helper, 'assemble', $stage, $root, $TargetOS, "$webRevision", $webDirty, $webRebuilt)
    Invoke-Checked 'node' @($helper, 'publish', $stage, $Output)
    Write-Host "Build directory: $Output"
    Write-Host "Checksums: $(Join-Path $Output 'SHA256SUMS')"
} finally {
    Set-Location $originalLocation
}
