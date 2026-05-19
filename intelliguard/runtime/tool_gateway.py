from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from intelliguard.runner import GovernedToolResult, GovernedToolRunner


@dataclass(frozen=True)
class ToolGatewayRequest:
    agent_id: str
    session_id: str
    user_query: str
    tool_name: str
    tool_args: dict[str, Any]
    idempotency_key: str | None = None


class ToolGateway:
    def __init__(self, runner_factory: Callable[[str], GovernedToolRunner]) -> None:
        self._runner_factory = runner_factory

    def invoke(self, request: ToolGatewayRequest) -> GovernedToolResult:
        runner = self._runner_factory(request.agent_id)
        return runner.call_tool(
            session_id=request.session_id,
            user_query=request.user_query,
            tool_name=request.tool_name,
            tool_args=request.tool_args,
            idempotency_key=request.idempotency_key,
        )
