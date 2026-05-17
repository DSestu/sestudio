@echo off
cd /d "%~dp0"
uv sync
uv run python -c "from fstream_dl.config import load_config, save_config; c = load_config(); c.output_root = r'R:\Video\films-series'; save_config(c)"
uv run python -m fstream_dl serve --port 8081 %*
