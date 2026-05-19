from __future__ import annotations

from dataclasses import asdict, dataclass, field, replace as dataclass_replace
from typing import Any

from intelliguard.detectors import (
    DetectorFinding,
    RiskAssessment,
    assess_final_response,
    assess_tool_call,
    assess_tool_result,
    redact_pii,
)
from intelliguard.evaluators import EvaluatorEngine
from intelliguard.policy import (
    PolicyConfig,
    load_policy,
    policy_from_dict,
    policy_snapshot_hash,
)
from intelliguard.store import GovernanceStore
from intelliguard.tools import ToolRegistry


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
        review_metadata: dict[str, Any] | None = None,
    ) -> None:
        self.agent_id = agent_id
        self.store = GovernanceStore(database_url)
        self.tools = tools
        self.review_metadata = dict(review_metadata or {})
        self.policy_id: str | None
        self.guardrail_mode, self.policy, self.policy_id = self._resolve_policy(policy_path)
        self.policy_hash = policy_snapshot_hash(self.policy)
        self.evaluator_engine = EvaluatorEngine(self.store)

    def _resolve_policy(self, policy_path: str) -> tuple[str, PolicyConfig, str | None]:
        identity = self.store.get_agent_identity(self.agent_id)
        environment = identity.get("environment", "local")
        assignment = self.store.get_agent_guardrail_assignment(self.agent_id, environment)
        if not assignment:
            return "enforce", load_policy(policy_path), None
        mode = assignment["mode"]
        policy_id: str | None = assignment["policy_id"]
        if mode == "disabled":
            return "disabled", load_policy(policy_path), policy_id
        policy_row = self.store.get_guardrail_policy(policy_id)
        if not policy_row:
            return mode, load_policy(policy_path), policy_id
        config = dict(policy_row["config"])
        overrides = assignment.get("threshold_overrides") or {}
        thresholds = dict(config.get("decision_thresholds") or {})
        if "block" in overrides:
            thresholds["block"] = int(overrides["block"])
        if "review" in overrides:
            thresholds["review"] = int(overrides["review"])
        config["decision_thresholds"] = thresholds
        return mode, policy_from_dict(config), policy_id

    def _apply_mode(self, assessment: RiskAssessment) -> RiskAssessment:
        if self.guardrail_mode == "review_only" and assessment.decision == "BLOCK":
            return dataclass_replace(
                assessment,
                decision="REVIEW",
                reason=f"[review_only mode] {assessment.reason}",
            )
        return assessment

    def evaluate_tool_call(
        self,
        *,
        session_id: str,
        user_query: str,
        tool_name: str,
        tool_args: dict[str, Any],
        idempotency_key: str | None = None,
    ) -> GovernedToolResult:
        self.store.ensure_agent_session(session_id, self.agent_id, user_query)
        agent_identity = self.store.get_agent_identity(self.agent_id)
        self._emit_user_and_agent_events(session_id, user_query)

        if self.guardrail_mode == "disabled":
            return GovernedToolResult(
                decision="ALLOW",
                risk_score=0,
                risk_types=[],
                reason="Guardrails disabled for this agent in this environment.",
            )

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
                "idempotency_key": idempotency_key,
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
        assessment = self._apply_mode(assessment)
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
        idempotency_key: str | None = None,
    ) -> GovernedToolResult:
        if idempotency_key and self._is_write_tool(tool_name):
            prior = self.store.get_tool_call_by_idempotency_key(
                self.agent_id, tool_name, idempotency_key
            )
            if prior:
                return self._replay_idempotent_tool_call(
                    session_id=session_id,
                    tool_name=tool_name,
                    idempotency_key=idempotency_key,
                    prior=prior,
                )

        decision = self.evaluate_tool_call(
            session_id=session_id,
            user_query=user_query,
            tool_name=tool_name,
            tool_args=tool_args,
            idempotency_key=idempotency_key,
        )
        if decision.decision != "ALLOW":
            self.store.update_session_status(session_id, decision.decision)
            return decision

        tool = self.tools.get(tool_name)
        try:
            with self.store.session() as db:
                result = tool(db, **tool_args)
        except Exception as exc:
            audit_event_id = self._audit(
                session_id=session_id,
                tool_name=tool_name,
                assessment=RiskAssessment(
                    decision="REVIEW",
                    risk_score=70,
                    findings=[
                        DetectorFinding(
                            risk_type="TOOL_RUNTIME_ERROR",
                            score=70,
                            reason=str(exc),
                            rule="tool_runtime_error",
                        )
                    ],
                    reason=str(exc),
                ),
                stage="tool_runtime_error",
            )
            self.store.update_session_status(session_id, "REVIEW")
            return GovernedToolResult(
                decision="REVIEW",
                risk_score=70,
                risk_types=["TOOL_RUNTIME_ERROR"],
                reason=str(exc),
                audit_event_id=audit_event_id,
                metadata={"retryable": True},
            )

        result_assessment = assess_tool_result(self.policy, tool_name, result)
        result_assessment = self._apply_mode(result_assessment)
        result_summary = {
            "result": result,
            "risk_score": result_assessment.risk_score,
            "risk_types": result_assessment.risk_types,
            "reason": result_assessment.reason,
        }
        tool_call_id = self.store.add_tool_call(
            session_id=session_id,
            agent_id=self.agent_id,
            tool_name=tool_name,
            tool_args=tool_args,
            idempotency_key=idempotency_key if self._is_write_tool(tool_name) else None,
            decision=result_assessment.decision,
            result_summary=result_summary,
        )
        if idempotency_key and self._is_write_tool(tool_name):
            self.store.record_tool_idempotency_key(tool_call_id, idempotency_key)
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
                stage="post_tool_result",
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

    def _is_write_tool(self, tool_name: str) -> bool:
        try:
            side_effect_level = str(
                self.tools.metadata_for(tool_name).get("side_effect_level") or "read_only"
            )
        except KeyError:
            return False
        return side_effect_level not in {"", "none", "read_only"}

    def _replay_idempotent_tool_call(
        self,
        *,
        session_id: str,
        tool_name: str,
        idempotency_key: str,
        prior: dict[str, Any],
    ) -> GovernedToolResult:
        result_summary = prior.get("result_summary") or {}
        self.store.add_workflow_event(
            session_id=session_id,
            agent_id=self.agent_id,
            event_type="TOOL_IDEMPOTENCY_REPLAY",
            label="Tool idempotency replay",
            status=prior.get("decision") or "ALLOW",
            payload={
                "tool_name": tool_name,
                "idempotency_key": idempotency_key,
                "tool_call_id": prior.get("tool_call_id"),
            },
        )
        return GovernedToolResult(
            decision=prior.get("decision") or "ALLOW",
            risk_score=int(result_summary.get("risk_score") or 0),
            risk_types=list(result_summary.get("risk_types") or []),
            reason=str(result_summary.get("reason") or "Idempotent tool call replayed."),
            result=result_summary.get("result"),
            metadata={
                "idempotency_key": idempotency_key,
                "idempotency_replay": True,
                "tool_call_id": prior.get("tool_call_id"),
            },
        )

    def check_final_response(
        self,
        *,
        session_id: str,
        response_text: str,
    ) -> GovernedToolResult:
        if self.guardrail_mode == "disabled":
            self.store.update_session_status(session_id, "COMPLETED")
            self._run_post_session_evaluators(session_id)
            return GovernedToolResult(
                decision="ALLOW",
                risk_score=0,
                risk_types=[],
                reason="Guardrails disabled.",
                response_text=response_text,
            )

        assessment = assess_final_response(self.policy, response_text)
        assessment = self._apply_mode(assessment)

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
                stage="final_response",
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
        self._run_post_session_evaluators(session_id)
        return GovernedToolResult(
            decision=final_decision,
            risk_score=assessment.risk_score,
            risk_types=assessment.risk_types,
            reason=assessment.reason,
            response_text=final_text,
        )

    def _run_post_session_evaluators(self, session_id: str) -> None:
        identity = self.store.get_agent_identity(self.agent_id)
        environment = identity.get("environment", "local")
        results = self.evaluator_engine.run_for_session(session_id, self.agent_id, environment)
        if results:
            self.store.add_workflow_event(
                session_id=session_id,
                agent_id=self.agent_id,
                event_type="EVALUATION_COMPLETE",
                label="Evaluation complete",
                status="COMPLETED",
                payload={
                    "results": [
                        {
                            "evaluator_id": r.evaluator_id,
                            "score": r.score,
                            "passed": r.passed,
                            "findings": r.findings,
                        }
                        for r in results
                    ]
                },
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
            stage="pre_tool",
            metadata={
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
                metadata=dict(self.review_metadata) if self.review_metadata else None,
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
        stage: str,
        metadata: dict[str, Any] | None = None,
    ) -> str:
        enriched_metadata = {
            **(metadata or {}),
            "stage": stage,  # also stored as first-class column; kept here for metadata query convenience
            "guardrail_mode": self.guardrail_mode,
            "policy_snapshot_hash": self.policy_hash,
            "decision_thresholds": {
                "review": self.policy.decision_thresholds.review,
                "block": self.policy.decision_thresholds.block,
            },
            "policy_controls": {
                "allowed_tools": list(self.policy.allowed_tools),
                "blocked_tools": list(self.policy.blocked_tools),
                "review_required_for": list(self.policy.review_required_for),
                "max_records_returned": self.policy.max_records_returned,
                "block_pii_in_response": self.policy.block_pii_in_response,
                "redact_pii_in_response": self.policy.redact_pii_in_response,
                "tool_argument_rules": {
                    tool_name: asdict(rule)
                    for tool_name, rule in self.policy.tool_argument_rules.items()
                },
                "tool_side_effect_controls": {
                    tool_name: asdict(control)
                    for tool_name, control in self.policy.tool_side_effect_controls.items()
                },
            },
        }
        event_id = self.store.add_audit_event(
            session_id=session_id,
            agent_id=self.agent_id,
            risk_type=assessment.risk_types[0] if assessment.risk_types else "NONE",
            decision=assessment.decision,
            reason=assessment.reason,
            tool_name=tool_name,
            risk_score=assessment.risk_score,
            policy_id=self.policy_id,
            stage=stage,
            metadata=enriched_metadata,
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
