from __future__ import annotations

import re
from uuid import uuid4

from agent_governance.evaluators import EvaluatorEngine
from agent_governance.customer_agent import format_tool_response
from agent_governance.runner import GovernedToolRunner
from agent_governance.store import GovernanceStore
from agent_governance.tools import ToolRegistry
from agent_governance.workflow_graph import workflow_graph_hash


CUSTOMER_ID_RE = re.compile(r"\bC\d{3,}\b", re.IGNORECASE)
LEAD_NODE_ID = "lead"

def _workflow_connections(workflow_definition: dict, steps: list[dict]) -> list[dict]:
    step_ids: list[str] = []
    for step in steps:
        step_id = step.get("step_id") or step.get("agent_id")
        if isinstance(step_id, str) and step_id not in step_ids:
            step_ids.append(step_id)

    valid_ids = {LEAD_NODE_ID, *step_ids}
    metadata = workflow_definition.get("metadata")
    metadata = metadata if isinstance(metadata, dict) else {}
    has_visual_connections = "visual_connections" in metadata
    raw_edges = workflow_definition.get("edges")
    raw_connections = metadata.get("visual_connections")
    connections: list[dict] = []
    seen: set[str] = set()

    if isinstance(raw_edges, list) and raw_edges:
        raw_connections = [
            {
                "from": edge.get("from_node_id") or edge.get("from"),
                "to": edge.get("to_node_id") or edge.get("to"),
                "id": edge.get("edge_id"),
                "conditions": edge.get("conditions") or {},
            }
            for edge in raw_edges
            if isinstance(edge, dict)
        ]
        has_visual_connections = True

    if isinstance(raw_connections, list):
        for connection in raw_connections:
            if not isinstance(connection, dict):
                continue

            from_node = connection.get("from")
            to_node = connection.get("to")
            if (
                not isinstance(from_node, str)
                or not isinstance(to_node, str)
                or from_node == to_node
                or to_node == LEAD_NODE_ID
                or from_node not in valid_ids
                or to_node not in valid_ids
            ):
                continue

            connection_id = f"{from_node}->{to_node}"
            if connection_id in seen:
                continue

            seen.add(connection_id)
            connections.append(
                {
                    "id": connection.get("id") or connection_id,
                    "from": from_node,
                    "to": to_node,
                    "conditions": connection.get("conditions") or {},
                }
            )

    if has_visual_connections:
        return connections

    return [
        {"id": f"{LEAD_NODE_ID}->{step_id}", "from": LEAD_NODE_ID, "to": step_id}
        for step_id in step_ids
    ]


def _incoming_connections(connections: list[dict]) -> dict[str, list[str]]:
    incoming: dict[str, list[str]] = {}

    for connection in connections:
        to_node = connection.get("to")
        from_node = connection.get("from")
        if not isinstance(to_node, str) or not isinstance(from_node, str):
            continue
        incoming.setdefault(to_node, []).append(from_node)

    return incoming


