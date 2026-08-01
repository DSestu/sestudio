@echo off
setlocal

rem sestudio (Windows): serve the web UI over HTTPS (self-signed) on all
rem interfaces so Chromecast/AirPlay work and it is reachable over a port-forward.
rem The casting device must trust the cert once (see the README). No Caddy needed.
rem Ctrl-C in this window stops the app.

uvx --with-editable . sestudio serve --host 0.0.0.0 %*

endlocal
