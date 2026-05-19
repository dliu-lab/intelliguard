from __future__ import annotations

import re
from typing import Any

from intelliguard.adk.manifest import RuntimeManifest
from intelliguard.runtime.tool_gateway import ToolGateway, ToolGatewayRequest


class StrandsBuildAdapter:
    framework = "strands"

    def __init__(self, tool_gateway: ToolGateway | None = None) -> None:
        self.tool_gateway = tool_gateway

    def agent_to_registration_payload(self, agent: object) -> dict[str, object]:
        name = str(getattr(agent, "name", "") or agent.__class__.__name__)
        instructions = str(
            getattr(agent, "instructions", "") or getattr(agent, "system_prompt", "")
        )
        return {
            "agent_id": _slug(name),
            "display_name": name,
            "agent_type": "task_agent",
            "owner": "Unassigned",
            "environment": "demo",
            "purpose": instructions,
            "permissions": {"tools": list(getattr(agent, "tools", []) or [])},
            "metadata": {
                "framework": self.framework,
                "model": getattr(agent, "model", None),
                "telemetry": {"agentic.adapter": self.framework},
            },
        }

    def tool_to_registration_payload(self, tool: object) -> dict[str, object]:
        name = str(getattr(tool, "name", "") or tool.__class__.__name__)
        return {
            "tool_name": name,
            "display_name": name.replace("_", " ").title(),
            "category": "strands",
            "description": str(getattr(tool, "description", "") or ""),
            "input_schema": getattr(tool, "args_schema", {}) or {},
            "output_schema": getattr(tool, "output_schema", {}) or {},
            "permissions": {"side_effect_level": getattr(tool, "side_effect_level", "read_only")},
            "allowed_actions": [],
            "metadata": {
                "framework": self.framework,
                "telemetry": {"agentic.adapter": self.framework},
            },
        }

    def gateway_tool_callable(self, *, agent_id: str, tool_name: str):
        if not self.tool_gateway:
            raise RuntimeError("A ToolGateway is required to wrap Strands tool calls.")

        def invoke(
            *,
            session_id: str,
            user_query: str,
            idempotency_key: str | None = None,
            **tool_args: Any,
        ) -> Any:
            result = self.tool_gateway.invoke(
                ToolGatewayRequest(
                    agent_id=agent_id,
                    session_id=session_id,
                    user_query=user_query,
                    tool_name=tool_name,
                    tool_args=tool_args,
                    idempotency_key=idempotency_key,
                )
            )
            return result.result

        return invoke

    def build(self, manifest: RuntimeManifest):
        try:
            import strands  # noqa: F401
        except ImportError as exc:
            raise RuntimeError(
                "Strands support requires the optional dependency: `uv sync --extra strands`."
            ) from exc
        return {
            "framework": self.framework,
            "deployment_id": manifest.deployment_id,
            "workflow_definition_id": manifest.workflow_definition_id,
            "nodes": [node.model_dump(mode="json") for node in manifest.nodes],
            "edges": [edge.model_dump(mode="json") for edge in manifest.edges],
            "telemetry": {"agentic.adapter": self.framework},
        }


def _slug(value: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9]+", "-", value.strip().lower()).strip("-")
    return normalized or "strands-agent"
