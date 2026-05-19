from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

HookPoint = Literal[
    "before_workflow",
    "before_node",
    "before_tool_call",
    "after_tool_call",
    "before_final_response",
    "on_policy_violation",
    "on_budget_threshold",
    "on_runtime_error",
]
HookAction = Literal["continue", "pause_for_review", "block", "escalate"]
HookTimeoutAction = Literal["block", "continue", "escalate"]


class RuntimeHookDefinition(BaseModel):
    hook_id: str = Field(min_length=1, max_length=120, pattern=r"^[A-Za-z0-9_.:-]+$")
    display_name: str | None = None
    hook_point: HookPoint
    action: HookAction = "pause_for_review"
    scope: dict[str, Any] = Field(default_factory=dict)
    conditions: dict[str, Any] = Field(default_factory=dict)
    required_roles: list[str] = Field(default_factory=list)
    on_timeout: HookTimeoutAction = "block"
    timeout_seconds: int | None = Field(default=None, gt=0, le=2_592_000)
    review_message: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
