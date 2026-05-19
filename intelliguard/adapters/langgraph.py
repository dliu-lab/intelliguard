from __future__ import annotations

from typing import Any

from intelliguard.adk.manifest import RuntimeManifest
from intelliguard.runtime.tool_gateway import ToolGateway, ToolGatewayRequest


class LangGraphBuildAdapter:
    framework = "langgraph"

    def __init__(self, tool_gateway: ToolGateway | None = None) -> None:
        self.tool_gateway = tool_gateway

    def build(self, manifest: RuntimeManifest):
        try:
            from langgraph.graph import END, StateGraph
        except ImportError as exc:
            raise RuntimeError(
                "LangGraph support requires the optional dependency: `uv sync --extra langgraph`."
            ) from exc

        graph = StateGraph(dict)
        node_ids = [node.node_id for node in manifest.nodes]
        for node in manifest.nodes:
            graph.add_node(
                node.node_id, self._node_callable(manifest, node.model_dump(mode="json"))
            )
        if node_ids:
            graph.set_entry_point(node_ids[0])

        outgoing: dict[str, list[dict[str, Any]]] = {}
        for edge in manifest.edges:
            outgoing.setdefault(edge.from_node_id, []).append(edge.model_dump(mode="json"))

        for from_node_id, edges in outgoing.items():
            if len(edges) == 1 and not edges[0].get("conditions"):
                graph.add_edge(from_node_id, edges[0]["to_node_id"])
                continue
            destinations = {edge["to_node_id"]: edge["to_node_id"] for edge in edges}
            destinations["__end__"] = END
            graph.add_conditional_edges(
                from_node_id,
                self._conditional_router(edges),
                destinations,
            )

        terminal_nodes = set(node_ids) - set(outgoing)
        for node_id in terminal_nodes:
            graph.add_edge(node_id, END)
        return graph.compile()

    def _node_callable(self, manifest: RuntimeManifest, node: dict[str, Any]):
        def invoke(state: dict[str, Any]) -> dict[str, Any]:
            runtime = node.get("runtime") if isinstance(node.get("runtime"), dict) else {}
            tool_name = runtime.get("tool_name")
            output: dict[str, Any] = {}
            decision = state.get("decision") or "ALLOW"
            if self.tool_gateway and tool_name:
                result = self.tool_gateway.invoke(
                    ToolGatewayRequest(
                        agent_id=node["agent_id"],
                        session_id=str(state.get("session_id") or ""),
                        user_query=str(state.get("user_query") or ""),
                        tool_name=str(tool_name),
                        tool_args=runtime.get("tool_args") or state.get("tool_args") or {},
                        idempotency_key=state.get("idempotency_key"),
                    )
                )
                decision = getattr(result, "decision", "ALLOW")
                output = {"result": getattr(result, "result", result)}
            return {
                **state,
                "run_id": state.get("run_id"),
                "workflow_id": state.get("workflow_id") or manifest.deployment_id,
                "session_id": state.get("session_id"),
                "decision": decision,
                "findings": state.get("findings") or [],
                "output": {**(state.get("output") or {}), node["node_id"]: output},
            }

        return invoke

    @staticmethod
    def _conditional_router(edges: list[dict[str, Any]]):
        def route(state: dict[str, Any]) -> str:
            for edge in edges:
                conditions = edge.get("conditions") or {}
                if not conditions:
                    return edge["to_node_id"]
                if all(state.get(key) == value for key, value in conditions.items()):
                    return edge["to_node_id"]
            return "__end__"

        return route
