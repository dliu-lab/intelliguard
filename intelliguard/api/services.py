from __future__ import annotations

from typing import Any

from intelliguard.knowledge_indexing import LlamaIndexKnowledgeIndexer
from intelliguard.runner import GovernedToolRunner


def config_int(value: object, fallback: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


def knowledge_indexer_for_config(source_config: dict[str, Any]) -> LlamaIndexKnowledgeIndexer:
    return LlamaIndexKnowledgeIndexer(
        embedding_model=str(source_config.get("embedding_model") or "nomic-embed-text"),
        chunking_strategy=str(source_config.get("chunking_strategy") or "semantic"),
        chunk_size=config_int(source_config.get("chunk_size"), 512),
        chunk_overlap=config_int(source_config.get("chunk_overlap"), 80),
    )


def build_runner(
    *,
    agent_id: str,
    database_url: str,
    policy_path: str,
    tools: Any,
) -> GovernedToolRunner:
    return GovernedToolRunner(
        agent_id=agent_id,
        database_url=database_url,
        policy_path=policy_path,
        tools=tools,
    )


def workflow_manifest_snapshots(workflow: dict[str, Any], store: Any) -> dict[str, dict[str, str]]:
    from intelliguard.runtime.manifest_compiler import build_manifest_snapshots

    workflow_agent_ids = {
        str(node.get("agent_id"))
        for node in workflow.get("nodes", [])
        if isinstance(node, dict) and node.get("agent_id")
    }
    agents = [
        identity
        for agent_id in sorted(workflow_agent_ids)
        if (identity := store.find_agent_identity(agent_id))
    ]
    kb_assignments = [
        assignment
        for agent_id in sorted(workflow_agent_ids)
        for assignment in store.list_agent_kb_assignments(agent_id)
    ]
    kb_versions = [
        kb["published_version"]
        for kb in store.list_knowledge_bases(environment=workflow.get("environment"))
        if kb.get("published_version")
    ]
    evaluator_templates = []
    seen_evaluator_ids: set[str] = set()
    for agent_id in sorted(workflow_agent_ids):
        for assignment in store.list_agent_evaluator_assignments(agent_id):
            evaluator_id = str(assignment.get("evaluator_id") or "")
            if not evaluator_id or evaluator_id in seen_evaluator_ids:
                continue
            template = store.get_evaluator_template(evaluator_id)
            if not template:
                continue
            seen_evaluator_ids.add(evaluator_id)
            evaluator_templates.append(
                {
                    **template,
                    "assignment_trigger": assignment.get("trigger"),
                    "assignment_config": assignment.get("config") or {},
                }
            )
    return build_manifest_snapshots(
        workflow=workflow,
        agents=agents,
        tools=store.list_tool_records(environment=workflow.get("environment")),
        evaluators=evaluator_templates,
        guardrails=store.list_guardrail_policies(environment=workflow.get("environment")),
        kb_versions=kb_versions,
        kb_assignments=kb_assignments,
    )


def tool_payload(request: Any) -> dict[str, Any]:
    payload = request.model_dump()
    access_model = payload.pop("access_model", None)
    domain = payload.pop("domain", None)
    metadata = dict(payload.get("metadata") or {})
    if domain and "domain" not in metadata:
        metadata["domain"] = domain
    payload["metadata"] = metadata
    permissions = dict(payload.get("permissions") or {})
    if access_model and "access_model" not in permissions:
        permissions["access_model"] = access_model
    if permissions and "requires_grant" not in permissions:
        permissions["requires_grant"] = permissions.get("access_model") != "public"
    payload["permissions"] = permissions or {"requires_grant": True}
    return payload


def sync_configured_tools_into_runtime(store: Any, registry: Any) -> None:
    for tool in store.list_tool_records():
        tool_name = str(tool.get("tool_name") or "")
        if tool_name and tool_name not in registry.names():
            registry.register_configured_tool(tool)


def agent_assignments_for_evaluation(agent: dict[str, Any], store: Any) -> dict[str, Any]:
    agent_id = str(agent["agent_id"])
    agent_tools = (agent.get("permissions") or {}).get("tools") or []
    tool_records = [
        tool
        for tool_name in agent_tools
        if (tool := store.get_tool_record_by_name(str(tool_name))) is not None
    ]
    return {
        "evaluators": store.list_agent_evaluator_assignments(agent_id),
        "guardrails": store.list_agent_guardrail_assignments(agent_id),
        "knowledge": store.list_agent_kb_assignments(agent_id),
        "tools": tool_records,
    }


def workflow_assignments_for_evaluation(workflow: dict[str, Any], store: Any) -> dict[str, Any]:
    agent_ids = {
        str(workflow.get("lead_agent_id") or ""),
        *[
            str(node.get("agent_id") or "")
            for node in workflow.get("nodes", [])
            if isinstance(node, dict) and node.get("agent_id")
        ],
        *[
            str(step.get("agent_id") or "")
            for step in workflow.get("steps", [])
            if isinstance(step, dict) and step.get("agent_id")
        ],
    }
    agents = [
        agent
        for agent_id in sorted(agent_ids)
        if agent_id and (agent := store.find_agent_identity(agent_id)) is not None
    ]
    return {
        "agents": agents,
        "agent_certifications": {
            agent["agent_id"]: store.get_agent_certification(str(agent["agent_id"]))
            for agent in agents
        },
    }
