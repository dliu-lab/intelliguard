from __future__ import annotations

from contextlib import contextmanager
from typing import Any

from intelliguard.governance.policy import PolicyConfig
from intelliguard.governance.runner import GovernedToolResult, GovernedToolRunner
from intelliguard.runtime.tool_gateway import ToolGateway, ToolGatewayRequest
from intelliguard.tools.registry import ToolRegistry


class CapturingRunner:
    def __init__(self) -> None:
        self.idempotency_key: str | None = None

    def call_tool(self, **kwargs: Any) -> GovernedToolResult:
        self.idempotency_key = kwargs.get("idempotency_key")
        return GovernedToolResult(
            decision="ALLOW",
            risk_score=0,
            risk_types=[],
            reason="ok",
            result={"ok": True},
        )


def test_tool_gateway_threads_idempotency_key_to_runner() -> None:
    runner = CapturingRunner()
    gateway = ToolGateway(lambda _agent_id: runner)

    result = gateway.invoke(
        ToolGatewayRequest(
            agent_id="agent-1",
            session_id="sess-1",
            user_query="Update customer",
            tool_name="update_contact_info",
            tool_args={"customer_id": "C123"},
            idempotency_key="update-C123",
        )
    )

    assert runner.idempotency_key == "update-C123"
    assert result.result == {"ok": True}


class ReplayStore:
    def __init__(self) -> None:
        self.events: list[dict[str, Any]] = []

    def get_tool_call_by_idempotency_key(
        self, agent_id: str, tool_name: str, idempotency_key: str
    ) -> dict[str, Any] | None:
        return {
            "tool_call_id": "tc-1",
            "agent_id": agent_id,
            "tool_name": tool_name,
            "idempotency_key": idempotency_key,
            "decision": "ALLOW",
            "result_summary": {
                "result": {"updated": True},
                "risk_score": 0,
                "risk_types": [],
                "reason": "replayed",
            },
        }

    def add_workflow_event(self, **kwargs: Any) -> None:
        self.events.append(kwargs)


def test_write_tool_idempotency_replays_cached_result_without_execution() -> None:
    registry = ToolRegistry()
    executed = {"count": 0}

    def write_tool(_db, **_kwargs):
        executed["count"] += 1
        return {"updated": True}

    registry.register(
        "update_contact_info",
        write_tool,
        metadata={"side_effect_level": "write_update"},
    )
    runner = object.__new__(GovernedToolRunner)
    runner.agent_id = "agent-1"
    runner.store = ReplayStore()
    runner.tools = registry

    result = runner.call_tool(
        session_id="sess-1",
        user_query="Update customer C123",
        tool_name="update_contact_info",
        tool_args={"customer_id": "C123"},
        idempotency_key="update-C123",
    )

    assert executed["count"] == 0
    assert result.decision == "ALLOW"
    assert result.result == {"updated": True}
    assert result.metadata["idempotency_replay"] is True
    assert runner.store.events[0]["event_type"] == "TOOL_IDEMPOTENCY_REPLAY"


class RecordingStore:
    def __init__(self) -> None:
        self.tool_calls: list[dict[str, Any]] = []
        self.events: list[dict[str, Any]] = []
        self.statuses: list[str] = []

    def get_tool_call_by_idempotency_key(
        self, _agent_id: str, _tool_name: str, _idempotency_key: str
    ) -> dict[str, Any] | None:
        return None

    def add_tool_call(self, **kwargs: Any) -> str:
        self.tool_calls.append(kwargs)
        return "tc-new"

    def record_tool_idempotency_key(self, tool_call_id: str, idempotency_key: str) -> None:
        self.tool_calls[-1]["recorded_tool_call_id"] = tool_call_id
        self.tool_calls[-1]["recorded_idempotency_key"] = idempotency_key

    def add_workflow_event(self, **kwargs: Any) -> None:
        self.events.append(kwargs)

    def update_session_status(self, _session_id: str, status: str) -> None:
        self.statuses.append(status)

    @contextmanager
    def session(self):
        yield object()


def test_write_tool_records_idempotency_key_after_successful_execution(monkeypatch) -> None:
    registry = ToolRegistry()
    registry.register(
        "update_contact_info",
        lambda _db, **_kwargs: {"updated": True},
        metadata={"side_effect_level": "write_update"},
    )
    runner = object.__new__(GovernedToolRunner)
    runner.agent_id = "agent-1"
    runner.store = RecordingStore()
    runner.tools = registry
    runner.policy = PolicyConfig()
    runner.guardrail_mode = "enforce"
    runner.policy_id = "policy-1"
    runner.policy_hash = "policy-hash"

    monkeypatch.setattr(
        runner,
        "evaluate_tool_call",
        lambda **_kwargs: GovernedToolResult(
            decision="ALLOW",
            risk_score=0,
            risk_types=[],
            reason="allowed",
            audit_event_id="audit-1",
        ),
    )

    result = runner.call_tool(
        session_id="sess-1",
        user_query="Update customer C123",
        tool_name="update_contact_info",
        tool_args={"customer_id": "C123"},
        idempotency_key="update-C123",
    )

    assert result.decision == "ALLOW"
    assert runner.store.tool_calls[0]["idempotency_key"] == "update-C123"
    assert runner.store.tool_calls[0]["recorded_idempotency_key"] == "update-C123"
    assert runner.store.tool_calls[0]["result_summary"]["result"] == {"updated": True}
