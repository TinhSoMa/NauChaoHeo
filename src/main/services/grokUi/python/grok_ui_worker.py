import json
import os
import sys
import traceback
from typing import Any, Dict, Optional

MIN_SUPPORTED = (3, 8)

_client = None
_client_config: Dict[str, Any] = {}
_logged_module_path = False
_logged_env_info = False


def _apply_dev_sys_path() -> None:
    if os.environ.get("GROK_UI_DEV_MODE") != "1":
        return
    dev_path = os.environ.get("GROK_UI_DEV_PYTHONPATH", "").strip()
    if not dev_path:
        return
    first_path = dev_path.split(os.pathsep)[0]
    if first_path and first_path not in sys.path:
        sys.path.insert(0, first_path)


def _log_env_info_once() -> None:
    global _logged_env_info
    if _logged_env_info:
        return
    py_path = os.environ.get("PYTHONPATH", "")
    dev_path = os.environ.get("GROK_UI_DEV_PYTHONPATH", "")
    sys.stdout.write(f"[INFO] worker PYTHONPATH: {py_path}\n")
    if dev_path:
        sys.stdout.write(f"[INFO] worker GROK_UI_DEV_PYTHONPATH: {dev_path}\n")
    sys.stdout.write(f"[INFO] worker sys.path[0:3]: {sys.path[:3]}\n")
    sys.stdout.flush()
    _logged_env_info = True


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
    global _client, _client_config, _logged_module_path
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
        if not _logged_module_path:
            try:
                import grok3api
                sys.stdout.write(f"[INFO] grok3api module: {getattr(grok3api, '__file__', 'unknown')}\n")
                sys.stdout.flush()
            except Exception:
                pass
            _logged_module_path = True
        timeout_sec = int(config.get("timeoutSec") or 120)
        _client = GrokClient(ui=True, anonymous=anonymous, timeout=timeout_sec)
        _client_config = dict(config)
        return _client
    except Exception as exc:
        _reset_client()
        raise exc


def _is_rate_limit_message(message: Optional[str]) -> bool:
    if not message:
        return False
    text = str(message).lower()
    return (
        "message limit reached" in text
        or "heavy usage" in text
        or "too many requests" in text
        or "rate limit" in text
        or "đã đạt giới hạn" in text
        or "vui lòng nâng cấp" in text
        or "vui lòng thử lại" in text
        or "quá tải" in text
        or "giới hạn" in text
    )


def _is_upgrade_warning(message: Optional[str]) -> bool:
    if not message:
        return False
    text = str(message).lower()
    return (
        "upgrade to supergrok" in text
        or "supergrok" in text
        or "vui lòng nâng cấp" in text
    )


def _emit_rate_limit(message: Optional[str]) -> Dict[str, Any]:
    msg = str(message or "rate_limited")
    sys.stdout.write(f"[WARN] rate_limit_detected: {msg}\n")
    sys.stdout.flush()
    return {"success": False, "error": {"error_code": "rate_limited", "error": msg}}


def _emit_rate_limit_with_raw(message: Optional[str], raw_text: Optional[str]) -> Dict[str, Any]:
    msg = str(message or "rate_limited")
    payload: Dict[str, Any] = {"error_code": "rate_limited", "error": msg}
    if isinstance(raw_text, str):
        payload["raw_text"] = raw_text
    sys.stdout.write(f"[WARN] rate_limit_detected: {msg}\n")
    sys.stdout.flush()
    return {"success": False, "error": payload}


