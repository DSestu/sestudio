@echo off
setlocal

rem sestudio (Windows): serve the web UI over HTTPS (self-signed) on all
rem interfaces so Chromecast/AirPlay work and it is reachable over a port-forward.
rem The casting device must trust the cert once (see the README). No Caddy needed.
rem Ctrl-C in this window stops the app.

rem --python 3.12 is not incidental: uvx otherwise builds the environment on
rem whatever Python it finds first, which ignores this project's
rem requires-python (>=3.11,<3.13) and lands on 3.13.
uvx --python 3.12 --with-editable . sestudio serve --host 0.0.0.0 --http-port 8081 %*

endlocal
