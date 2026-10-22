param(
    [Parameter(Mandatory = $true)][string]$Deployment,
    [Parameter(Mandatory = $true)][int]$ServerProcessId
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$deploymentPath = (Resolve-Path -LiteralPath $Deployment).Path
$executable = Join-Path $deploymentPath 'bin/musicfs.exe'
$serverProcess = Get-Process -Id $ServerProcessId -ErrorAction Stop
if ($serverProcess.Path -ne $executable) { throw 'The process does not belong to this deployment.' }

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class MusicFSConsoleStop {
    [DllImport("kernel32.dll", SetLastError=true)] public static extern bool FreeConsole();
    [DllImport("kernel32.dll", SetLastError=true)] public static extern bool AttachConsole(uint processId);
    [DllImport("kernel32.dll", SetLastError=true)] public static extern uint GetConsoleProcessList(uint[] ids, uint length);
    [DllImport("kernel32.dll", SetLastError=true)] public static extern bool SetConsoleCtrlHandler(IntPtr handler, bool add);
    [DllImport("kernel32.dll", SetLastError=true)] public static extern bool GenerateConsoleCtrlEvent(uint controlEvent, uint processGroup);
}
'@

# Run in a separate shell. Never signal a console shared with unrelated programs.
[void][MusicFSConsoleStop]::FreeConsole()
if (-not [MusicFSConsoleStop]::AttachConsole($ServerProcessId)) {
    throw 'The server has no attachable console. Stop it through its launcher.'
}
try {
    $consoleIds = New-Object uint[] 64
    $consoleCount = [MusicFSConsoleStop]::GetConsoleProcessList($consoleIds, 64)
    if ($consoleCount -eq 0 -or $consoleCount -gt 64) { throw 'Cannot validate the server console.' }
    $launcher = Join-Path $deploymentPath 'start.bat'
    for ($index = 0; $index -lt $consoleCount; $index++) {
        $consoleProcessId = $consoleIds[$index]
        if ($consoleProcessId -eq $PID -or $consoleProcessId -eq $ServerProcessId) { continue }
        $entry = Get-CimInstance Win32_Process -Filter "ProcessId = $consoleProcessId"
        if ($entry.Name -ne 'cmd.exe' -or -not $entry.CommandLine.Contains('"' + $launcher + '"')) {
            throw 'The console contains another program; no stop signal was sent.'
        }
    }
    if (-not [MusicFSConsoleStop]::SetConsoleCtrlHandler([IntPtr]::Zero, $true)) {
        throw 'Cannot protect the stop helper from its own signal.'
    }
    if (-not [MusicFSConsoleStop]::GenerateConsoleCtrlEvent(0, 0)) {
        throw 'Failed to send a graceful interrupt.'
    }
    if (-not $serverProcess.WaitForExit(30000)) {
        throw 'Graceful shutdown did not finish; the server was not forcibly terminated.'
    }
    Write-Output 'MusicFS stopped gracefully.'
} finally {
    [void][MusicFSConsoleStop]::FreeConsole()
}
