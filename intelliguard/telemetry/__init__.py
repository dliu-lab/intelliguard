from __future__ import annotations

import base64
import json
import os
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any, Iterator

from fastapi import FastAPI
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor, ConsoleSpanExporter
from opentelemetry.trace import Span, SpanKind, Status, StatusCode


DEFAULT_SERVICE_NAME = "intelliguard"
DEFAULT_OTLP_HTTP_ENDPOINT: str | None = None
DEFAULT_LANGFUSE_HOST = "https://cloud.langfuse.com"
_TRACER_NAME = "intelliguard.telemetry"
_TRUE_VALUES = {"1", "true", "yes", "on"}
_initialized = False
_provider: TracerProvider | None = None
_instrumented_apps: set[int] = set()


@dataclass(frozen=True)
class TelemetryStatus:
    enabled: bool
    initialized: bool
    service_name: str
    service_version: str
    deployment_environment: str
    traces_exporter: str
    traces_endpoint: str | None

    def to_dict(self) -> dict[str, Any]:
        return {
            "enabled": self.enabled,
            "initialized": self.initialized,
            "service_name": self.service_name,
            "service_version": self.service_version,
            "deployment_environment": self.deployment_environment,
            "traces_exporter": self.traces_exporter,
            "traces_endpoint": self.traces_endpoint,
            "current_trace_id": current_trace_id(),
        }


def init_telemetry(
    *,
    service_name: str = DEFAULT_SERVICE_NAME,
    service_version: str = "0.1.0",
    deployment_environment: str = "local",
) -> TelemetryStatus:
    global _initialized, _provider

    status = telemetry_status(
        default_service_name=service_name,
        default_service_version=service_version,
        default_deployment_environment=deployment_environment,
    )
    if _initialized or not status.enabled:
        return status

    resource = Resource.create(
        {
            "service.name": status.service_name,
            "service.version": status.service_version,
            "deployment.environment": status.deployment_environment,
        }
    )
    provider = TracerProvider(resource=resource)
    exporter = _build_span_exporter(status)
    if exporter is not None:
        provider.add_span_processor(BatchSpanProcessor(exporter))
    trace.set_tracer_provider(provider)
    _provider = provider
    _initialized = True
    return telemetry_status(
        default_service_name=service_name,
        default_service_version=service_version,
        default_deployment_environment=deployment_environment,
    )


def instrument_fastapi(app: FastAPI) -> TelemetryStatus:
    status = init_telemetry(service_name=os.getenv("OTEL_SERVICE_NAME", "intelliguard-api"))
    if status.enabled and id(app) not in _instrumented_apps:
        FastAPIInstrumentor.instrument_app(app, tracer_provider=_provider)
        _instrumented_apps.add(id(app))
    return status


def telemetry_status(
    *,
    default_service_name: str = DEFAULT_SERVICE_NAME,
    default_service_version: str = "0.1.0",
    default_deployment_environment: str = "local",
) -> TelemetryStatus:
    exporter = _traces_exporter()
    return TelemetryStatus(
        enabled=_telemetry_enabled(),
        initialized=_initialized,
        service_name=os.getenv("OTEL_SERVICE_NAME", default_service_name),
        service_version=os.getenv("OTEL_SERVICE_VERSION", default_service_version),
        deployment_environment=os.getenv(
            "OTEL_RESOURCE_ATTRIBUTES_DEPLOYMENT_ENVIRONMENT",
            os.getenv("DEPLOYMENT_ENVIRONMENT", default_deployment_environment),
        ),
        traces_exporter=exporter,
        traces_endpoint=_trace_endpoint(exporter),
    )


@contextmanager
def trace_workflow(
    *,
    workflow_definition_id: str | None = None,
    workflow_id: str | None = None,
    environment: str | None = None,
    domain: str | None = None,
    graph_version_hash: str | None = None,
    attributes: dict[str, Any] | None = None,
) -> Iterator[Span]:
    span_attributes = {
        "agentic.workflow_definition_id": workflow_definition_id,
        "agentic.workflow_id": workflow_id,
        "agentic.environment": environment,
        "agentic.domain": domain,
        "agentic.graph_version_hash": graph_version_hash,
        "langfuse.trace.name": workflow_definition_id or "agentic.workflow.run",
        "langfuse.trace.metadata.workflow_definition_id": workflow_definition_id,
        "langfuse.trace.metadata.workflow_id": workflow_id,
        "langfuse.trace.metadata.domain": domain,
        "langfuse.trace.metadata.graph_version_hash": graph_version_hash,
        "langfuse.trace.tags": ["intelliguard", "agentic-workflow"],
        "langfuse.environment": environment,
        **(attributes or {}),
    }
    with start_span("agentic.workflow.run", span_attributes) as span:
        yield span


