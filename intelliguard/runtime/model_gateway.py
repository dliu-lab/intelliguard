from __future__ import annotations

from dataclasses import dataclass, field
from time import perf_counter
from typing import Any


class ModelPolicyError(ValueError):
    pass


@dataclass(frozen=True)
class ModelGatewayPolicy:
    allowed_providers: dict[str, list[str]] = field(default_factory=dict)
    allowed_data_classifications: dict[str, list[str]] = field(default_factory=dict)


@dataclass(frozen=True)
class ModelGatewayRequest:
    run_id: str
    workflow_id: str
    session_id: str
    agent_id: str
    environment: str
    provider: str
    model: str
    prompt: str
    data_classification: str
    redaction_mode: str
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ModelGatewayResult:
    provider: str
    model: str
    input_tokens_estimate: int
    output_tokens_estimate: int
    cost_usd_estimate: float
    latency_ms: int
    metadata: dict[str, Any] = field(default_factory=dict)


class ModelGateway:
    def __init__(self, *, store: Any, policy: ModelGatewayPolicy | None = None) -> None:
        self.store = store
        self.policy = policy or ModelGatewayPolicy()

    def invoke(self, request: ModelGatewayRequest) -> ModelGatewayResult:
        self._enforce_policy(request)
        started = perf_counter()
        input_tokens = _estimate_tokens(request.prompt)
        output_tokens = max(1, input_tokens // 3)
        cost = _estimate_cost_usd(input_tokens, output_tokens)
        latency_ms = int((perf_counter() - started) * 1000)
        payload = {
            "provider": request.provider,
            "model": request.model,
            "data_classification": request.data_classification,
            "redaction_mode": request.redaction_mode,
            "input_tokens_estimate": input_tokens,
            "output_tokens_estimate": output_tokens,
            "cost_usd_estimate": cost,
            "latency_ms": latency_ms,
            "metadata": request.metadata,
        }
        self.store.add_workflow_event(
            session_id=request.session_id,
            agent_id=request.agent_id,
            event_type="MODEL_REQUEST",
            label=f"Model request: {request.provider}/{request.model}",
            status="RECORDED",
            payload=payload,
        )
        self.store.add_runtime_outbox_event(
            {
                "run_id": request.run_id,
                "workflow_id": request.workflow_id,
                "session_id": request.session_id,
                "event_type": "model.requested",
                "payload": payload,
            }
        )
        return ModelGatewayResult(
            provider=request.provider,
            model=request.model,
            input_tokens_estimate=input_tokens,
            output_tokens_estimate=output_tokens,
            cost_usd_estimate=cost,
            latency_ms=latency_ms,
            metadata={"otel_attributes": _otel_attributes(request, payload)},
        )

    def _enforce_policy(self, request: ModelGatewayRequest) -> None:
        allowed_providers = self.policy.allowed_providers.get(request.environment)
        if allowed_providers is not None and request.provider not in allowed_providers:
            raise ModelPolicyError(
                f"Model provider {request.provider!r} is not approved for {request.environment!r}"
            )
        allowed_classifications = self.policy.allowed_data_classifications.get(request.environment)
        if (
            allowed_classifications is not None
            and request.data_classification not in allowed_classifications
        ):
            raise ModelPolicyError(
                f"Data classification {request.data_classification!r} is not approved for "
                f"{request.environment!r}"
            )


def _estimate_tokens(text: str) -> int:
    return max(1, len(text.split()))


def _estimate_cost_usd(input_tokens: int, output_tokens: int) -> float:
    return round((input_tokens * 0.00000015) + (output_tokens * 0.0000006), 8)


def _otel_attributes(
    request: ModelGatewayRequest, payload: dict[str, Any]
) -> dict[str, str | int | float]:
    return {
        "agentic.model.provider": request.provider,
        "agentic.model.name": request.model,
        "agentic.model.data_classification": request.data_classification,
        "agentic.model.redaction_mode": request.redaction_mode,
        "agentic.model.input_tokens_estimate": payload["input_tokens_estimate"],
        "agentic.model.output_tokens_estimate": payload["output_tokens_estimate"],
        "agentic.model.cost_usd_estimate": payload["cost_usd_estimate"],
    }