def _cmd_health(_: Dict[str, Any]) -> Dict[str, Any]:
    if sys.version_info < MIN_SUPPORTED:
        return {
            "success": False,
            "error": f"Unsupported Python {sys.version.split()[0]} (need 3.8+)",
            "data": {"pythonVersion": sys.version.split()[0], "modules": {}},
        }

    modules = {}
    module_paths = {}
    for name in ("grok3api", "undetected_chromedriver"):
        try:
            module = __import__(name)
            modules[name] = True
            module_paths[name] = getattr(module, "__file__", None)
        except Exception:
            modules[name] = False
            module_paths[name] = None

    if not all(modules.values()):
        return {
            "success": False,
            "error": "Required modules missing",
            "data": {
                "pythonVersion": sys.version.split()[0],
                "modules": modules,
                "modulePaths": module_paths,
            },
        }

    return {
        "success": True,
        "data": {
            "pythonVersion": sys.version.split()[0],
            "modules": modules,
            "modulePaths": module_paths,
        },
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
        text: Optional[str] = None
        model_response = getattr(response, "modelResponse", None)
        if model_response is not None:
            raw_message = getattr(model_response, "message", None)
            if isinstance(raw_message, str):
                text = raw_message
            elif raw_message is not None:
                text = str(raw_message)

        error_payload = getattr(response, "error_payload", None)
        error_text = getattr(response, "error", None)

        payload_message = None
        payload_code = None
        if isinstance(error_payload, dict):
            payload_code = error_payload.get("error_code") or error_payload.get("errorCode")
            payload_message = error_payload.get("error") or str(error_payload)
        if isinstance(error_text, dict):
            payload_code = payload_code or error_text.get("error_code") or error_text.get("errorCode")
            payload_message = payload_message or error_text.get("error") or str(error_text)
        if payload_code == "rate_limited" or _is_rate_limit_message(payload_message or ""):
            return _emit_rate_limit_with_raw(payload_message or "rate_limited", text)
        if isinstance(error_text, str) and _is_rate_limit_message(error_text):
            return _emit_rate_limit_with_raw(error_text, text)

        if text is not None:
            try:
                from grok3api import driver
                ui_error = driver.web_driver._detect_ui_error()
                if ui_error and _is_rate_limit_message(ui_error):
                    return _emit_rate_limit_with_raw(ui_error, text)
            except Exception:
                pass

            if not text.strip().startswith("{") and _is_rate_limit_message(text):
                return _emit_rate_limit_with_raw(text, text)

            if error_payload or error_text:
                sys.stdout.write("[WARN] Grok UI response has warning metadata, raw text is preserved\n")
                sys.stdout.flush()

            return {"success": True, "data": {"rawText": text, "text": text}}

        if isinstance(error_payload, dict) and error_payload:
            return {"success": False, "error": error_payload}
        if error_text:
            if isinstance(error_text, dict):
                return {"success": False, "error": error_text}
            plain_error: Dict[str, Any] = {"error": str(error_text)}
            try:
                error_code = getattr(error_text, "error_code", None)
                error_message = getattr(error_text, "error", None)
                if error_code:
                    plain_error["error_code"] = error_code
                if error_message:
                    plain_error["error"] = error_message
            except Exception:
                pass
            return {"success": False, "error": plain_error}

        return {"success": False, "error": "Empty response from Grok UI"}
    except Exception as exc:
        return {"success": False, "error": _safe_error(exc)}


def _cmd_create_profile(payload: Dict[str, Any]) -> Dict[str, Any]:
    try:
        from grok3api import driver
        profile_dir = payload.get("profileDir") or None
        profile_name = payload.get("profileName") or None
        allow_existing = bool(payload.get("allowExisting", True))

        created_dir, created_name = driver.create_profile(
            profile_name=profile_name,
            profile_dir=profile_dir,
            allow_existing=allow_existing,
        )
        return {
            "success": True,
            "data": {
                "profileDir": created_dir,
                "profileName": created_name,
                "profilePath": os.path.join(created_dir, created_name),
            },
        }
    except Exception as exc:
        return {"success": False, "error": _safe_error(exc)}


def main() -> None:
    _apply_dev_sys_path()
    _log_env_info_once()
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
            elif command == "create_profile":
                result = _cmd_create_profile(payload)
            elif command == "close_driver":
                _reset_client()
                result = {"success": True}
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
