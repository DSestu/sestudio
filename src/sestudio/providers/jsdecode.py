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

Safety: the body is attacker-controlled, so it runs in a fresh QuickJS context
with no host bindings, a wall-clock limit and a memory cap. That is sound here
because the construct is a pure string→string transform — it needs no DOM, no
network and no filesystem. QuickJS is not a browser, so `atob` does not exist
and is shimmed below; nothing else is injected.

The engine is an optional dependency: if `quickjs` will not import, callers fall
back to the pattern enumeration in vidzy.py rather than failing outright.
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

try:  # pragma: no cover - exercised by whichever branch the environment takes
    import quickjs

    ENGINE_AVAILABLE = True
except ImportError:  # pragma: no cover
    quickjs = None  # type: ignore[assignment]
    ENGINE_AVAILABLE = False

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


def run_inline_decoder(body: str, payload_b64: str) -> str | None:
    """Evaluate `(function(s){<body>})("<payload_b64>")` and return its result.

    Returns None — never raises — when the engine is absent or the body fails to
    run, so the caller can fall back to pattern matching. The payload is passed
    in as a bound variable rather than interpolated into the source, so it cannot
    terminate the string literal and inject code of its own.
    """
    if quickjs is None:
        return None

    try:
        ctx = quickjs.Context()
        ctx.set_memory_limit(_MEMORY_LIMIT_BYTES)
        ctx.set_time_limit(_TIME_LIMIT_SECONDS)
        ctx.set_max_stack_size(_MAX_STACK_BYTES)
        ctx.eval(_ATOB_SHIM)
        ctx.set("__payload", payload_b64)
        result = ctx.eval(f"(function(s){{{body}}})(__payload)")
    except Exception as exc:  # noqa: BLE001 - any engine failure is a fallback
        logger.debug("Inline decoder failed to execute in QuickJS: %s", exc)
        return None

    if not isinstance(result, str):
        logger.debug("Inline decoder returned %s, not a string", type(result).__name__)
        return None
    return result
