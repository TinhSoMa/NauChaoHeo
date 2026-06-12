import logging
import os
import sys
from typing import Optional

logger = logging.getLogger("grok3api")

_DEFAULT_FORMAT = "[%(asctime)s] [%(levelname)s] [%(name)s]: %(message)s"
_ENV_LEVEL = "GROK3API_LOG_LEVEL"
_ENV_FILE = "GROK3API_LOG_FILE"
_ENV_DIAG = "GROK3API_LOG_DIAG"


def _parse_log_level(value: Optional[str]) -> int:
    if not value:
        return logging.INFO
    level_name = value.strip().upper()
    return logging._nameToLevel.get(level_name, logging.INFO)


def setup_logging() -> None:
    """
    Thiết lập logging cho grok3api.
    - Mặc định: INFO
    - Có thể override bằng env GROK3API_LOG_LEVEL
    - Có thể ghi file qua env GROK3API_LOG_FILE
    """
    level = _parse_log_level(os.getenv(_ENV_LEVEL))
    logger.setLevel(level)

    formatter = logging.Formatter(_DEFAULT_FORMAT)

    has_stream = any(getattr(h, "_grok3api_stream", False) for h in logger.handlers)
    if not has_stream:
        console_handler = logging.StreamHandler(stream=sys.stdout)
        console_handler.setLevel(level)
        console_handler.setFormatter(formatter)
        console_handler._grok3api_stream = True  # type: ignore[attr-defined]
        logger.addHandler(console_handler)

    log_file = os.getenv(_ENV_FILE)
    if log_file:
        has_file = any(getattr(h, "_grok3api_file", False) for h in logger.handlers)
        if not has_file:
            file_handler = logging.FileHandler(log_file, encoding="utf-8")
            file_handler.setLevel(level)
            file_handler.setFormatter(formatter)
            file_handler._grok3api_file = True  # type: ignore[attr-defined]
            logger.addHandler(file_handler)

    logger.propagate = False
    logger.info(f"Logging bật (level={logging.getLevelName(level)})")

    if os.getenv(_ENV_DIAG, "").strip() == "1":
        try:
            import grok3api as _grok3api
            print(f"[diag] sys.executable={sys.executable}")
            print(f"[diag] grok3api.__file__={_grok3api.__file__}")
        except Exception as e:
            print(f"[diag] grok3api import error: {e}")
        print(f"[diag] logger.level={logger.level}")
        print(f"[diag] handlers={len(logger.handlers)}")
        for h in logger.handlers:
            stream = getattr(h, "stream", None)
            stream_name = getattr(stream, "name", None) if stream else None
            print(f"[diag] handler={type(h).__name__} level={h.level} stream={stream_name}")
        print(f"[diag] env { _ENV_LEVEL }={os.getenv(_ENV_LEVEL)}")
        print(f"[diag] env { _ENV_FILE }={os.getenv(_ENV_FILE)}")


# Tự động bật log khi import module
setup_logging()
