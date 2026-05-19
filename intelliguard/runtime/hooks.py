from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Any, Literal

from pydantic import BaseModel, Field

from intelliguard.adk.hooks import RuntimeHookDefinition
from intelliguard.adk.manifest import RuntimeManifest

RuntimeHookAction = Literal["continue", "pause_for_review", "block", "escalate"]


class RuntimeHookContext(BaseModel):
    run_id: str
    deployment_id: str
    workflow_definition_id: str
    environment: str
    hook_point: str
    user_query: str
    agent_id: str | None = None
    node_id: str | None = None
    tool_name: str | None = None
    risk_score: int | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    approved_hook_ids: list[str] = Field(default_factory=list)


@dataclass(frozen=True)
class RuntimeHookDecision:
    action: RuntimeHookAction
    hook_id: str | None = None
    review_id: str | None = None
    reason: str | None = None
    metadata: dict[str, Any] | None = None


@dataclass(frozen=True)
class RuntimeReviewResumeResult:
    applied: bool
    action: str | None = None
    run_id: str | None = None
    hook_id: str | None = None


class RuntimeHookManager:
    def __init__(self, *, store: Any) -> None:
        self.store = store

    def evaluate(
        self,
        *,
        manifest: RuntimeManifest,
        context: RuntimeHookContext,
    ) -> RuntimeHookDecision:
        hook = self._first_matching_hook(manifest=manifest, context=context)
        if not hook:
            return RuntimeHookDecision(action="continue")
        if hook.action == "continue":
            return RuntimeHookDecision(
                action="continue",
                hook_id=hook.hook_id,
                reason=f"Runtime hook {hook.hook_id} allowed continuation.",
            )
        if hook.action in {"pause_for_review", "escalate"}:
            return self._pause_for_review(manifest=manifest, context=context, hook=hook)
        if hook.action == "block":
            return self._block_run(manifest=manifest, context=context, hook=hook)
        return RuntimeHookDecision(action="continue")

    def _first_matching_hook(
        self,
        *,
        manifest: RuntimeManifest,
        context: RuntimeHookContext,
    ) -> RuntimeHookDefinition | None:
        approved_hook_ids = set(context.approved_hook_ids)
        for hook in manifest.hooks:
            if hook.hook_id in approved_hook_ids:
                continue
            if hook.hook_point != context.hook_point:
                continue
            if _conditions_match(hook.conditions, context):
                return hook
        return None

    def _pause_for_review(
        self,
        *,
        manifest: RuntimeManifest,
        context: RuntimeHookContext,
        hook: RuntimeHookDefinition,
    ) -> RuntimeHookDecision:
        agent_id = context.agent_id or _lead_agent_id(manifest)
        session_id = _hook_session_id(context.run_id, hook.hook_id)
        metadata = _review_metadata(manifest=manifest, context=context, hook=hook)
        if hasattr(self.store, "ensure_agent_session"):
            self.store.ensure_agent_session(
                session_id=session_id,
                agent_id=agent_id,
                user_query=context.user_query,
                metadata=metadata,
            )
        reason = hook.review_message or f"Runtime hook {hook.hook_id} requested review."
        review_id = self.store.add_review_item(
            session_id=session_id,
            agent_id=agent_id,
            tool_name=f"runtime_hook:{hook.hook_point}",
            tool_args={
                "hook_id": hook.hook_id,
                "hook_point": hook.hook_point,
                "action": hook.action,
                "scope": hook.scope,
                "conditions": hook.conditions,
            },
            user_query=context.user_query,
            risk_score=int(context.risk_score or 0),
            risk_types=["human_in_the_loop", hook.hook_point],
            reason=reason,
            metadata=metadata,
        )
        output_payload = _merge_runtime_hook_output(
            store=self.store,
            context=context,
            payload_key="runtime_hook_pause",
            payload={
                "review_id": review_id,
                "hook_id": hook.hook_id,
                "hook_point": hook.hook_point,
                "reason": reason,
                "resume_strategy": "queue_replay",
            },
        )
        self.store.update_workflow_runtime_run(
            context.run_id,
            {
                "status": "REVIEW",
                "decision": "REVIEW",
                "output_payload": output_payload,
                "error": None,
            },
        )
        self._append_event(
            context.run_id,
            "hook.paused",
            {
                "review_id": review_id,
                "hook_id": hook.hook_id,
                "hook_point": hook.hook_point,
                "status": "REVIEW",
            },
        )
        return RuntimeHookDecision(
            action="pause_for_review",
            hook_id=hook.hook_id,
            review_id=review_id,
            reason=reason,
            metadata=metadata,
        )

    def _block_run(
        self,
        *,
        manifest: RuntimeManifest,
        context: RuntimeHookContext,
        hook: RuntimeHookDefinition,
    ) -> RuntimeHookDecision:
        reason = hook.review_message or f"Runtime hook {hook.hook_id} blocked execution."
        output_payload = _merge_runtime_hook_output(
            store=self.store,
            context=context,
            payload_key="runtime_hook_block",
            payload={
                "hook_id": hook.hook_id,
                "hook_point": hook.hook_point,
                "reason": reason,
                "manifest_hash": manifest.manifest_hash(),
            },
        )
        self.store.update_workflow_runtime_run(
            context.run_id,
            {
                "status": "BLOCKED",
                "decision": "DENY",
                "output_payload": output_payload,
                "error": reason,
            },
        )
        self._append_event(
            context.run_id,
            "hook.blocked",
            {"hook_id": hook.hook_id, "hook_point": hook.hook_point, "status": "BLOCKED"},
        )
        return RuntimeHookDecision(
            action="block",
            hook_id=hook.hook_id,
            reason=reason,
            metadata=_review_metadata(manifest=manifest, context=context, hook=hook),
        )

    def _append_event(self, run_id: str, event_type: str, payload: dict[str, Any]) -> None:
        run = self.store.get_workflow_runtime_run(run_id)
        self.store.add_runtime_outbox_event(
            {
                "run_id": run_id,
                "workflow_id": (run or {}).get("workflow_id"),
                "event_type": event_type,
                "payload": payload,
            }
        )


