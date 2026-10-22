@echo off
setlocal EnableExtensions DisableDelayedExpansion
title MusicFS
pushd "%~dp0"
if errorlevel 1 goto location_error

if exist ".incomplete" (
    echo ERROR: This package is incomplete. Build a new package first.
    goto failed
)
if not exist "bin\musicfs.exe" (
    echo ERROR: bin\musicfs.exe is missing. Run start.bat from the package directory.
    goto failed
)
if not exist "web\index.html" (
    echo ERROR: web\index.html is missing. Build a complete package first.
    goto failed
)
if exist "configs\server.yaml" goto config_ready
if not exist "configs\server.example.yaml" (
    echo ERROR: configs\server.example.yaml is missing.
    goto failed
)
copy /y "configs\server.example.yaml" "configs\server.yaml" >nul
if errorlevel 1 goto failed
echo Created configs\server.yaml. Select music directories in Web settings after startup.

:config_ready
for %%I in ("configs\server.yaml") do set "config_attributes=%%~aI"
if /i "%config_attributes:~0,1%"=="d" (
    echo ERROR: configs\server.yaml must be a regular file.
    goto failed
)
if defined MUSICFS_ADMIN_TOKEN goto start_server
if exist "configs\admin-token.txt" goto load_token
set "token_temp=configs\.admin-token-%RANDOM%-%RANDOM%.tmp"
"bin\musicfs.exe" token >"%token_temp%"
if errorlevel 1 goto token_failed
set /p "MUSICFS_ADMIN_TOKEN=" <"%token_temp%"
if not defined MUSICFS_ADMIN_TOKEN goto token_failed
if exist "configs\admin-token.txt" (
    del /q "%token_temp%" >nul 2>&1
    set "MUSICFS_ADMIN_TOKEN="
    goto load_token
)
move /y "%token_temp%" "configs\admin-token.txt" >nul
if errorlevel 1 goto token_failed

:load_token
set /p "MUSICFS_ADMIN_TOKEN=" <"configs\admin-token.txt"
if not defined MUSICFS_ADMIN_TOKEN (
    echo ERROR: configs\admin-token.txt is empty. Supply a valid administrator token.
    goto failed
)
clip <"configs\admin-token.txt"
if errorlevel 1 (
    echo Clipboard unavailable. Read your login token from configs\admin-token.txt.
) else (
    echo Login token copied to clipboard. Paste it into the Web login page.
)

:start_server
echo Starting MusicFS. Default page: http://127.0.0.1:8080
echo Use the address in configs\server.yaml if you changed the listener.
echo Keep this window open. Press Ctrl+C to stop the server.
"bin\musicfs.exe" serve --config "configs\server.yaml" %*
if errorlevel 1 goto failed
popd
exit /b 0

:token_failed
if defined token_temp del /q "%token_temp%" >nul 2>&1
echo ERROR: Failed to generate or save an administrator token.
goto failed

:failed
echo MusicFS could not start. Review the error above.
pause
popd
exit /b 1

:location_error
echo ERROR: Cannot open the package directory.
pause
exit /b 1
