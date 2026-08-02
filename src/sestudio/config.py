from __future__ import annotations

import json
import logging
import os
from dataclasses import asdict, dataclass
from pathlib import Path

logger = logging.getLogger(__name__)

_CONFIG_PATH = Path.home() / ".config" / "sestudio" / "config.json"


@dataclass
class AppConfig:
    output_root: str = "."
    lang: str = "vf"
    # Web UI default download destination: "server" (job queue on the server's
    # disk) or "device" (forwarded to the browser as a file download).
    download_destination: str = "server"


def _config_path() -> Path:
    env = os.environ.get("SESTUDIO_CONFIG")
    return Path(env) if env else _CONFIG_PATH


def load_config() -> AppConfig:
    path = _config_path()
    if not path.exists():
        return AppConfig()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return AppConfig(
            output_root=str(data.get("output_root", ".")),
            lang=str(data.get("lang", "vf")),
            download_destination=str(data.get("download_destination", "server")),
        )
    except Exception as exc:
        logger.warning("Failed to read config at %s (%s), using defaults", path, exc)
        return AppConfig()


def save_config(cfg: AppConfig) -> None:
    path = _config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(asdict(cfg), indent=2), encoding="utf-8")
    tmp.replace(path)
    logger.debug("Config saved to %s", path)
