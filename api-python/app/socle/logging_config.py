"""Logging structuré JSON compatible Cloud Logging."""

import json
import logging
import sys
from contextvars import ContextVar
from datetime import datetime, timezone

# Portée par chaque requête HTTP ; None en dehors d'un contexte de requête.
request_id_var: ContextVar[str | None] = ContextVar("request_id", default=None)

_SEVERITY: dict[int, str] = {
    logging.DEBUG: "DEBUG",
    logging.INFO: "INFO",
    logging.WARNING: "WARNING",
    logging.ERROR: "ERROR",
    logging.CRITICAL: "CRITICAL",
}


class _JsonFormatter(logging.Formatter):
    """Formate chaque enregistrement en JSON sur une ligne (Cloud Logging)."""

    def format(self, record: logging.LogRecord) -> str:
        ts = (
            datetime.fromtimestamp(record.created, tz=timezone.utc)
            .isoformat()
            .replace("+00:00", "Z")
        )
        payload: dict = {
            "severity": _SEVERITY.get(record.levelno, "DEFAULT"),
            "message": record.getMessage(),
            "logger": record.name,
            "timestamp": ts,
            "requestId": request_id_var.get(),
        }
        # Champs structurés additionnels (ex. audit) passés via extra={"audit_fields": {...}}
        audit_fields = getattr(record, "audit_fields", None)
        if audit_fields:
            payload.update(audit_fields)
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


def setup_logging(level: str = "INFO") -> None:
    """Configure le root logger : handler JSON sur stdout, handlers existants retirés."""
    root = logging.getLogger()
    root.handlers.clear()
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(_JsonFormatter())
    root.addHandler(handler)
    root.setLevel(level)