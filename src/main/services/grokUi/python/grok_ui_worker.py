import json
import os
import sys
import traceback
from typing import Any, Dict, Optional

MIN_SUPPORTED = (3, 8)

_client = None
_client_config: Dict[str, Any] = {}


def _write_response(payload: Dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _safe_error(exc: BaseException) -> str:
    return f"{type(exc).__name__}: {exc}"


def _reset_client() -> None:
    global _client, _client_config
    try:
        from grok3api import driver
        driver.web_driver.close_driver()
    except Exception:
        pass
    _client = None
    _client_config = {}


def _ensure_client(config: Dict[str, Any]):
    global _client, _client_config
    if _client is not None and _client_config == config:
        return _client

    _reset_client()

    anonymous = bool(config.get("anonymous"))
    profile_dir = "" if anonymous else (config.get("profileDir") or "")
    profile_name = "" if anonymous else (config.get("profileName") or "")
    if profile_dir:
        os.environ["GROK_CHROME_PROFILE_DIR"] = str(profile_dir)
    if profile_name:
        os.environ["GROK_CHROME_PROFILE_NAME"] = str(profile_name)

    try:
        from grok3api.client import GrokClient
        timeout_sec = int(config.get("timeoutSec") or 120)
        _client = GrokClient(ui=True, anonymous=anonymous, timeout=timeout_sec)
        _client_config = dict(config)
        return _client
    except Exception as exc:
        _reset_client()
        raise exc


def _cmd_health(_: Dict[str, Any]) -> Dict[str, Any]:
    if sys.version_info < MIN_SUPPORTED:
        return {
            "success": False,
            "error": f"Unsupported Python {sys.version.split()[0]} (need 3.8+)",
            "data": {"pythonVersion": sys.version.split()[0], "modules": {}},
        }

    modules = {}
    for name in ("grok3api", "undetected_chromedriver"):
        try:
            __import__(name)
            modules[name] = True
        except Exception:
            modules[name] = False

    if not all(modules.values()):
        return {
            "success": False,
            "error": "Required modules missing",
            "data": {"pythonVersion": sys.version.split()[0], "modules": modules},
        }

    return {
        "success": True,
        "data": {"pythonVersion": sys.version.split()[0], "modules": modules},
    }


def _cmd_ask(payload: Dict[str, Any]) -> Dict[str, Any]:
    prompt = str(payload.get("prompt") or "").strip()
    if not prompt:
        return {"success": False, "error": "Prompt is empty"}

    timeout_ms = int(payload.get("timeoutMs") or 120000)
    timeout_sec = max(5, int(timeout_ms / 1000))
    anonymous = bool(payload.get("anonymous"))
    profile_dir = str(payload.get("profileDir") or "").strip()
    profile_name = str(payload.get("profileName") or "").strip()
    if anonymous:
        profile_dir = ""
        profile_name = ""

    config = {
        "profileDir": profile_dir,
        "profileName": profile_name,
        "anonymous": anonymous,
        "timeoutSec": timeout_sec,
    }

    try:
        client = _ensure_client(config)
        response = client.ask(message=prompt, timeout=timeout_sec, ui=True)
        error_text = getattr(response, "error", None)
        if error_text:
            return {"success": False, "error": str(error_text)}

        text = ""
        model_response = getattr(response, "modelResponse", None)
        if model_response is not None:
            text = str(getattr(model_response, "message", "") or "")

        if not text.strip():
            return {"success": False, "error": "Empty response from Grok UI"}

        return {"success": True, "data": {"text": text}}
    except Exception as exc:
        return {"success": False, "error": _safe_error(exc)}


def main() -> None:
    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue

        try:
            envelope = json.loads(line)
        except Exception:
            continue

        request_id = envelope.get("requestId")
        command = envelope.get("command")
        payload = envelope.get("payload") or {}

        if not request_id:
            continue

        try:
            if command == "health":
                result = _cmd_health(payload)
            elif command == "ask":
                result = _cmd_ask(payload)
            elif command == "shutdown":
                _reset_client()
                result = {"success": True}
                _write_response({**result, "requestId": request_id})
                break
            else:
                result = {"success": False, "error": f"Unknown command: {command}"}
        except Exception as exc:
            result = {"success": False, "error": _safe_error(exc), "trace": traceback.format_exc()}

        _write_response({**result, "requestId": request_id})

    _reset_client()


if __name__ == "__main__":
    main()
