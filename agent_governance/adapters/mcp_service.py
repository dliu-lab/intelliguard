from __future__ import annotations

from typing import Any


class McpServiceConnector:
    def __init__(self, *, server_name: str, environment: str) -> None:
        if not server_name:
            raise ValueError("MCP server name is required")
        if not environment:
            raise ValueError("MCP connector environment is required")
        self.server_name = server_name
        self.environment = environment

    def tool_to_registration_payload(
        self,
        *,
        tool_name: str,
        description: str = "",
        input_schema: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        qualified_name = f"{self.server_name.replace('-', '_')}.{tool_name}"
        return {
            "tool_name": qualified_name,
            "display_name": qualified_name.replace("_", " ").replace(".", " ").title(),
            "category": "mcp",
            "description": description,
            "environment": self.environment,
            "input_schema": input_schema or {},
            "output_schema": {},
            "permissions": {},
            "allowed_actions": [],
            "metadata": {
                "mcp_server_name": self.server_name,
                "mcp_tool_name": tool_name,
                "execution_boundary": "mcp_connector",
            },
        }