@contextmanager
def trace_agent_step(
    *,
    agent_id: str,
    step_id: str | None = None,
    role: str | None = None,
    node_type: str | None = None,
    attributes: dict[str, Any] | None = None,
) -> Iterator[Span]:
    span_attributes = {
        "agentic.agent_id": agent_id,
        "agentic.step_id": step_id,
        "agentic.role": role,
        "agentic.node_type": node_type,
        "langfuse.observation.type": "span",
        "langfuse.observation.metadata.agent_id": agent_id,
        "langfuse.observation.metadata.step_id": step_id,
        "langfuse.observation.metadata.role": role,
        "langfuse.observation.metadata.node_type": node_type,
        **(attributes or {}),
    }
    with start_span("agentic.agent.step", span_attributes) as span:
        yield span


@contextmanager
def trace_tool_call(
    *,
    tool_name: str,
    agent_id: str | None = None,
    step_id: str | None = None,
    attributes: dict[str, Any] | None = None,
) -> Iterator[Span]:
    span_attributes = {
        "agentic.tool_name": tool_name,
        "agentic.agent_id": agent_id,
        "agentic.step_id": step_id,
        "langfuse.observation.type": "span",
        "langfuse.observation.metadata.tool_name": tool_name,
        "langfuse.observation.metadata.agent_id": agent_id,
        "langfuse.observation.metadata.step_id": step_id,
        **(attributes or {}),
    }
    with start_span("agentic.tool.call", span_attributes) as span:
        yield span


@contextmanager
def trace_kb_operation(
    *,
    operation: str,
    kb_id: str | None = None,
    retrieval_mode: str | None = None,
    attributes: dict[str, Any] | None = None,
) -> Iterator[Span]:
    span_attributes = {
        "agentic.kb.operation": operation,
        "agentic.kb_id": kb_id,
        "agentic.retrieval_mode": retrieval_mode,
        "langfuse.observation.type": "span",
        "langfuse.observation.metadata.kb_operation": operation,
        "langfuse.observation.metadata.kb_id": kb_id,
        "langfuse.observation.metadata.retrieval_mode": retrieval_mode,
        **(attributes or {}),
    }
    with start_span("agentic.kb.operation", span_attributes) as span:
        yield span


@contextmanager
def start_span(
    name: str,
    attributes: dict[str, Any] | None = None,
    *,
    kind: SpanKind = SpanKind.INTERNAL,
) -> Iterator[Span]:
    tracer = trace.get_tracer(_TRACER_NAME)
    with tracer.start_as_current_span(name, kind=kind) as span:
        _set_attributes(span, attributes or {})
        try:
            yield span
        except Exception as exc:
            if span.is_recording():
                span.record_exception(exc)
                span.set_status(Status(StatusCode.ERROR, str(exc)))
            raise


def add_event(name: str, attributes: dict[str, Any] | None = None) -> None:
    span = trace.get_current_span()
    if span.is_recording():
        span.add_event(name, attributes=_clean_attributes(attributes or {}))


def set_attribute(key: str, value: Any) -> None:
    span = trace.get_current_span()
    clean_value = _clean_attribute_value(value)
    if span.is_recording() and clean_value is not None:
        span.set_attribute(key, clean_value)


def set_attributes(attributes: dict[str, Any]) -> None:
    span = trace.get_current_span()
    if span.is_recording():
        _set_attributes(span, attributes)


def current_trace_id() -> str | None:
    span_context = trace.get_current_span().get_span_context()
    if not span_context.is_valid:
        return None
    return f"{span_context.trace_id:032x}"


def current_span_id() -> str | None:
    span_context = trace.get_current_span().get_span_context()
    if not span_context.is_valid:
        return None
    return f"{span_context.span_id:016x}"


def trace_url(trace_id: str | None = None) -> str | None:
    trace_id = trace_id or current_trace_id()
    if not trace_id:
        return None
    base_url = os.getenv("OTEL_TRACE_UI_BASE_URL") or _default_trace_ui_base_url()
    if not base_url:
        return None
    base_url = base_url.rstrip("/")
    return f"{base_url}/{trace_id}"


