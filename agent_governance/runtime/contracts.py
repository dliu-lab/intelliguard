from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol

from agent_governance.adk.manifest import RuntimeManifest


@dataclass(frozen=True)
class RuntimeExecutionRequest:
    run_id: str
    manifest: RuntimeManifest
    user_query: str
    input_payload: dict[str, Any] = field(default_factory=dict)
    idempotency_key: str | None = None


@dataclass(frozen=True)
class RuntimeExecutionResult:
    run_id: str
    workflow_id: str
    decision: str
    status: str
    summary: str
    output_payload: dict[str, Any] = field(default_factory=dict)


class RuntimeRunner(Protocol):
    runtime_type: str

    def supports(self, runtime_type: str) -> bool:
        raise NotImplementedError

    def execute(self, request: RuntimeExecutionRequest) -> RuntimeExecutionResult:
        raise NotImplementedError
