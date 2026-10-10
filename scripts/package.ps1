param(
    [ValidateSet('windows', 'linux')][string]$TargetOS = 'windows',
    [string]$Output = '',
    [switch]$AllowDirty,
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
    if ($TargetOS -eq 'linux' -and -not (Get-Command tar -ErrorAction SilentlyContinue)) {
        throw 'Linux packaging requires tar.'
    }
    foreach ($file in @('server/go.mod', 'web/package-lock.json')) {
        if (-not (Test-Path -LiteralPath (Join-Path $root $file))) {
            throw 'Missing submodules. Run git submodule update --init --recursive first.'
        }
    }
    if (-not $Output) {
        $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
        $Output = Join-Path $root "deploy/musicfs-$TargetOS-amd64-$stamp"
    }
    $Output = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Output)
    $archive = if ($TargetOS -eq 'windows') { "$Output.zip" } else { "$Output.tar.gz" }
    foreach ($path in @($Output, $archive, "$archive.sha256")) {
        if (Test-Path -LiteralPath $path) { throw "Output already exists: $path" }
    }
    $webStatus = & git -C (Join-Path $root 'web') status --porcelain
    if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect Web working tree.' }
    if ($webStatus -and -not $AllowDirty) {
        throw 'Web working tree is dirty. Commit changes or use -AllowDirty for a validation package.'
    }
    if (-not $SkipWebBuild) {
        Set-Location (Join-Path $root 'web')
        Invoke-Checked 'npm' @('ci', '--no-audit', '--no-fund')
        Invoke-Checked 'npm' @('run', 'build')
    }
    $webRoot = Join-Path $root 'web/dist'
    if (-not (Test-Path -LiteralPath (Join-Path $webRoot 'index.html'))) {
        throw 'Missing Web artifact: web/dist/index.html'
    }
    Set-Location (Join-Path $root 'server')
    $releaseArgs = @('run', '-mod=readonly', './scripts/release', '--os', $TargetOS,
        '--output', $Output, '--web-root', $webRoot)
    if ($AllowDirty) { $releaseArgs += '--allow-dirty' }
    Invoke-Checked 'go' $releaseArgs

    # Keep the bundle incomplete until launchers and checksums are finalized.
    $marker = Join-Path $Output '.incomplete'
    [IO.File]::WriteAllText($marker, "Packaging has not completed.`n")
    $launchers = if ($TargetOS -eq 'windows') { @('start.bat', 'start.ps1') } else { @('start.sh') }
    foreach ($name in $launchers) {
        Copy-Item -LiteralPath (Join-Path $root "scripts/launch/$name") -Destination (Join-Path $Output $name)
    }
    Copy-Item -LiteralPath (Join-Path $root 'docs/packaging-start.md') -Destination (Join-Path $Output 'START.md')
    $webRevision = & git -C (Join-Path $root 'web') rev-parse HEAD
    if ($LASTEXITCODE -ne 0) { throw 'Cannot read Web revision.' }
    $source = [ordered]@{ webRevision = "$webRevision"; webDirty = [bool]$webStatus; webRebuilt = -not [bool]$SkipWebBuild }
    [IO.File]::WriteAllText((Join-Path $Output 'web-source.json'), ($source | ConvertTo-Json) + "`n", [Text.UTF8Encoding]::new($false))
    $prefix = $Output.TrimEnd([char[]]'\/') + [IO.Path]::DirectorySeparatorChar
    $lines = @(Get-ChildItem -LiteralPath $Output -File -Recurse -Force | ForEach-Object {
        $relative = $_.FullName.Substring($prefix.Length).Replace('\', '/')
        if ($relative -ne 'SHA256SUMS' -and $relative -ne '.incomplete') {
            $hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
            "$hash  $relative"
        }
    } | Sort-Object)
    [IO.File]::WriteAllText((Join-Path $Output 'SHA256SUMS'), ($lines -join "`n") + "`n", [Text.UTF8Encoding]::new($false))
    Remove-Item -LiteralPath $marker
    Set-Location (Split-Path $Output -Parent)
    if ($TargetOS -eq 'windows') {
        Compress-Archive -LiteralPath $Output -DestinationPath $archive -CompressionLevel Optimal
    } else {
        Invoke-Checked 'tar' @('-czf', $archive, (Split-Path $Output -Leaf))
    }
    $archiveHash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    [IO.File]::WriteAllText("$archive.sha256", "$archiveHash  $([IO.Path]::GetFileName($archive))`n", [Text.UTF8Encoding]::new($false))
    Write-Host "Package: $archive"
    Write-Host "Checksum: $archive.sha256"
} finally {
    Set-Location $originalLocation
}
