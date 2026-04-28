from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from agent_governance.detectors import (
    RiskAssessment,
    assess_final_response,
    assess_tool_call,
    assess_tool_result,
    redact_pii,
)
from agent_governance.policy import PolicyConfig, load_policy
from agent_governance.store import GovernanceStore
from agent_governance.tools import ToolRegistry


@dataclass(frozen=True)
class GovernedToolResult:
    decision: str
    risk_score: int
    risk_types: list[str]
    reason: str
    result: Any = None
    audit_event_id: str | None = None
    review_id: str | None = None
    response_text: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


class GovernedToolRunner:
    def __init__(
        self,
        *,
        agent_id: str,
        database_url: str,
        policy_path: str,
        tools: ToolRegistry,
    ) -> None:
        self.agent_id = agent_id
        self.policy: PolicyConfig = load_policy(policy_path)
        self.store = GovernanceStore(database_url)
        self.tools = tools

    def evaluate_tool_call(
        self,
        *,
        session_id: str,
        user_query: str,
        tool_name: str,
        tool_args: dict[str, Any],
    ) -> GovernedToolResult:
        self.store.ensure_agent_session(session_id, self.agent_id, user_query)
        agent_identity = self.store.get_agent_identity(self.agent_id)
        self._emit_user_and_agent_events(session_id, user_query)
        self.store.add_workflow_event(
            session_id=session_id,
            agent_id=self.agent_id,
            event_type="TOOL_CALL_REQUESTED",
            label=f"Tool call: {tool_name}",
            status="PENDING",
            payload={
                "tool_name": tool_name,
                "tool_args": tool_args,
                "agent_identity": agent_identity,
                "permission_snapshot": agent_identity.get("permissions", {}),
                "requested_action": self._action_for_tool(tool_name),
            },
        )

        assessment = assess_tool_call(
            policy=self.policy,
            user_query=user_query,
            tool_name=tool_name,
            tool_args=tool_args,
            agent_identity=agent_identity,
            repeated_failures=self.store.count_failed_tool_calls(session_id),
        )
        return self._record_pre_tool_decision(
            session_id=session_id,
            user_query=user_query,
            tool_name=tool_name,
            tool_args=tool_args,
            agent_identity=agent_identity,
            assessment=assessment,
        )

    def call_tool(
        self,
        *,
        session_id: str,
        user_query: str,
        tool_name: str,
        tool_args: dict[str, Any],
    ) -> GovernedToolResult:
        decision = self.evaluate_tool_call(
            session_id=session_id,
            user_query=user_query,
            tool_name=tool_name,
            tool_args=tool_args,
        )
        if decision.decision != "ALLOW":
            self.store.update_session_status(session_id, decision.decision)
            return decision

        self.store.add_tool_call(
            session_id=session_id,
            agent_id=self.agent_id,
            tool_name=tool_name,
            tool_args=tool_args,
            decision="ALLOW",
        )
        tool = self.tools.get(tool_name)
        with self.store.session() as db:
            result = tool(db, **tool_args)

        result_assessment = assess_tool_result(self.policy, tool_name, result)
        self.store.add_workflow_event(
            session_id=session_id,
            agent_id=self.agent_id,
            event_type="TOOL_EXECUTED",
            label="Tool executed",
            status=result_assessment.decision,
            payload={"tool_name": tool_name, "result_summary": self._summarize_result(result)},
        )
        self.store.add_workflow_event(
            session_id=session_id,
            agent_id=self.agent_id,
            event_type="TOOL_RESULT_CHECK",
            label="Tool result check",
            status=result_assessment.decision,
            payload=self._assessment_payload(result_assessment),
        )

        if result_assessment.decision == "BLOCK":
            audit_event_id = self._audit(
                session_id=session_id,
                tool_name=tool_name,
                assessment=result_assessment,
                metadata={"stage": "post_tool_result"},
            )
            self.store.update_session_status(session_id, "BLOCK")
            return GovernedToolResult(
                decision="BLOCK",
                risk_score=result_assessment.risk_score,
                risk_types=result_assessment.risk_types,
                reason=result_assessment.reason,
                audit_event_id=audit_event_id,
                response_text="Blocked by governance policy: tool result exceeded permitted access.",
            )

        return GovernedToolResult(
            decision="ALLOW",
            risk_score=decision.risk_score,
            risk_types=decision.risk_types,
            reason=decision.reason,
            result=result,
            audit_event_id=decision.audit_event_id,
        )

    def check_final_response(
        self,
        *,
        session_id: str,
        response_text: str,
    ) -> GovernedToolResult:
        assessment = assess_final_response(self.policy, response_text)
        final_text = response_text
        final_decision = assessment.decision

        if final_decision == "BLOCK" and self.policy.redact_pii_in_response:
            final_text = redact_pii(response_text)
            final_decision = "ALLOW"

        self.store.add_workflow_event(
            session_id=session_id,
            agent_id=self.agent_id,
            event_type="FINAL_RESPONSE_CHECK",
            label="Final response check",
            status=final_decision,
            payload=self._assessment_payload(assessment),
        )

        if final_decision == "BLOCK":
            audit_event_id = self._audit(
                session_id=session_id,
                tool_name=None,
                assessment=assessment,
                metadata={"stage": "final_response"},
            )
            self.store.update_session_status(session_id, "BLOCK")
            return GovernedToolResult(
                decision="BLOCK",
                risk_score=assessment.risk_score,
                risk_types=assessment.risk_types,
                reason=assessment.reason,
                audit_event_id=audit_event_id,
                response_text="Blocked by governance policy: the final response may expose sensitive data.",
            )

        self.store.add_workflow_event(
            session_id=session_id,
            agent_id=self.agent_id,
            event_type="RESPONSE_RETURNED",
            label="Response returned",
            status="COMPLETED",
            payload={"response_preview": final_text[:500]},
        )
        self.store.update_session_status(session_id, "COMPLETED")
        return GovernedToolResult(
            decision=final_decision,
            risk_score=assessment.risk_score,
            risk_types=assessment.risk_types,
            reason=assessment.reason,
            response_text=final_text,
        )

    def _record_pre_tool_decision(
        self,
        *,
        session_id: str,
        user_query: str,
        tool_name: str,
        tool_args: dict[str, Any],
        assessment: RiskAssessment,
        agent_identity: dict[str, Any],
    ) -> GovernedToolResult:
        self.store.add_workflow_event(
            session_id=session_id,
            agent_id=self.agent_id,
            event_type="GOVERNANCE_CHECK",
            label="Governance check",
            status=assessment.decision,
            payload={
                **self._assessment_payload(assessment),
                "agent_identity": agent_identity,
                "permission_snapshot": agent_identity.get("permissions", {}),
                "requested_action": self._action_for_tool(tool_name),
            },
        )
        self.store.add_policy_decision(
            session_id=session_id,
            agent_id=self.agent_id,
            tool_name=tool_name,
            decision=assessment.decision,
            risk_score=assessment.risk_score,
            risk_types=assessment.risk_types,
            reason=assessment.reason,
            triggered_rules=assessment.triggered_rules,
        )
        self.store.add_workflow_event(
            session_id=session_id,
            agent_id=self.agent_id,
            event_type="POLICY_DECISION",
            label=f"Decision: {assessment.decision}",
            status=assessment.decision,
            payload=self._assessment_payload(assessment),
        )

        audit_event_id = self._audit(
            session_id=session_id,
            tool_name=tool_name,
            assessment=assessment,
            metadata={
                "stage": "pre_tool",
                "tool_args": tool_args,
                "agent_identity": agent_identity,
                "requested_action": self._action_for_tool(tool_name),
            },
        )

        if assessment.decision == "BLOCK":
            self.store.add_tool_call(
                session_id=session_id,
                agent_id=self.agent_id,
                tool_name=tool_name,
                tool_args=tool_args,
                decision="BLOCK",
            )
            self.store.add_workflow_event(
                session_id=session_id,
                agent_id=self.agent_id,
                event_type="TOOL_BLOCKED",
                label="Tool blocked",
                status="BLOCK",
                payload={"reason": assessment.reason},
            )
            return GovernedToolResult(
                decision="BLOCK",
                risk_score=assessment.risk_score,
                risk_types=assessment.risk_types,
                reason=assessment.reason,
                audit_event_id=audit_event_id,
                response_text="Blocked by governance policy: this action is not permitted.",
            )

        if assessment.decision == "REVIEW":
            self.store.add_tool_call(
                session_id=session_id,
                agent_id=self.agent_id,
                tool_name=tool_name,
                tool_args=tool_args,
                decision="REVIEW",
            )
            review_id = self.store.add_review_item(
                session_id=session_id,
                agent_id=self.agent_id,
                tool_name=tool_name,
                tool_args=tool_args,
                user_query=user_query,
                risk_score=assessment.risk_score,
                risk_types=assessment.risk_types,
                reason=assessment.reason,
            )
            self.store.add_workflow_event(
                session_id=session_id,
                agent_id=self.agent_id,
                event_type="REVIEW_QUEUED",
                label="Sent to review",
                status="REVIEW",
                payload={"review_id": review_id, "reason": assessment.reason},
            )
            return GovernedToolResult(
                decision="REVIEW",
                risk_score=assessment.risk_score,
                risk_types=assessment.risk_types,
                reason=assessment.reason,
                audit_event_id=audit_event_id,
                review_id=review_id,
                response_text=f"Requires review before this action can run. Review ID: {review_id}",
            )

        return GovernedToolResult(
            decision="ALLOW",
            risk_score=assessment.risk_score,
            risk_types=assessment.risk_types,
            reason=assessment.reason,
            audit_event_id=audit_event_id,
        )

    def _emit_user_and_agent_events(self, session_id: str, user_query: str) -> None:
        existing_events = self.store.workflow_for_session(session_id)
        if existing_events:
            return
        agent_identity = self.store.get_agent_identity(self.agent_id)
        self.store.add_workflow_event(
            session_id=session_id,
            agent_id=self.agent_id,
            event_type="USER_PROMPT",
            label="User prompt",
            status="RECEIVED",
            payload={
                "user_query": user_query,
                "input_length": len(user_query),
                "input_preview": user_query[:240],
            },
        )
        self.store.add_workflow_event(
            session_id=session_id,
            agent_id=self.agent_id,
            event_type="AGENT_SELECTED",
            label=agent_identity.get("display_name") or self.agent_id,
            status="ACTIVE",
            payload={
                "agent_id": self.agent_id,
                "agent_identity": agent_identity,
                "permission_snapshot": agent_identity.get("permissions", {}),
            },
        )

    def _audit(
        self,
        *,
        session_id: str,
        tool_name: str | None,
        assessment: RiskAssessment,
        metadata: dict[str, Any],
    ) -> str:
        event_id = self.store.add_audit_event(
            session_id=session_id,
            agent_id=self.agent_id,
            risk_type=assessment.risk_types[0] if assessment.risk_types else "NONE",
            decision=assessment.decision,
            reason=assessment.reason,
            tool_name=tool_name,
            risk_score=assessment.risk_score,
            metadata=metadata,
        )
        self.store.add_workflow_event(
            session_id=session_id,
            agent_id=self.agent_id,
            event_type="AUDIT_WRITTEN",
            label="Audit written",
            status="RECORDED",
            payload={"audit_event_id": event_id},
        )
        return event_id

    @staticmethod
    def _assessment_payload(assessment: RiskAssessment) -> dict[str, Any]:
        return {
            "decision": assessment.decision,
            "risk_score": assessment.risk_score,
            "risk_types": assessment.risk_types,
            "reason": assessment.reason,
            "triggered_rules": assessment.triggered_rules,
            "findings": [
                {
                    "risk_type": finding.risk_type,
                    "score": finding.score,
                    "reason": finding.reason,
                    "rule": finding.rule,
                    "metadata": finding.metadata,
                }
                for finding in assessment.findings
            ],
        }

    @staticmethod
    def _summarize_result(result: Any) -> dict[str, Any]:
        if isinstance(result, list):
            fields = sorted({key for row in result if isinstance(row, dict) for key in row.keys()})
            pii_fields = sorted(set(fields) & {"email", "phone", "address"})
            return {
                "type": "list",
                "record_count": len(result),
                "fields": fields,
                "pii_fields": pii_fields,
                "data_classification": "customer_sensitive" if fields else "unknown",
            }
        if isinstance(result, dict):
            keys = sorted(result.keys())
            return {
                "type": "object",
                "keys": keys,
                "pii_fields": sorted(set(keys) & {"email", "phone", "address"}),
                "data_classification": "customer_sensitive",
            }
        return {"type": type(result).__name__}

    @staticmethod
    def _action_for_tool(tool_name: str) -> str:
        return {
            "get_customer_profile": "read_customer_profile",
            "get_customer_transactions": "read_transactions",
            "search_customers": "filtered_customer_search",
            "update_contact_info": "update_contact_info",
        }.get(tool_name, f"tool:{tool_name}")
