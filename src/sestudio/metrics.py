"""What the machine is doing, for the live graphs shown while AI draws frames."""

from __future__ import annotations

import subprocess
from typing import Any

import psutil

from sestudio import interpolate


def gpu() -> dict[str, float] | None:
    """Load (%) and memory (bytes) of the first NVIDIA GPU. None for any other:
    AMD, Intel and Apple have no tool to ask that works the same everywhere."""
    smi = interpolate.nvidia_smi()
    if smi is None:
        return None
    try:
        out = subprocess.run(
            [
                smi,
                "--query-gpu=utilization.gpu,memory.used,memory.total",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=5,
            check=True,
        ).stdout
        load, used, total = (float(v) for v in out.splitlines()[0].split(","))
    except (OSError, subprocess.SubprocessError, ValueError, IndexError):
        return None
    return {"load": load, "used": used * 2**20, "total": total * 2**20}


def system() -> dict[str, Any]:
    """CPU load (%) since the last call, memory in use, and the GPU's."""
    memory = psutil.virtual_memory()
    return {
        "cpu": psutil.cpu_percent(None),
        "memory": {"used": memory.total - memory.available, "total": memory.total},
        "gpu": gpu(),
    }
