from __future__ import annotations

import contextvars
import json
import logging
import logging.config
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_request_id: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="-")
_reserved_record_keys = frozenset(logging.makeLogRecord({}).__dict__.keys()) | {"message", "asctime"}


class RequestIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = _request_id.get()
        return True


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": datetime.fromtimestamp(record.created, timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "request_id": getattr(record, "request_id", "-"),
        }
        extras = {
            key: value
            for key, value in record.__dict__.items()
            if key not in _reserved_record_keys and key != "request_id"
        }
        if extras:
            payload["extra"] = extras
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


def _normalize_log_level(value: str | None) -> str:
    mapping = logging.getLevelNamesMapping()
    candidate = (value or "INFO").strip().upper()
    return candidate if candidate in mapping else "INFO"


def _env_flag(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() not in {"0", "false", "no", "off"}


def _env_int(name: str, default: int, minimum: int = 1) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return max(minimum, int(raw))
    except ValueError:
        return default


def _log_file_path() -> Path:
    log_dir = Path(os.getenv("LOG_DIR", str(Path.home() / ".editian" / "logs"))).expanduser()
    log_dir.mkdir(parents=True, exist_ok=True)
    filename = (os.getenv("LOG_FILE_NAME", "backend.log") or "backend.log").strip()
    return log_dir / filename


def _rotation_when() -> str:
    value = (os.getenv("LOG_ROTATION_WHEN", "midnight") or "midnight").strip().lower()
    allowed = {"s", "m", "h", "d", "midnight", "w0", "w1", "w2", "w3", "w4", "w5", "w6"}
    return value if value in allowed else "midnight"


def setup_logging() -> None:
    level = _normalize_log_level(os.getenv("LOG_LEVEL", "INFO"))
    requested_format = (os.getenv("LOG_FORMAT", "text") or "text").strip().lower()
    formatter = "json" if requested_format == "json" else "text"
    log_to_file = _env_flag("LOG_TO_FILE", True)
    file_path = _log_file_path()
    rotation_when = _rotation_when()
    rotation_interval = _env_int("LOG_ROTATION_INTERVAL", 1)
    backup_count = _env_int("LOG_BACKUP_COUNT", 14)
    use_utc = _env_flag("LOG_ROTATION_UTC", False)
    handlers = ["stdout"]
    logger_handlers = ["stdout"]

    if log_to_file:
        handlers.append("file")
        logger_handlers.append("file")

    logging.config.dictConfig(
        {
            "version": 1,
            "disable_existing_loggers": False,
            "filters": {
                "request_id": {
                    "()": f"{__name__}.RequestIdFilter",
                }
            },
            "formatters": {
                "text": {
                    "format": "%(asctime)s %(levelname)s [%(name)s] [request_id=%(request_id)s] %(message)s",
                    "datefmt": "%Y-%m-%d %H:%M:%S",
                },
                "json": {
                    "()": f"{__name__}.JsonFormatter",
                },
            },
            "handlers": {
                "stdout": {
                    "class": "logging.StreamHandler",
                    "stream": "ext://sys.stdout",
                    "filters": ["request_id"],
                    "formatter": formatter,
                },
                "file": {
                    "class": "logging.handlers.TimedRotatingFileHandler",
                    "filename": str(file_path),
                    "when": rotation_when,
                    "interval": rotation_interval,
                    "backupCount": backup_count,
                    "encoding": "utf-8",
                    "utc": use_utc,
                    "filters": ["request_id"],
                    "formatter": formatter,
                },
            },
            "root": {
                "handlers": handlers,
                "level": level,
            },
            "loggers": {
                "uvicorn": {
                    "handlers": logger_handlers,
                    "level": level,
                    "propagate": False,
                },
                "uvicorn.error": {
                    "handlers": logger_handlers,
                    "level": level,
                    "propagate": False,
                },
                "uvicorn.access": {
                    "handlers": logger_handlers,
                    "level": level,
                    "propagate": False,
                },
            },
        }
    )

    logging.getLogger(__name__).info(
        "logging configured level=%s format=%s file_logging=%s log_file=%s rotation_when=%s rotation_interval=%s backup_count=%s rotation_utc=%s",
        level,
        formatter,
        log_to_file,
        file_path if log_to_file else "-",
        rotation_when,
        rotation_interval,
        backup_count,
        use_utc,
    )


def set_request_id(request_id: str) -> contextvars.Token[str]:
    return _request_id.set(request_id)


def get_request_id() -> str:
    return _request_id.get()


def reset_request_id(token: contextvars.Token[str]) -> None:
    _request_id.reset(token)


def clear_request_id() -> None:
    _request_id.set("-")