class RuntimeReviewResumeService:
    def __init__(self, *, store: Any) -> None:
        self.store = store

    def resolve_review(
        self,
        *,
        review: dict[str, Any],
        status: str,
        reviewer_email: str,
        reviewer_note: str | None,
    ) -> RuntimeReviewResumeResult:
        hook_metadata = _runtime_hook_metadata(review)
        if not hook_metadata:
            return RuntimeReviewResumeResult(applied=False)
        run_id = str(hook_metadata.get("run_id") or "")
        hook_id = str(hook_metadata.get("hook_id") or "")
        if not run_id or not hook_id:
            return RuntimeReviewResumeResult(applied=False)
        if status == "APPROVED":
            return self._approve(
                review=review,
                run_id=run_id,
                hook_id=hook_id,
                reviewer_email=reviewer_email,
                reviewer_note=reviewer_note,
            )
        if status == "DENIED":
            return self._deny(
                review=review,
                run_id=run_id,
                hook_id=hook_id,
                reviewer_email=reviewer_email,
                reviewer_note=reviewer_note,
            )
        return RuntimeReviewResumeResult(applied=False)

    def _approve(
        self,
        *,
        review: dict[str, Any],
        run_id: str,
        hook_id: str,
        reviewer_email: str,
        reviewer_note: str | None,
    ) -> RuntimeReviewResumeResult:
        run = self.store.get_workflow_runtime_run(run_id)
        if not run:
            return RuntimeReviewResumeResult(applied=False)
        input_payload = dict(run.get("input_payload") or {})
        approved_hook_ids = list(input_payload.get("approved_hook_ids") or [])
        if hook_id not in approved_hook_ids:
            approved_hook_ids.append(hook_id)
        input_payload["approved_hook_ids"] = approved_hook_ids
        output_payload = dict(run.get("output_payload") or {})
        output_payload["runtime_hook_resume"] = {
            "review_id": review.get("review_id"),
            "hook_id": hook_id,
            "status": "APPROVED",
            "reviewer_email": reviewer_email,
            "reviewer_note": reviewer_note,
        }
        self.store.update_workflow_runtime_run(
            run_id,
            {
                "status": "QUEUED",
                "decision": None,
                "input_payload": input_payload,
                "output_payload": output_payload,
                "error": None,
                "completed_at": None,
            },
        )
        self._append_event(
            run_id,
            "hook.approved",
            {
                "review_id": review.get("review_id"),
                "hook_id": hook_id,
                "status": "QUEUED",
                "reviewer_email": reviewer_email,
            },
        )
        return RuntimeReviewResumeResult(
            applied=True,
            action="queued",
            run_id=run_id,
            hook_id=hook_id,
        )

    def _deny(
        self,
        *,
        review: dict[str, Any],
        run_id: str,
        hook_id: str,
        reviewer_email: str,
        reviewer_note: str | None,
    ) -> RuntimeReviewResumeResult:
        run = self.store.get_workflow_runtime_run(run_id)
        if not run:
            return RuntimeReviewResumeResult(applied=False)
        output_payload = dict(run.get("output_payload") or {})
        output_payload["runtime_hook_denial"] = {
            "review_id": review.get("review_id"),
            "hook_id": hook_id,
            "status": "DENIED",
            "reviewer_email": reviewer_email,
            "reviewer_note": reviewer_note,
        }
        self.store.update_workflow_runtime_run(
            run_id,
            {
                "status": "BLOCKED",
                "decision": "DENY",
                "output_payload": output_payload,
                "error": reviewer_note or "Runtime hook review denied.",
            },
        )
        self._append_event(
            run_id,
            "hook.denied",
            {
                "review_id": review.get("review_id"),
                "hook_id": hook_id,
                "status": "BLOCKED",
                "reviewer_email": reviewer_email,
            },
        )
        return RuntimeReviewResumeResult(
            applied=True,
            action="blocked",
            run_id=run_id,
            hook_id=hook_id,
        )

    def _append_event(self, run_id: str, event_type: str, payload: dict[str, Any]) -> None:
        run = self.store.get_workflow_runtime_run(run_id)
        self.store.add_runtime_outbox_event(
            {
                "run_id": run_id,
                "workflow_id": (run or {}).get("workflow_id"),
                "event_type": event_type,
                "payload": payload,
            }
        )


