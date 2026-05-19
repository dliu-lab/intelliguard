from __future__ import annotations

from typing import Any, Callable

from sqlalchemy.orm import Session

ToolFunction = Callable[..., Any]


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: dict[str, ToolFunction] = {}
        self._metadata: dict[str, dict[str, Any]] = {}

    def register(
        self, name: str, func: ToolFunction, metadata: dict[str, Any] | None = None
    ) -> None:
        self._tools[name] = func
        self._metadata[name] = {
            "tool_name": name,
            "display_name": name.replace("_", " ").title(),
            "category": "customer_data",
            "access_model": "grant_required",
            "status": "available",
            **(metadata or {}),
        }

    def register_configured_tool(self, payload: dict[str, Any]) -> dict[str, Any]:
        name = payload["tool_name"]

        def configured_tool(_db: Session, **tool_args: Any) -> dict[str, Any]:
            return {
                "tool_name": name,
                "mode": "configured_registry_tool",
                "received_args": tool_args,
                "message": "Configured registry tool executed without external side effects.",
            }

        metadata = {
            "display_name": payload.get("display_name") or name.replace("_", " ").title(),
            "category": payload.get("category", "custom"),
            "description": payload.get("description", ""),
            "access_model": payload.get("access_model", "grant_required"),
            "input_schema": payload.get("input_schema", {}),
            "output_schema": payload.get("output_schema", {}),
            "metadata": payload.get("metadata", {}),
            "status": "configured",
        }
        self.register(name, configured_tool, metadata=metadata)
        return self.metadata_for(name)

    def get(self, name: str) -> ToolFunction:
        if name not in self._tools:
            raise KeyError(f"Tool {name} is not registered.")
        return self._tools[name]

    def names(self) -> list[str]:
        return sorted(self._tools)

    def metadata_for(self, name: str) -> dict[str, Any]:
        return dict(self._metadata[name])
