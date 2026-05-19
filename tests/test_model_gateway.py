from __future__ import annotations

import pytest

from intelliguard.runtime.model_gateway import (
    ModelGateway,
    ModelGatewayPolicy,
    ModelGatewayRequest,
    ModelPolicyError,
)


class RecordingStore:
    def __init__(self) -> None:
        self.workflow_events: list[dict] = []
        self.outbox_events: list[dict] = []

    def add_workflow_event(self, **kwargs):
        self.workflow_events.append(kwargs)

    def add_runtime_outbox_event(self, payload):
        self.outbox_events.append(payload)
        return {"outbox_id": "outbox-1", **payload}


def test_model_gateway_records_request_metadata_in_events_and_outbox() -> None:
    store = RecordingStore()
    gateway = ModelGateway(
        store=store,
        policy=ModelGatewayPolicy(
            allowed_providers={"demo": ["openai"]},
            allowed_data_classifications={"demo": ["internal"]},
        ),
    )

    result = gateway.invoke(
        ModelGatewayRequest(
            run_id="run-1",
            workflow_id="workflow-1",
            session_id="sess-1",
            agent_id="agent-1",
            environment="demo",
            provider="openai",
            model="gpt-4.1-mini",
            prompt="Summarize this internal case.",
            data_classification="internal",
            redaction_mode="none",
        )
    )

    assert result.provider == "openai"
    assert result.model == "gpt-4.1-mini"
    assert result.input_tokens_estimate > 0
    assert result.cost_usd_estimate >= 0
    assert store.workflow_events[0]["event_type"] == "MODEL_REQUEST"
    assert store.workflow_events[0]["payload"]["data_classification"] == "internal"
    assert store.outbox_events[0]["event_type"] == "model.requested"
    assert store.outbox_events[0]["payload"]["provider"] == "openai"
    assert result.metadata["otel_attributes"]["agentic.model.provider"] == "openai"


def test_sensitive_environment_blocks_unapproved_provider() -> None:
    gateway = ModelGateway(
        store=RecordingStore(),
        policy=ModelGatewayPolicy(
            allowed_providers={"production": ["bedrock"]},
            allowed_data_classifications={"production": ["internal"]},
        ),
    )

    with pytest.raises(ModelPolicyError, match="provider"):
        gateway.invoke(
            ModelGatewayRequest(
                run_id="run-1",
                workflow_id="workflow-1",
                session_id="sess-1",
                agent_id="agent-1",
                environment="production",
                provider="openai",
                model="gpt-4.1-mini",
                prompt="Sensitive customer record",
                data_classification="internal",
                redaction_mode="none",
            )
        )


def test_model_gateway_blocks_unapproved_data_classification() -> None:
    gateway = ModelGateway(
        store=RecordingStore(),
        policy=ModelGatewayPolicy(
            allowed_providers={"production": ["bedrock"]},
            allowed_data_classifications={"production": ["public"]},
        ),
    )

    with pytest.raises(ModelPolicyError, match="classification"):
        gateway.invoke(
            ModelGatewayRequest(
                run_id="run-1",
                workflow_id="workflow-1",
                session_id="sess-1",
                agent_id="agent-1",
                environment="production",
                provider="bedrock",
                model="claude",
                prompt="Sensitive customer record",
                data_classification="restricted",
                redaction_mode="redact_pii",
            )
        )