def run_customer_support_workflow(
    *,
    database_url: str,
    policy_path: str,
    tools: ToolRegistry,
    query: str,
    workflow_definition: dict | None = None,
) -> dict:
    if workflow_definition is None:
        raise ValueError("workflow_definition is required")

    store = GovernanceStore(database_url)
    steps = _workflow_steps(workflow_definition)
    connections = _workflow_connections(workflow_definition, steps)
    incoming_by_step = _incoming_connections(connections)
    lead_delegations = [
        connection["to"] for connection in connections if connection.get("from") == LEAD_NODE_ID
    ]
    customer_match = CUSTOMER_ID_RE.search(query)
    customer_id = customer_match.group(0).upper() if customer_match else "C123"
    lead_agent_id = workflow_definition.get("lead_agent_id") or "customer-support-lead-agent"
    graph_nodes = (
        workflow_definition.get("nodes")
        if isinstance(workflow_definition.get("nodes"), list)
        else []
    )
    graph_edges = (
        workflow_definition.get("edges")
        if isinstance(workflow_definition.get("edges"), list)
        else []
    )
    graph_version_hash = workflow_definition.get("graph_version_hash") or workflow_graph_hash(
        nodes=graph_nodes,
        edges=graph_edges
        or [
            {
                "edge_id": connection["id"],
                "from_node_id": connection["from"],
                "to_node_id": connection["to"],
                "conditions": connection.get("conditions") or {},
            }
            for connection in connections
        ],
    )
    routing = _lead_routing_decision(
        workflow_definition=workflow_definition,
        steps=steps,
        connections=connections,
        lead_agent_id=lead_agent_id,
        customer_id=customer_id,
        query=query,
    )
    workflow_id = store.create_agent_workflow(
        name=f"{workflow_definition.get('name', 'Customer support investigation')} for {customer_id}",
        user_goal=query,
        lead_agent_id=lead_agent_id,
        metadata={
            "workflow_type": workflow_definition.get(
                "workflow_definition_id", "multi_agent_customer_support"
            ),
            "workflow_definition_id": workflow_definition.get("workflow_definition_id"),
            "domain": workflow_definition.get("domain")
            or (workflow_definition.get("metadata") or {}).get("domain"),
            "graph_version_hash": graph_version_hash,
            "customer_id": customer_id,
            "agents_expected": [
                lead_agent_id,
                *[
                    step.get("agent_id")
                    for step in routing["selected_steps"]
                    if step.get("agent_id")
                ],
            ],
            "execution_mode": "multi_agent_fan_out"
            if len(lead_delegations) > 1
            else "multi_agent_graph",
            "workflow_connections": connections,
            "lead_delegations": lead_delegations,
            "lead_routing": routing["audit_payload"],
        },
    )

    lead_session_id = f"sess_lead_{uuid4().hex[:10]}"
    store.ensure_agent_session(lead_session_id, lead_agent_id, query)
    store.link_session_to_workflow(
        workflow_id=workflow_id,
        session_id=lead_session_id,
        agent_id=lead_agent_id,
        role="lead",
        metadata={"responsibility": "Plan workflow, delegate tasks, and summarize outcomes."},
    )
    lead_identity = store.get_agent_identity(lead_agent_id)
    store.add_workflow_event(
        session_id=lead_session_id,
        agent_id=lead_agent_id,
        event_type="USER_PROMPT",
        label="Workflow goal",
        status="RECEIVED",
        payload={"user_query": query, "customer_id": customer_id},
    )
    store.add_workflow_event(
        session_id=lead_session_id,
        agent_id=lead_agent_id,
        event_type="AGENT_SELECTED",
        label=lead_identity["display_name"],
        status="ACTIVE",
        payload={"agent_identity": lead_identity, "role": "lead"},
    )
    store.add_workflow_event(
        session_id=lead_session_id,
        agent_id=lead_agent_id,
        event_type="DELEGATION_PLAN",
        label="Delegation plan",
        status="PLANNED",
        payload={
            "sub_agents": [
                {
                    "agent_id": step.get("agent_id"),
                    "task": step.get("task", step.get("label", "")),
                    "step_id": step.get("step_id") or step.get("agent_id"),
                    "node_type": step.get("node_type"),
                    "activation_policy": step.get("activation_policy"),
                    "activation_stage": step.get("activation_stage"),
                    "connected_from": incoming_by_step.get(
                        step.get("step_id") or step.get("agent_id"), [LEAD_NODE_ID]
                    ),
                }
                for step in routing["selected_steps"]
            ],
            "connections": connections,
            "routing_reason": workflow_definition.get(
                "description",
                "Workflow definition routes the request through configured agent steps.",
            ),
        },
    )
    routing_event_id = store.add_audit_event(
        session_id=lead_session_id,
        agent_id=lead_agent_id,
        risk_type="lead_routing",
        decision="LEAD_ROUTING_DECISION",
        reason=routing["audit_payload"]["routing_reason"],
        tool_name=None,
        risk_score=0,
        policy_id=None,
        stage="pre_route",
        metadata={
            **routing["audit_payload"],
            "workflow_id": workflow_id,
            "workflow_definition_id": workflow_definition.get("workflow_definition_id"),
            "graph_version_hash": graph_version_hash,
            "policy_snapshot_hash": graph_version_hash,
        },
    )
    store.add_workflow_event(
        session_id=lead_session_id,
        agent_id=lead_agent_id,
        event_type="LEAD_ROUTING_DECISION",
        label="Lead routing decision",
        status="RECORDED",
        payload={**routing["audit_payload"], "audit_event_id": routing_event_id},
    )

    step_results = []
    step_session_ids = {}
    for step in routing["selected_steps"]:
        agent_id = step.get("agent_id")
        if not agent_id:
            continue
        step_id = step.get("step_id") or agent_id
        connected_from = incoming_by_step.get(step_id, [LEAD_NODE_ID])
        parent_session_id = lead_session_id
        for upstream_step_id in connected_from:
            if upstream_step_id != LEAD_NODE_ID and upstream_step_id in step_session_ids:
                parent_session_id = step_session_ids[upstream_step_id]
                break

        session_id = f"sess_{step_id}_{uuid4().hex[:10]}"
        role = step.get("role") or f"{step.get('node_type', 'task_agent')}:{step_id}"
        tool_name = step.get("tool_name")
        store.ensure_agent_session(
            session_id,
            agent_id,
            step.get("task") or step.get("label") or f"Run workflow step {step_id}",
        )
        store.link_session_to_workflow(
            workflow_id=workflow_id,
            session_id=session_id,
            agent_id=agent_id,
            role=role,
            parent_session_id=parent_session_id,
            metadata={
                "delegated_by": lead_agent_id,
                "step_id": step_id,
                "node_type": step.get("node_type"),
                "activation_policy": step.get("activation_policy"),
                "activation_stage": step.get("activation_stage"),
                "connected_from": connected_from,
                "direct_from_lead": LEAD_NODE_ID in connected_from,
            },
        )
        step_session_ids[step_id] = session_id
        identity = store.get_agent_identity(agent_id)
        store.add_workflow_event(
            session_id=session_id,
            agent_id=agent_id,
            event_type="AGENT_SELECTED",
            label=identity["display_name"],
            status="ACTIVE",
            payload={"agent_identity": identity, "role": role, "step_id": step_id},
        )
        if tool_name:
            runner = GovernedToolRunner(
                agent_id=agent_id,
                database_url=database_url,
                policy_path=policy_path,
                tools=tools,
            )
            result = runner.call_tool(
                session_id=session_id,
                user_query=_render_template(
                    step.get("task") or step.get("label") or query, customer_id
                ),
                tool_name=tool_name,
                tool_args=_render_value(step.get("tool_args") or {}, customer_id),
            )
            if result.decision == "ALLOW":
                result = runner.check_final_response(
                    session_id=session_id,
                    response_text=format_tool_response(tool_name, result.result),
                )
        else:
            decisions = [item["decision"] for item in step_results]
            decision = (
                "BLOCK" if "BLOCK" in decisions else "REVIEW" if "REVIEW" in decisions else "ALLOW"
            )
            store.add_workflow_event(
                session_id=session_id,
                agent_id=agent_id,
                event_type="WORKFLOW_REVIEW",
                label=step.get("label") or "Review workflow outputs",
                status=decision,
                payload={"step_results": step_results, "final_recommendation": decision},
            )
            result = _StepResult(
                decision=decision, reason=f"{step.get('label', step_id)} completed."
            )
        store.update_session_status(session_id, "COMPLETED")
        step_results.append(
            {
                "step_id": step_id,
                "agent_id": agent_id,
                "tool_name": tool_name,
                "decision": result.decision,
                "reason": result.reason,
                "session_id": session_id,
            }
        )

    decisions = [item["decision"] for item in step_results]
    final_decision = (
        "BLOCK" if "BLOCK" in decisions else "REVIEW" if "REVIEW" in decisions else "ALLOW"
    )
    summary = _workflow_summary(
        customer_id=customer_id, step_results=step_results, final_decision=final_decision
    )
    store.add_workflow_event(
        session_id=lead_session_id,
        agent_id=lead_agent_id,
        event_type="WORKFLOW_SUMMARY",
        label="Lead summary",
        status=final_decision,
        payload={
            "summary": summary,
            "step_session_ids": step_session_ids,
            "connections": connections,
        },
    )
    store.update_session_status(lead_session_id, "COMPLETED")
    store.update_agent_workflow(
        workflow_id=workflow_id,
        status="COMPLETED",
        decision=final_decision,
        summary=summary,
        metadata={
            "workflow_type": workflow_definition.get(
                "workflow_definition_id", "multi_agent_customer_support"
            ),
            "workflow_definition_id": workflow_definition.get("workflow_definition_id"),
            "domain": workflow_definition.get("domain")
            or (workflow_definition.get("metadata") or {}).get("domain"),
            "graph_version_hash": graph_version_hash,
            "customer_id": customer_id,
            "lead_session_id": lead_session_id,
            "sub_agent_session_ids": list(step_session_ids.values()),
            "execution_mode": "multi_agent_fan_out"
            if len(lead_delegations) > 1
            else "multi_agent_graph",
            "workflow_connections": connections,
            "lead_delegations": lead_delegations,
            "lead_routing": routing["audit_payload"],
        },
    )

    # Workflow-level evaluation (after_workflow evaluators on the lead agent)
    lead_identity = store.get_agent_identity(lead_agent_id)
    environment = lead_identity.get("environment", "demo")
    evaluator_engine = EvaluatorEngine(store)
    eval_results = evaluator_engine.run_for_workflow(
        workflow_id, lead_session_id, lead_agent_id, environment
    )
    if eval_results:
        store.add_workflow_event(
            session_id=lead_session_id,
            agent_id=lead_agent_id,
            event_type="WORKFLOW_EVALUATION_COMPLETE",
            label="Workflow evaluation complete",
            status="COMPLETED",
            payload={
                "results": [
                    {"evaluator_id": r.evaluator_id, "score": r.score, "passed": r.passed}
                    for r in eval_results
                ]
            },
        )

    return {
        "workflow_id": workflow_id,
        "decision": final_decision,
        "summary": summary,
        "lead_session_id": lead_session_id,
        "sessions": step_session_ids,
    }


