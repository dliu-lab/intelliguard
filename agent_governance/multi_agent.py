from __future__ import annotations

import re
from uuid import uuid4

from agent_governance.evaluators import EvaluatorEngine
from agent_governance.customer_agent import format_tool_response
from agent_governance.runner import GovernedToolRunner
from agent_governance.store import GovernanceStore
from agent_governance.tools import ToolRegistry


CUSTOMER_ID_RE = re.compile(r"\bC\d{3,}\b", re.IGNORECASE)

DEFAULT_CUSTOMER_SUPPORT_WORKFLOW = {
    "workflow_definition_id": "customer-support-investigation",
    "name": "Customer Support Investigation",
    "description": "Verify customer context, review recent transactions, and record a governed response recommendation.",
    "environment": "demo",
    "lead_agent_id": "customer-support-lead-agent",
    "steps": [
        {
            "step_id": "identity",
            "label": "Verify customer profile",
            "role": "sub_agent:identity",
            "agent_id": "identity-verification-agent",
            "task": "Verify customer profile scope.",
            "tool_name": "get_customer_profile",
            "tool_args": {"customer_id": "{{customer_id}}"},
        },
        {
            "step_id": "transactions",
            "label": "Retrieve recent transactions",
            "role": "sub_agent:transactions",
            "agent_id": "transaction-analyst-agent",
            "task": "Retrieve recent transactions.",
            "tool_name": "get_customer_transactions",
            "tool_args": {"customer_id": "{{customer_id}}"},
        },
        {
            "step_id": "risk_review",
            "label": "Review workflow outputs",
            "role": "sub_agent:risk_review",
            "agent_id": "risk-review-agent",
            "task": "Review outputs for safe response composition.",
        },
    ],
}


def run_customer_support_workflow(
    *,
    database_url: str,
    policy_path: str,
    tools: ToolRegistry,
    query: str,
    workflow_definition: dict | None = None,
) -> dict:
    store = GovernanceStore(database_url)
    workflow_definition = workflow_definition or DEFAULT_CUSTOMER_SUPPORT_WORKFLOW
    steps = workflow_definition.get("steps") or DEFAULT_CUSTOMER_SUPPORT_WORKFLOW["steps"]
    customer_match = CUSTOMER_ID_RE.search(query)
    customer_id = customer_match.group(0).upper() if customer_match else "C123"
    lead_agent_id = workflow_definition.get("lead_agent_id") or "customer-support-lead-agent"
    workflow_id = store.create_agent_workflow(
        name=f"{workflow_definition.get('name', 'Customer support investigation')} for {customer_id}",
        user_goal=query,
        lead_agent_id=lead_agent_id,
        metadata={
            "workflow_type": workflow_definition.get(
                "workflow_definition_id", "multi_agent_customer_support"
            ),
            "workflow_definition_id": workflow_definition.get("workflow_definition_id"),
            "customer_id": customer_id,
            "agents_expected": [
                lead_agent_id,
                *[step.get("agent_id") for step in steps if step.get("agent_id")],
            ],
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
                {"agent_id": step.get("agent_id"), "task": step.get("task", step.get("label", ""))}
                for step in steps
            ],
            "routing_reason": workflow_definition.get(
                "description",
                "Workflow definition routes the request through configured agent steps.",
            ),
        },
    )

    step_results = []
    step_session_ids = {}
    for step in steps:
        agent_id = step.get("agent_id")
        if not agent_id:
            continue
        step_id = step.get("step_id") or agent_id
        session_id = f"sess_{step_id}_{uuid4().hex[:10]}"
        role = step.get("role") or f"sub_agent:{step_id}"
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
            parent_session_id=lead_session_id,
            metadata={"delegated_by": lead_agent_id, "step_id": step_id},
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
        payload={"summary": summary, "step_session_ids": step_session_ids},
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
            "customer_id": customer_id,
            "lead_session_id": lead_session_id,
            "sub_agent_session_ids": list(step_session_ids.values()),
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
