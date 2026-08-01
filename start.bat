@echo off
setlocal enabledelayedexpansion

rem sestudio (Windows): run the app on all interfaces and front it with HTTPS
rem via Caddy (self-signed) so Chromecast/AirPlay work and it is reachable over a
rem port-forward. DLNA works without HTTPS. Ctrl-C in this window stops the app.

set "PORT=8081"
set "HTTPS_PORT=8443"

rem --- Detect this machine's LAN IPv4 (used for the cert and display) --------
set "LANIP="
set "_IPFILE=%TEMP%\fsdl_lanip.txt"
powershell -NoProfile -Command "$ip=(Get-NetIPConfiguration | ?{$_.IPv4DefaultGateway -ne $null -and $_.NetAdapter.Status -eq 'Up'} | select -First 1 -Expand IPv4Address | select -First 1 -Expand IPAddress); if(-not $ip){$ip=(Get-NetIPAddress -AddressFamily IPv4 | ?{$_.IPAddress -notmatch '^(127\.|169\.254\.)'} | select -First 1 -Expand IPAddress)}; $ip" > "%_IPFILE%" 2>nul
if exist "%_IPFILE%" set /p LANIP=<"%_IPFILE%"
if exist "%_IPFILE%" del "%_IPFILE%" >nul 2>nul
if defined LANIP set "LANIP=%LANIP: =%"
if not defined LANIP set "LANIP=127.0.0.1"
if "%LANIP%"=="" set "LANIP=127.0.0.1"

rem --- Generate a Caddyfile: HTTPS on ALL interfaces, ANY host --------------
rem A port-only site (:PORT) listens on every interface and matches any Host,
rem so it works whether you reach it by LAN IP or public IP (port-forward).
rem on-demand TLS mints a self-signed cert per host; the app's tls-permission
rem endpoint authorises it. Browsers show a one-time certificate warning.
set "CADDYFILE=%TEMP%\fsdl_Caddyfile"
> "%CADDYFILE%" echo {
>>"%CADDYFILE%" echo   local_certs
>>"%CADDYFILE%" echo   default_sni %LANIP%
>>"%CADDYFILE%" echo   on_demand_tls {
>>"%CADDYFILE%" echo     ask http://127.0.0.1:%PORT%/api/tls-permission
>>"%CADDYFILE%" echo   }
>>"%CADDYFILE%" echo }
>>"%CADDYFILE%" echo :%HTTPS_PORT% {
>>"%CADDYFILE%" echo   tls {
>>"%CADDYFILE%" echo     on_demand
>>"%CADDYFILE%" echo   }
>>"%CADDYFILE%" echo   reverse_proxy 127.0.0.1:%PORT%
>>"%CADDYFILE%" echo }

where caddy >nul 2>nul
if %errorlevel%==0 (
  echo.
  echo   HTTPS on ALL interfaces, port %HTTPS_PORT% - self-signed cert
  echo   Local:   https://%LANIP%:%HTTPS_PORT%
  echo   Remote:  https://YOUR-PUBLIC-IP:%HTTPS_PORT%   [forward TCP %HTTPS_PORT% on your router]
  echo   Browsers show a certificate warning - click through to proceed.
  echo.
  start "Caddy HTTPS (sestudio)" caddy run --config "%CADDYFILE%" --adapter caddyfile
) else (
  echo [!] caddy not found on PATH - HTTPS/Chromecast unavailable.
  echo     DLNA casting still works over http://%LANIP%:%PORT%
)

uvx --with-editable . sestudio serve --host 0.0.0.0 -p %PORT% %*

endlocal
