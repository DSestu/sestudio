"""Execute an embed's own inline `src:` decoder instead of reimplementing it.

Vidzy (and fsvid.lol, via premium.py) obfuscate the real m3u8 URL behind an
inline `src:(function(s){…})("<base64>")` construct whose scheme rotates. Every
pattern-matching decoder is therefore reactive: it survives recombinations of
primitives it already knows and breaks the moment a genuinely new derivation
appears — a key that isn't linear in `i`, a second XOR pass, a reversal moved to
the other side of the XOR (which is exactly what broke the enumerator once).

Running the function instead removes the modelling problem entirely: any
arithmetic the embed invents works for free, because we are not describing the
transform, we are evaluating it.

Safety: the body is attacker-controlled, so it runs in a fresh context with no
host bindings, a wall-clock limit and a memory cap. That is sound here because
the construct is a pure string→string transform — it needs no DOM, no network
and no filesystem. Neither engine is a browser, so `atob` does not exist and is
shimmed below; nothing else is injected.

Two engines are supported, because neither covers every platform on its own:

* QuickJS — tiny and preferred, but ships no Windows wheel, and building it
  there fails (its setup.py passes a GCC-only flag that MSVC rejects).
* MiniRacer (V8) — a much larger download, but publishes an ABI-agnostic
  `py3-none-win_amd64` wheel, so Windows needs no compiler at all.

Both enforce the same time and memory caps, so the safety argument above holds
either way. The engine is optional: with neither installed, callers fall back to
the pattern enumeration in vidzy.py rather than failing outright.
"""

from __future__ import annotations

import json
import logging

logger = logging.getLogger(__name__)

try:  # pragma: no cover - exercised by whichever branch the environment takes
    import quickjs
except ImportError:  # pragma: no cover
    quickjs = None  # type: ignore[assignment]

try:  # pragma: no cover - the Windows engine; absent where QuickJS builds
    from py_mini_racer import MiniRacer
except ImportError:  # pragma: no cover
    MiniRacer = None  # type: ignore[assignment,misc]

ENGINE_AVAILABLE = quickjs is not None or MiniRacer is not None
# Named for diagnostics — which engine a machine ended up with is the first
# thing worth knowing when a decode works on one box and not another.
ENGINE_NAME = "quickjs" if quickjs is not None else "mini_racer" if MiniRacer else ""

# Generous enough for any decoder seen in the wild, small enough that a runaway
# or memory-bomb body dies instead of taking the server with it.
_MEMORY_LIMIT_BYTES = 32 * 1024 * 1024
_TIME_LIMIT_SECONDS = 2
_MAX_STACK_BYTES = 1024 * 1024

# Browser built-in the decoders rely on; QuickJS has no DOM globals.
_ATOB_SHIM = """
var atob=function(input){
  var chars="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var str=String(input),out="",bs=0,bc=0;
  for(var i=0;i<str.length;i++){
    var c=chars.indexOf(str.charAt(i));
    if(c===-1)continue;
    bs=(bs<<6)|c;bc+=6;
    if(bc>=8){bc-=8;out+=String.fromCharCode((bs>>bc)&255)}
  }
  return out};
"""


def _run_quickjs(body: str, payload_b64: str) -> object:
    """Run the decoder in QuickJS, with the payload bound as a variable.

    Binding rather than interpolating means the payload cannot terminate a string
    literal and inject code of its own.
    """
    ctx = quickjs.Context()
    ctx.set_memory_limit(_MEMORY_LIMIT_BYTES)
    ctx.set_time_limit(_TIME_LIMIT_SECONDS)
    ctx.set_max_stack_size(_MAX_STACK_BYTES)
    ctx.eval(_ATOB_SHIM)
    ctx.set("__payload", payload_b64)
    return ctx.eval(f"(function(s){{{body}}})(__payload)")


def _run_mini_racer(body: str, payload_b64: str) -> object:
    """Run the decoder in MiniRacer, with the payload as a JSON literal.

    MiniRacer has no variable-binding call, so the payload has to travel inside
    the source. `json.dumps` is the safe way to do that: it escapes quotes and
    backslashes, and its default ensure_ascii also escapes U+2028/U+2029, which
    are legal in JSON strings but terminate a line in JavaScript.
    """
    ctx = MiniRacer()
    return ctx.eval(
        f"{_ATOB_SHIM}\n(function(s){{{body}}})({json.dumps(payload_b64)})",
        timeout_sec=_TIME_LIMIT_SECONDS,
        max_memory=_MEMORY_LIMIT_BYTES,
    )


def run_inline_decoder(body: str, payload_b64: str) -> str | None:
    """Evaluate `(function(s){<body>})("<payload_b64>")` and return its result.

    Returns None — never raises — when no engine is installed or the body fails
    to run, so the caller can fall back to pattern matching.
    """
    if quickjs is not None:
        runner = _run_quickjs
    elif MiniRacer is not None:
        runner = _run_mini_racer
    else:
        return None

    try:
        result = runner(body, payload_b64)
    except Exception as exc:  # noqa: BLE001 - any engine failure is a fallback
        logger.debug("Inline decoder failed to execute in %s: %s", ENGINE_NAME, exc)
        return None

    if not isinstance(result, str):
        logger.debug("Inline decoder returned %s, not a string", type(result).__name__)
        return None
    return result
