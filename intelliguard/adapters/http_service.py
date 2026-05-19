from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable
from urllib.parse import urljoin


class ConnectorPolicyError(ValueError):
    pass


@dataclass(frozen=True)
class ServiceConnectorResult:
    ok: bool
    status_code: int | None = None
    data: Any = None
    error: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


Transport = Callable[[dict[str, Any]], dict[str, Any]]


def validate_connector_record(record: dict[str, Any]) -> dict[str, Any]:
    if not record.get("environment"):
        raise ValueError("Service connector environment is required")
    if not record.get("owner"):
        raise ValueError("Service connector owner is required")
    config = record.get("config") if isinstance(record.get("config"), dict) else {}
    secrets = config.get("secrets") if isinstance(config.get("secrets"), dict) else {}
    for key, value in secrets.items():
        if not key.endswith("_ref") or not str(value).startswith("secret://"):
            raise ValueError("Secrets must be stored by reference only")
    allowed_operations = config.get("allowed_operations")
    if not isinstance(allowed_operations, dict) or not allowed_operations:
        raise ValueError("Service connector allowed_operations are required")
    return {**record, "config": config}


def connector_tool_metadata(connector_id: str, operation: str) -> dict[str, str]:
    return {
        "connector_id": connector_id,
        "connector_operation": operation,
        "execution_boundary": "service_connector",
    }


class HttpServiceConnector:
    def __init__(self, record: dict[str, Any], transport: Transport | None = None) -> None:
        self.record = validate_connector_record(record)
        self.transport = transport or _unsupported_transport

    def execute(self, operation: str, payload: dict[str, Any]) -> ServiceConnectorResult:
        operation_config = self._operation_config(operation)
        method = str(operation_config.get("method") or "GET").upper()
        path = str(operation_config.get("path") or "")
        url = urljoin(
            str(self.record["config"].get("base_url") or "").rstrip("/") + "/",
            path.lstrip("/").format(**payload),
        )
        request = {
            "method": method,
            "url": url,
            "json": payload if method not in {"GET", "HEAD"} else None,
            "timeout_seconds": int(self.record["config"].get("timeout_seconds") or 10),
            "metadata": connector_tool_metadata(self.record["connector_id"], operation),
        }
        try:
            response = self.transport(request)
        except Exception as exc:
            return ServiceConnectorResult(
                ok=False,
                error=str(exc),
                metadata={**request["metadata"], "retryable": True},
            )
        status_code = int(response.get("status_code") or 0)
        return ServiceConnectorResult(
            ok=200 <= status_code < 300,
            status_code=status_code,
            data=response.get("json"),
            error=response.get("error"),
            metadata=request["metadata"],
        )

    def _operation_config(self, operation: str) -> dict[str, Any]:
        allowed = self.record["config"].get("allowed_operations") or {}
        if operation not in allowed:
            raise ConnectorPolicyError(f"Connector operation {operation!r} is not allow-listed")
        config = allowed[operation]
        if not isinstance(config, dict):
            raise ConnectorPolicyError(f"Connector operation {operation!r} is invalid")
        return config


def _unsupported_transport(_request: dict[str, Any]) -> dict[str, Any]:
    raise RuntimeError("No HTTP transport configured for service connector execution")