def _workflow_summary(
    *,
    customer_id: str,
    step_results: list[dict],
    final_decision: str,
) -> str:
    step_text = ". ".join(f"{item['step_id']}: {item['decision']}" for item in step_results)
    return f"Workflow for {customer_id} completed with {final_decision}. {step_text}."


def _workflow_steps(workflow_definition: dict) -> list[dict]:
    steps = workflow_definition.get("steps") or []
    nodes = (
        workflow_definition.get("nodes")
        if isinstance(workflow_definition.get("nodes"), list)
        else []
    )
    nodes_by_id = {
        node.get("node_id"): node
        for node in nodes
        if isinstance(node, dict) and node.get("node_id") and node.get("node_id") != LEAD_NODE_ID
    }

    enriched_steps: list[dict] = []
    for step in steps:
        if not isinstance(step, dict):
            continue
        step_id = step.get("step_id") or step.get("agent_id")
        node = nodes_by_id.get(step_id) or {}
        enriched_steps.append(
            {
                **node,
                **step,
                "step_id": step_id,
                "node_type": step.get("node_type") or node.get("node_type") or "task_agent",
                "activation_policy": step.get("activation_policy")
                or node.get("activation_policy")
                or "conditional",
                "activation_stage": step.get("activation_stage")
                or node.get("activation_stage")
                or "routed",
            }
        )
    return enriched_steps


