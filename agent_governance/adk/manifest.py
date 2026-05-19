from __future__ import annotations

import hashlib
import json
from typing import Any, Literal

from pydantic import BaseModel, Field

from agent_governance.adk.hooks import RuntimeHookDefinition

RuntimeType = Literal["native", "langgraph", "strands", "temporal"]


class RuntimeLimits(BaseModel):
    timeout_seconds: int = Field(gt=0, le=86_400)
    max_parallel_nodes: int = Field(gt=0, le=128)
    max_tool_calls: int = Field(gt=0, le=10_000)
    max_llm_calls: int = Field(gt=0, le=10_000)
    max_cost_usd: float = Field(ge=0)


class RuntimeNode(BaseModel):
    node_id: str
    agent_id: str
    node_type: str
    allowed_tools: list[str] = Field(default_factory=list)
    runtime: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)


class RuntimeEdge(BaseModel):
    edge_id: str
    from_node_id: str
    to_node_id: str
    conditions: dict[str, Any] = Field(default_factory=dict)


class RuntimeManifest(BaseModel):
    manifest_version: str
    workflow_definition_id: str
    deployment_id: str
    environment: str
    runtime_type: RuntimeType
    graph_version_hash: str
    nodes: list[RuntimeNode]
    edges: list[RuntimeEdge]
    agent_snapshots: dict[str, str] = Field(default_factory=dict)
    policy_snapshots: dict[str, str]
    tool_snapshots: dict[str, str]
    evaluator_snapshots: dict[str, str]
    guardrail_snapshots: dict[str, str] = Field(default_factory=dict)
    knowledge_snapshots: dict[str, str]
    runtime_limits: RuntimeLimits
    hooks: list[RuntimeHookDefinition] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)

    def manifest_hash(self) -> str:
        # Top-level metadata is operational provenance and does not affect runtime identity.
        # Node metadata is part of the deployable node contract and remains hash-affecting.
        payload = self.model_dump(mode="json", exclude={"metadata"})
        encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
        return hashlib.sha256(encoded).hexdigest()[:24]
