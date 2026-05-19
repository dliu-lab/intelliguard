from __future__ import annotations

from typing import Protocol

from fastapi import HTTPException


class KnowledgeVersionStore(Protocol):
    def list_knowledge_base_versions(self, kb_id: str) -> list[dict]: ...


def record_metadata(record: dict) -> dict:
    metadata = record.get("metadata")
    return metadata if isinstance(metadata, dict) else {}


def normalized_scope(value: object) -> str:
    return str(value or "").strip()


def normalized_scope_key(value: object) -> str:
    return normalized_scope(value).casefold()


def agent_domain(agent: dict) -> str:
    metadata = record_metadata(agent)
    permissions = agent.get("permissions") if isinstance(agent.get("permissions"), dict) else {}
    scopes = permissions.get("scopes") if isinstance(permissions.get("scopes"), dict) else {}
    return normalized_scope(
        metadata.get("domain") or metadata.get("data_domain") or scopes.get("domain")
    )


def resource_domain(record: dict) -> str:
    metadata = record_metadata(record)
    return normalized_scope(
        record.get("domain") or metadata.get("domain") or metadata.get("data_domain")
    )


def ensure_same_agent_environment(
    agent: dict,
    record: dict,
    *,
    resource_type: str,
    resource_label: str,
) -> None:
    agent_environment = normalized_scope(agent.get("environment"))
    record_environment = normalized_scope(record.get("environment"))
    if agent_environment and record_environment and agent_environment != record_environment:
        raise HTTPException(
            status_code=403,
            detail=(
                f"{resource_type} {resource_label} belongs to environment {record_environment} "
                f"and cannot be attached to agent environment {agent_environment}."
            ),
        )


def ensure_same_agent_domain(
    agent: dict,
    resource_domain: str,
    *,
    resource_type: str,
    resource_label: str,
) -> None:
    agent_domain_value = agent_domain(agent)
    agent_key = normalized_scope_key(agent_domain_value)
    resource_key = normalized_scope_key(resource_domain)
    unscoped = {"", "all", "general", "shared"}
    if agent_key in unscoped or resource_key in unscoped or agent_key == resource_key:
        return
    raise HTTPException(
        status_code=403,
        detail=(
            f"{resource_type} {resource_label} belongs to domain {resource_domain} "
            f"and cannot be attached to agent domain {agent_domain_value}."
        ),
    )


def knowledge_base_scope(kb: dict, store: KnowledgeVersionStore) -> tuple[str, str]:
    source_config = kb.get("source_config") if isinstance(kb.get("source_config"), dict) else {}
    scope = normalized_scope(source_config.get("kb_scope") or "domain")
    scope_ref = normalized_scope(
        source_config.get("scope_ref") or source_config.get("linked_agent_id") or kb.get("domain")
    )

    try:
        versions = store.list_knowledge_base_versions(str(kb["kb_id"]))
    except ValueError:
        versions = []
    published_version = next(
        (version for version in versions if version.get("status") == "published"), None
    )
    active_version = published_version or versions[0] if versions else None
    if active_version:
        scope = normalized_scope(active_version.get("kb_scope") or scope)
        scope_ref = normalized_scope(active_version.get("scope_ref") or scope_ref)
    return scope, scope_ref


def ensure_tool_attachable_to_agent(agent: dict, tool: dict) -> None:
    tool_label = normalized_scope(tool.get("tool_name") or tool.get("display_name") or "tool")
    ensure_same_agent_environment(
        agent,
        tool,
        resource_type="Tool",
        resource_label=tool_label,
    )
    ensure_same_agent_domain(
        agent,
        resource_domain(tool),
        resource_type="Tool",
        resource_label=tool_label,
    )


def ensure_kb_attachable_to_agent(
    agent: dict,
    kb: dict,
    store: KnowledgeVersionStore,
) -> None:
    kb_label = normalized_scope(kb.get("kb_id") or kb.get("display_name") or "knowledge base")
    ensure_same_agent_environment(
        agent,
        kb,
        resource_type="Knowledge base",
        resource_label=kb_label,
    )
    scope, scope_ref = knowledge_base_scope(kb, store)
    scope_key = normalized_scope_key(scope)
    if scope_key == "shared":
        return
    if scope_key == "agent":
        agent_id = normalized_scope(agent.get("agent_id"))
        if not scope_ref or scope_ref == agent_id:
            return
        raise HTTPException(
            status_code=403,
            detail=(
                f"Knowledge base {kb_label} is scoped to agent {scope_ref} "
                f"and cannot be attached to agent {agent_id}."
            ),
        )

    ensure_same_agent_domain(
        agent,
        scope_ref or resource_domain(kb),
        resource_type="Knowledge base",
        resource_label=kb_label,
    )