def _lead_routing_decision(
    *,
    workflow_definition: dict,
    steps: list[dict],
    connections: list[dict],
    lead_agent_id: str,
    customer_id: str,
    query: str,
) -> dict:
    selected_steps: list[dict] = []
    skipped_conditional_node_ids: list[str] = []
    required_nodes_activated: list[str] = []
    selected_node_ids: list[str] = []

    for step in steps:
        node_id = step.get("step_id") or step.get("agent_id")
        activation_policy = step.get("activation_policy") or "conditional"
        should_activate = (
            activation_policy in {"always", "human_required"} or activation_policy == "on_risk"
        )
        if activation_policy == "conditional":
            should_activate = _conditional_node_matches(step, query)

        if should_activate:
            selected_steps.append(step)
            selected_node_ids.append(node_id)
            if activation_policy in {"always", "human_required"}:
                required_nodes_activated.append(node_id)
        else:
            skipped_conditional_node_ids.append(node_id)

    selected_node_set = set(selected_node_ids)
    handoff_edges_used = [
        {
            "edge_id": connection["id"],
            "from_node_id": connection["from"],
            "to_node_id": connection["to"],
        }
        for connection in connections
        if connection["to"] in selected_node_set
        and (connection["from"] == LEAD_NODE_ID or connection["from"] in selected_node_set)
    ]

    return {
        "selected_steps": selected_steps,
        "audit_payload": {
            "workflow_definition_id": workflow_definition.get("workflow_definition_id"),
            "lead_agent_id": lead_agent_id,
            "user_intent": "customer_lookup" if customer_id else "domain_request",
            "selected_node_ids": selected_node_ids,
            "skipped_conditional_node_ids": skipped_conditional_node_ids,
            "required_nodes_activated": required_nodes_activated,
            "handoff_edges_used": handoff_edges_used,
            "routing_reason": workflow_definition.get("description")
            or "Lead agent selected nodes allowed by the registered workflow graph.",
        },
    }


def _conditional_node_matches(step: dict, query: str) -> bool:
    conditions = step.get("conditions") if isinstance(step.get("conditions"), dict) else {}
    keywords = conditions.get("keywords") or step.get("activation_keywords")
    if not isinstance(keywords, list) or not keywords:
        return True
    lowered_query = query.lower()
    return any(str(keyword).lower() in lowered_query for keyword in keywords)


class _StepResult:
    def __init__(self, *, decision: str, reason: str):
        self.decision = decision
        self.reason = reason


def _render_value(value, customer_id: str):
    if isinstance(value, str):
        return _render_template(value, customer_id)
    if isinstance(value, list):
        return [_render_value(item, customer_id) for item in value]
    if isinstance(value, dict):
        return {key: _render_value(item, customer_id) for key, item in value.items()}
    return value


def _render_template(value: str, customer_id: str) -> str:
    return value.replace("{{customer_id}}", customer_id)
