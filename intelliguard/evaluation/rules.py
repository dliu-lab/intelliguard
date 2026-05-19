from __future__ import annotations

from typing import Any


def evaluation_rule_catalog(
    evaluator_templates: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    return [
        {
            "group_id": "tool_certification",
            "label": "Tool Certification",
            "scope": "tool",
            "description": "Build-time checks used when certifying tool contracts.",
            "rules": [
                _rule(
                    "input_schema_validation",
                    "Input schema",
                    "Tool must declare an object input schema with properties.",
                ),
                _rule(
                    "required_argument_validation",
                    "Required arguments",
                    "Required arguments must be a list and must exist in schema properties.",
                ),
                _rule(
                    "output_schema_validation",
                    "Output schema",
                    "Tool must declare an output schema with a type.",
                ),
                _rule(
                    "side_effect_classification",
                    "Side-effect level",
                    "Tool side_effect_level must use the controlled vocabulary.",
                ),
                _rule(
                    "permission_model_validation",
                    "Permission model",
                    "Tool permissions must describe grant or scope controls.",
                ),
                _rule(
                    "pii_field_leakage",
                    "PII field review",
                    "Output schema should not expose sensitive fields without review controls.",
                ),
            ],
        },
        {
            "group_id": "agent_certification",
            "label": "Agent Certification",
            "scope": "agent",
            "description": "Build-time checks used when certifying agent identities.",
            "rules": [
                _rule(
                    "identity_declared",
                    "Identity declared",
                    "Agent purpose and domain must be declared.",
                ),
                _rule(
                    "model_declared",
                    "Model declared",
                    "Agent metadata must declare metadata.llm.model.",
                ),
                _rule(
                    "agent_type_valid",
                    "Agent type",
                    "Agent type must use the workflow node type vocabulary.",
                ),
                _rule(
                    "tool_scope_defined",
                    "Tool grants",
                    "Task-style agents should have explicit tool grants.",
                ),
                _rule(
                    "attached_tools_certified",
                    "Certified tools",
                    "All attached tools must have certified registry records.",
                ),
                _rule(
                    "guardrail_assigned",
                    "Guardrail assignment",
                    "Agent must have a guardrail policy assignment.",
                ),
            ],
        },
        {
            "group_id": "workflow_certification",
            "label": "Workflow Certification",
            "scope": "workflow",
            "description": "Build-time checks used when certifying workflow definitions.",
            "rules": [
                _rule(
                    "workflow_graph_defined",
                    "Graph defined",
                    "Workflow graph must contain nodes and one lead node.",
                ),
                _rule(
                    "node_type_matches_registered_agent",
                    "Node types",
                    "Node type must match each registered agent type.",
                ),
                _rule(
                    "handoff_edges_valid",
                    "Handoff edges",
                    "Edges must connect known nodes without invalid self-loops or handoffs into lead.",
                ),
                _rule(
                    "workflow_nodes_certified",
                    "Certified node agents",
                    "All workflow node agents must be certified.",
                ),
                _rule(
                    "review_or_terminal_path_defined",
                    "Governance exit",
                    "Workflow should define review, approval, terminal, or review-rule exit paths.",
                ),
            ],
        },
        {
            "group_id": "knowledge_base_evaluation",
            "label": "Knowledge Base Evaluation",
            "scope": "knowledge_base",
            "description": "Checks used by the KB evaluation endpoint.",
            "rules": [
                _rule(
                    "file_count", "File count", "Knowledge base must contain at least one document."
                ),
                _rule(
                    "supported_files",
                    "Supported files",
                    "All documents must use supported file types.",
                ),
                _rule("version", "Version", "Knowledge base must have a version record."),
                _rule("owner", "Owner", "Knowledge base must have an owner."),
                _rule("scope", "Scope", "Knowledge base scope metadata must be present."),
                _rule(
                    "vector_index",
                    "Vector index",
                    "Vector KBs must have a ready index covering all documents.",
                ),
            ],
        },
        {
            "group_id": "runtime_evaluators",
            "label": "Runtime Evaluators",
            "scope": "session_workflow",
            "description": "Evaluator templates that can be assigned to agents for after-run or after-workflow evaluation.",
            "rules": [_template_rule(template) for template in evaluator_templates or []],
        },
    ]


def _rule(rule_id: str, label: str, description: str) -> dict[str, Any]:
    return {
        "rule_id": rule_id,
        "label": label,
        "description": description,
        "engine": "deterministic",
    }


def _template_rule(template: dict[str, Any]) -> dict[str, Any]:
    llm_enabled = bool(template.get("llm_enabled"))
    return {
        "rule_id": str(template.get("evaluator_id") or template.get("evaluator_type") or ""),
        "label": str(template.get("display_name") or template.get("evaluator_id") or "Evaluator"),
        "description": str(template.get("description") or ""),
        "scope": str(template.get("scope") or ""),
        "evaluator_type": str(template.get("evaluator_type") or ""),
        "engine": "LLM-as-judge" if llm_enabled else "deterministic",
        "default_config": template.get("default_config") or {},
        "llm_enabled": llm_enabled,
    }
