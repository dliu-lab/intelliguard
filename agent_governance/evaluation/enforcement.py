from __future__ import annotations

PRODUCTION_ENVIRONMENTS = frozenset({"prod", "production"})
LOWER_ENV_ALLOWED_STATUSES = frozenset({"DRAFT", "EVALUATING", "CERTIFIED"})


class CertificationEnforcementError(Exception):
    """Raised when a tool cannot be attached because certification policy blocks it."""


def check_tool_certification(store: object, tool_id: str, environment: str) -> None:
    cert = store.get_tool_certification(tool_id)
    if cert is None:
        raise CertificationEnforcementError(
            f"Tool '{tool_id}' has no certification record. Run tool evaluation before attaching it."
        )

    status = str(cert.get("status", "DRAFT"))
    if environment in PRODUCTION_ENVIRONMENTS:
        if status != "CERTIFIED":
            raise CertificationEnforcementError(
                f"Tool '{tool_id}' has certification status '{status}'. "
                "Only CERTIFIED tools can be attached in production environments."
            )
        return

    if status not in LOWER_ENV_ALLOWED_STATUSES:
        raise CertificationEnforcementError(
            f"Tool '{tool_id}' has certification status '{status}'. "
            "Lower environments allow DRAFT or EVALUATING tools for development, but failed "
            "or stale certifications must be fixed before attachment."
        )


def check_agent_certification(store: object, agent_id: str, environment: str) -> None:
    cert = store.get_agent_certification(agent_id)
    if cert is None:
        if environment not in PRODUCTION_ENVIRONMENTS:
            return
        raise CertificationEnforcementError(
            f"Agent '{agent_id}' has no certification record. Run agent evaluation before production use."
        )

    status = str(cert.get("status", "DRAFT"))
    if environment in PRODUCTION_ENVIRONMENTS:
        if status != "CERTIFIED":
            raise CertificationEnforcementError(
                f"Agent '{agent_id}' has certification status '{status}'. "
                "Only CERTIFIED agents can be used in production environments."
            )
        return

    if status not in LOWER_ENV_ALLOWED_STATUSES:
        raise CertificationEnforcementError(
            f"Agent '{agent_id}' has certification status '{status}'. "
            "Lower environments allow DRAFT or EVALUATING agents for development, but failed "
            "or stale certifications must be fixed before use."
        )


def check_workflow_certification(
    store: object, workflow_definition_id: str, environment: str
) -> None:
    cert = store.get_workflow_certification(workflow_definition_id)
    if cert is None:
        if environment not in PRODUCTION_ENVIRONMENTS:
            return
        raise CertificationEnforcementError(
            f"Workflow '{workflow_definition_id}' has no certification record. "
            "Run workflow evaluation before production use."
        )

    status = str(cert.get("status", "DRAFT"))
    if environment in PRODUCTION_ENVIRONMENTS:
        if status != "CERTIFIED":
            raise CertificationEnforcementError(
                f"Workflow '{workflow_definition_id}' has certification status '{status}'. "
                "Only CERTIFIED workflows can run in production environments."
            )
        return

    if status not in LOWER_ENV_ALLOWED_STATUSES:
        raise CertificationEnforcementError(
            f"Workflow '{workflow_definition_id}' has certification status '{status}'. "
            "Lower environments allow DRAFT or EVALUATING workflows for development, but "
            "failed or stale certifications must be fixed before use."
        )