def trace_context() -> dict[str, str]:
    trace_id = current_trace_id()
    if not trace_id:
        return {}
    context = {"otel_trace_id": trace_id}
    span_id = current_span_id()
    url = trace_url(trace_id)
    if span_id:
        context["otel_span_id"] = span_id
    if url:
        context["otel_trace_url"] = url
    return context


def with_trace_context(payload: dict[str, Any] | None = None) -> dict[str, Any]:
    return {**(payload or {}), **trace_context()}


def _telemetry_enabled() -> bool:
    if os.getenv("OTEL_SDK_DISABLED", "").lower() in _TRUE_VALUES:
        return False
    return os.getenv("OTEL_ENABLED", "false").lower() in _TRUE_VALUES


def _traces_exporter() -> str:
    return os.getenv("OTEL_TRACES_EXPORTER", os.getenv("OTEL_EXPORTER", "otlp")).lower()


def _trace_endpoint(exporter: str) -> str | None:
    if exporter == "console":
        return None
    if exporter in {"none", "disabled"}:
        return None
    explicit_endpoint = os.getenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT")
    if explicit_endpoint:
        return explicit_endpoint
    base_endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
    if base_endpoint:
        endpoint = base_endpoint.rstrip("/")
        if endpoint.endswith("/v1/traces"):
            return endpoint
        return f"{endpoint}/v1/traces"
    if _langfuse_credentials_configured():
        langfuse_endpoint = os.getenv("LANGFUSE_HOST", DEFAULT_LANGFUSE_HOST).rstrip("/")
        return f"{langfuse_endpoint}/api/public/otel/v1/traces"
    return DEFAULT_OTLP_HTTP_ENDPOINT


def _build_span_exporter(status: TelemetryStatus):
    if status.traces_exporter == "console":
        return ConsoleSpanExporter()
    if status.traces_exporter in {"none", "disabled"}:
        return None
    if not status.traces_endpoint:
        return None
    return OTLPSpanExporter(endpoint=status.traces_endpoint, headers=_otlp_headers())


def _langfuse_credentials_configured() -> bool:
    return bool(os.getenv("LANGFUSE_PUBLIC_KEY") and os.getenv("LANGFUSE_SECRET_KEY"))


def _otlp_headers() -> dict[str, str] | None:
    raw_headers = os.getenv("OTEL_EXPORTER_OTLP_TRACES_HEADERS") or os.getenv(
        "OTEL_EXPORTER_OTLP_HEADERS"
    )
    if raw_headers:
        return _parse_otlp_headers(raw_headers)
    public_key = os.getenv("LANGFUSE_PUBLIC_KEY")
    secret_key = os.getenv("LANGFUSE_SECRET_KEY")
    if not public_key or not secret_key:
        return None
    auth = base64.b64encode(f"{public_key}:{secret_key}".encode("utf-8")).decode("ascii")
    return {
        "Authorization": f"Basic {auth}",
        "x-langfuse-ingestion-version": "4",
    }


def _parse_otlp_headers(raw_headers: str) -> dict[str, str]:
    headers: dict[str, str] = {}
    for item in raw_headers.split(","):
        key, separator, value = item.partition("=")
        if separator and key.strip() and value.strip():
            headers[key.strip()] = value.strip()
    return headers


def _default_trace_ui_base_url() -> str:
    langfuse_trace_url = os.getenv("LANGFUSE_TRACE_UI_BASE_URL")
    if langfuse_trace_url:
        return langfuse_trace_url
    if _langfuse_credentials_configured():
        return ""
    return ""


def _set_attributes(span: Span, attributes: dict[str, Any]) -> None:
    for key, value in _clean_attributes(attributes).items():
        span.set_attribute(key, value)


def _clean_attributes(attributes: dict[str, Any]) -> dict[str, Any]:
    clean: dict[str, Any] = {}
    for key, value in attributes.items():
        clean_value = _clean_attribute_value(value)
        if clean_value is not None:
            clean[str(key)] = clean_value
    return clean


def _clean_attribute_value(
    value: Any,
) -> bool | str | int | float | list[bool | str | int | float] | None:
    if value is None:
        return None
    if isinstance(value, (bool, str, int, float)):
        return value
    if isinstance(value, (list, tuple)):
        clean_items = [
            item
            for item in (_clean_attribute_value(item) for item in value)
            if isinstance(item, (bool, str, int, float))
        ]
        return clean_items or None
    try:
        return json.dumps(value, sort_keys=True, default=str)[:2048]
    except TypeError:
        return str(value)[:2048]