def _conditions_match(conditions: dict[str, Any], context: RuntimeHookContext) -> bool:
    for key, expected in conditions.items():
        if key == "min_risk_score":
            if int(context.risk_score or 0) < int(expected):
                return False
            continue
        actual = _context_value(context, key)
        if isinstance(expected, list):
            if actual not in expected:
                return False
            continue
        if actual != expected:
            return False
    return True


def _context_value(context: RuntimeHookContext, key: str) -> Any:
    if hasattr(context, key):
        return getattr(context, key)
    if key.startswith("metadata."):
        return context.metadata.get(key.split(".", 1)[1])
    return context.metadata.get(key)


def _lead_agent_id(manifest: RuntimeManifest) -> str:
    lead = next((node for node in manifest.nodes if node.node_type == "lead_agent"), None)
    if lead:
        return lead.agent_id
    return manifest.nodes[0].agent_id if manifest.nodes else "runtime"


def _hook_session_id(run_id: str, hook_id: str) -> str:
    digest = hashlib.sha256(f"{run_id}:{hook_id}".encode("utf-8")).hexdigest()[:24]
    return f"rt_hook_{digest}"


def _review_metadata(
    *,
    manifest: RuntimeManifest,
    context: RuntimeHookContext,
    hook: RuntimeHookDefinition,
) -> dict[str, Any]:
    return {
        "runtime_hook": {
            "run_id": context.run_id,
            "deployment_id": context.deployment_id,
            "workflow_definition_id": context.workflow_definition_id,
            "manifest_hash": manifest.manifest_hash(),
            "runtime_type": manifest.runtime_type,
            "hook_id": hook.hook_id,
            "hook_point": hook.hook_point,
            "action": hook.action,
            "required_roles": hook.required_roles,
            "resume_strategy": "queue_replay",
            "node_id": context.node_id,
            "tool_name": context.tool_name,
            "context": context.metadata,
        }
    }


def _runtime_hook_metadata(review: dict[str, Any]) -> dict[str, Any] | None:
    metadata = review.get("metadata") if isinstance(review.get("metadata"), dict) else {}
    runtime_hook = metadata.get("runtime_hook")
    return runtime_hook if isinstance(runtime_hook, dict) else None


def _merge_runtime_hook_output(
    *,
    store: Any,
    context: RuntimeHookContext,
    payload_key: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    run = store.get_workflow_runtime_run(context.run_id)
    output_payload = dict((run or {}).get("output_payload") or {})
    output_payload[payload_key] = payload
    return output_payload
