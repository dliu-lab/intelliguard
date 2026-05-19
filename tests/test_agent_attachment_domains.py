from __future__ import annotations

import pytest
from fastapi import HTTPException

import intelliguard.api.main as api_main
from intelliguard.api.schemas import AgentKBAssignmentRequest, AgentToolGrantRequest
from intelliguard.persistence.store import GovernanceStore


def _super_admin_user() -> dict:
    return {
        "role": "Admin",
        "is_super_admin": True,
        "allowed_environments": [],
        "permissions_by_environment": {},
    }


def _create_agent(store: GovernanceStore, agent_id: str, *, domain: str, environment: str) -> dict:
    return store.upsert_agent_identity(
        {
            "agent_id": agent_id,
            "display_name": agent_id.replace("-", " ").title(),
            "agent_type": "task_agent",
            "owner": "Tests",
            "environment": environment,
            "purpose": "Agent attachment domain test.",
            "permissions": {"tools": []},
            "metadata": {"domain": domain, "data_domain": domain},
        }
    )


def test_tool_grant_endpoint_rejects_cross_domain_tool(
    monkeypatch: pytest.MonkeyPatch,
    store: GovernanceStore,
) -> None:
    monkeypatch.setattr(api_main, "store", store)
    agent = _create_agent(store, "claims-domain-agent", domain="claims", environment="demo")
    store.create_tool_record(
        {
            "tool_name": "banking_lookup_for_claims_agent",
            "display_name": "Banking Lookup",
            "description": "Banking-only test tool.",
            "environment": "demo",
            "category": "banking",
            "metadata": {"domain": "banking"},
        }
    )

    with pytest.raises(HTTPException) as exc_info:
        api_main.grant_agent_tool(
            agent["agent_id"],
            AgentToolGrantRequest(tool_name="banking_lookup_for_claims_agent"),
            _super_admin_user(),
        )

    assert exc_info.value.status_code == 403
    assert "domain banking" in exc_info.value.detail
    assert "agent domain claims" in exc_info.value.detail


def test_kb_assignment_endpoint_rejects_cross_domain_knowledge_base(
    monkeypatch: pytest.MonkeyPatch,
    store: GovernanceStore,
) -> None:
    monkeypatch.setattr(api_main, "store", store)
    agent = _create_agent(store, "claims-kb-domain-agent", domain="claims", environment="demo")
    store.upsert_knowledge_base(
        {
            "kb_id": "banking-kb-for-claims-agent",
            "display_name": "Banking KB",
            "description": "Banking-only knowledge.",
            "source_type": "file",
            "source_config": {"kb_scope": "domain", "scope_ref": "banking"},
            "environment": "demo",
            "domain": "banking",
            "create_initial_version": False,
        }
    )

    with pytest.raises(HTTPException) as exc_info:
        api_main.assign_kb_to_agent(
            agent["agent_id"],
            AgentKBAssignmentRequest(kb_id="banking-kb-for-claims-agent", access_mode="read"),
            _super_admin_user(),
        )

    assert exc_info.value.status_code == 403
    assert "domain banking" in exc_info.value.detail
    assert "agent domain claims" in exc_info.value.detail


def test_kb_assignment_endpoint_allows_shared_same_environment_kb(
    monkeypatch: pytest.MonkeyPatch,
    store: GovernanceStore,
) -> None:
    monkeypatch.setattr(api_main, "store", store)
    agent = _create_agent(store, "claims-shared-kb-agent", domain="claims", environment="demo")
    store.upsert_knowledge_base(
        {
            "kb_id": "shared-demo-kb",
            "display_name": "Shared Demo KB",
            "description": "Shared knowledge.",
            "source_type": "file",
            "source_config": {"kb_scope": "shared", "scope_ref": "shared"},
            "environment": "demo",
            "domain": "",
            "create_initial_version": False,
        }
    )

    assignment = api_main.assign_kb_to_agent(
        agent["agent_id"],
        AgentKBAssignmentRequest(kb_id="shared-demo-kb", access_mode="read"),
        _super_admin_user(),
    )

    assert assignment["agent_id"] == agent["agent_id"]
    assert assignment["kb_id"] == "shared-demo-kb"
