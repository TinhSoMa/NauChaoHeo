import asyncio
import inspect
import json
import sys
import traceback
from typing import Any, Dict, Iterable, Tuple

MIN_SUPPORTED = (3, 11)


def _write_response(payload: Dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _safe_error(exc: BaseException) -> str:
    return f"{type(exc).__name__}: {exc}"


def _extract_cookie_header(cookies: Iterable[Any]) -> str:
    cookie_map: Dict[str, str] = {}
    for cookie in cookies:
        name = getattr(cookie, "name", "")
        value = getattr(cookie, "value", "")
        if not name or not value:
            continue
        cookie_map[name] = value
    return "; ".join(f"{k}={v}" for k, v in cookie_map.items())


def _parse_browser_priority(value: Any) -> Tuple[str, ...]:
    if isinstance(value, list):
        names = [str(item).strip().lower() for item in value if str(item).strip()]
        if names:
            return tuple(names)
    return ("chrome", "edge")


def _to_json_safe(value: Any) -> Any:
    try:
        return json.loads(json.dumps(value, ensure_ascii=False, default=str))
    except Exception:
        return None


def _normalize_conversation_metadata(value: Any) -> Tuple[Any | None, str | None, Dict[str, Any] | None]:
    debug_info: Dict[str, Any] = {
        "rawType": type(value).__name__ if value is not None else "NoneType",
    }

    if value is None:
        return None, "chat.metadata is None", debug_info

    candidates = [("raw", value)]

    to_dict_fn = getattr(value, "to_dict", None)
    if callable(to_dict_fn):
        try:
            candidates.append(("to_dict", to_dict_fn()))
        except Exception as exc:
            debug_info["toDictError"] = _safe_error(exc)
            return None, f"chat.metadata.to_dict() failed: {_safe_error(exc)}", debug_info

    dict_fn = getattr(value, "dict", None)
    if callable(dict_fn):
        try:
            candidates.append(("dict", dict_fn()))
        except Exception:
            debug_info["dictMethodFailed"] = True

    dict_attr = getattr(value, "__dict__", None)
    if isinstance(dict_attr, dict):
        candidates.append(("__dict__", dict_attr))

    candidate_types = []
    for source_name, candidate in candidates:
        candidate_types.append(f"{source_name}:{type(candidate).__name__}")
        safe_value = _to_json_safe(candidate)
        if isinstance(safe_value, (dict, list)):
            debug_info["resolvedFrom"] = source_name
            if isinstance(safe_value, dict):
                debug_info["resolvedKind"] = "dict"
                debug_info["resolvedKeys"] = list(safe_value.keys())[:12]
            else:
                debug_info["resolvedKind"] = "list"
                debug_info["resolvedLength"] = len(safe_value)
            return safe_value, None, debug_info

    debug_info["candidateTypes"] = candidate_types
    if isinstance(value, (list, tuple)):
        debug_info["rawLength"] = len(value)
    return None, f"Unsupported chat.metadata type={type(value).__name__}", debug_info


async def _close_client(client: Any) -> None:
    close_fn = getattr(client, "close", None)
    if callable(close_fn):
        result = close_fn()
        if inspect.isawaitable(result):
            await result


async def _cmd_health(_: Dict[str, Any]) -> Dict[str, Any]:
    if sys.version_info < MIN_SUPPORTED:
        return {
            "success": False,
            "errorCode": "PYTHON_RUNTIME_MISSING",
            "error": f"Unsupported Python {sys.version.split()[0]} (need 3.11+)",
        }

    modules = {}
    for name in ("gemini_webapi", "browser_cookie3"):
        try:
            __import__(name)
            modules[name] = True
        except Exception:
            modules[name] = False

    if not all(modules.values()):
        return {
            "success": False,
            "errorCode": "PYTHON_MODULE_MISSING",
            "error": "Required modules missing",
            "data": {"pythonVersion": sys.version.split()[0], "modules": modules},
        }

    return {
        "success": True,
        "data": {"pythonVersion": sys.version.split()[0], "modules": modules},
    }


async def _cmd_refresh_cookie(payload: Dict[str, Any]) -> Dict[str, Any]:
    try:
        import browser_cookie3
    except Exception as exc:
        return {
            "success": False,
            "errorCode": "PYTHON_MODULE_MISSING",
            "error": _safe_error(exc),
        }

    priorities = _parse_browser_priority(payload.get("browserPriority"))

    for browser in priorities:
        loader = getattr(browser_cookie3, browser, None)
        if not callable(loader):
            continue
        try:
            cookiejar = loader(domain_name="google.com")
            cookie_header = _extract_cookie_header(cookiejar)
            if not cookie_header:
                continue
            if "__Secure-1PSID=" not in cookie_header or "__Secure-1PSIDTS=" not in cookie_header:
                continue
            return {
                "success": True,
                "data": {
                    "cookie": cookie_header,
                    "sourceBrowser": browser,
                },
            }
        except Exception:
            continue

    return {
        "success": False,
        "errorCode": "COOKIE_NOT_FOUND",
        "error": "Unable to extract Google cookie from browser profiles",
    }


async def _cmd_generate(payload: Dict[str, Any]) -> Dict[str, Any]:
    secure_1psid = str(payload.get("secure1psid") or "").strip()
    secure_1psidts = str(payload.get("secure1psidts") or "").strip()
    prompt = str(payload.get("prompt") or "").strip()
    timeout_ms = int(payload.get("timeoutMs") or 90000)
    proxy = payload.get("proxy")
    temporary = bool(payload.get("temporary"))
    use_chat_session = bool(payload.get("useChatSession"))
    conversation_metadata = payload.get("conversationMetadata")
    if not isinstance(conversation_metadata, (dict, list)):
        conversation_metadata = None

    if not secure_1psid or not secure_1psidts:
        return {
            "success": False,
            "errorCode": "COOKIE_INVALID",
            "error": "Missing __Secure-1PSID or __Secure-1PSIDTS",
        }
    if not prompt:
        return {
            "success": False,
            "errorCode": "GEMINI_REQUEST_FAILED",
            "error": "Prompt is empty",
        }

    try:
        from gemini_webapi import GeminiClient
    except Exception as exc:
        return {
            "success": False,
            "errorCode": "PYTHON_MODULE_MISSING",
            "error": _safe_error(exc),
        }

    client = GeminiClient(secure_1psid, secure_1psidts, proxy=proxy)
    try:
        await client.init(timeout=30, auto_close=False, auto_refresh=True)
        if use_chat_session or conversation_metadata is not None:
            if conversation_metadata is not None:
                chat = client.start_chat(metadata=conversation_metadata)
            else:
                chat = client.start_chat()

            try:
                message_result = chat.send_message(prompt, temporary=temporary)
            except TypeError:
                message_result = chat.send_message(prompt)
            result = await asyncio.wait_for(message_result, timeout=max(1, timeout_ms) / 1000)
        else:
            try:
                content_result = client.generate_content(prompt, temporary=temporary)
            except TypeError:
                content_result = client.generate_content(prompt)
            result = await asyncio.wait_for(content_result, timeout=max(1, timeout_ms) / 1000)

        text = (getattr(result, "text", "") or "").strip()
        chat_metadata = None
        chat_metadata_reason = None
        chat_metadata_debug = None
        if use_chat_session or conversation_metadata is not None:
            metadata_obj = getattr(chat, "metadata", None)
            chat_metadata, chat_metadata_reason, chat_metadata_debug = _normalize_conversation_metadata(metadata_obj)
        return {
            "success": True,
            "data": {
                "text": text,
                "conversationMetadata": chat_metadata,
                "conversationMetadataReason": chat_metadata_reason,
                "conversationMetadataDebug": chat_metadata_debug,
            },
        }
    except asyncio.TimeoutError:
        return {
            "success": False,
            "errorCode": "GEMINI_TIMEOUT",
            "error": f"Gemini timeout after {timeout_ms}ms",
        }
    except Exception as exc:
        return {
            "success": False,
            "errorCode": "GEMINI_REQUEST_FAILED",
            "error": _safe_error(exc),
        }
    finally:
        await _close_client(client)


async def _cmd_shutdown(_: Dict[str, Any]) -> Dict[str, Any]:
    return {"success": True, "data": {"stopped": True}}


async def _dispatch(command: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    if command == "health":
        return await _cmd_health(payload)
    if command == "refresh_cookie":
        return await _cmd_refresh_cookie(payload)
    if command == "generate":
        return await _cmd_generate(payload)
    if command == "shutdown":
        return await _cmd_shutdown(payload)
    return {
        "success": False,
        "errorCode": "GEMINI_REQUEST_FAILED",
        "error": f"Unknown command: {command}",
    }


def _handle_line(raw_line: str) -> bool:
    line = raw_line.strip()
    if not line:
        return True

    try:
        request = json.loads(line)
    except Exception as exc:
        _write_response(
            {
                "requestId": "",
                "success": False,
                "errorCode": "GEMINI_REQUEST_FAILED",
                "error": f"Invalid JSON: {_safe_error(exc)}",
            }
        )
        return True

    request_id = str(request.get("requestId") or "")
    command = str(request.get("command") or "").strip()
    payload = request.get("payload") or {}
    if not isinstance(payload, dict):
        payload = {}

    try:
        response = asyncio.run(_dispatch(command, payload))
    except Exception as exc:
        response = {
            "success": False,
            "errorCode": "GEMINI_REQUEST_FAILED",
            "error": _safe_error(exc),
            "trace": traceback.format_exc(limit=1),
        }

    response["requestId"] = request_id
    _write_response(response)

    if command == "shutdown":
        return False
    return True


def main() -> int:
    for line in sys.stdin:
        keep_running = _handle_line(line)
        if not keep_running:
            return 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
