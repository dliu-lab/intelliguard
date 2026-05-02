from __future__ import annotations

from dataclasses import asdict
from datetime import UTC, datetime, timedelta

from sqlalchemy import create_engine, inspect, select, text
from sqlalchemy.orm import Session, sessionmaker

from agent_governance.models import (
    AgentIdentity,
    Base,
    Customer,
    CustomerTransaction,
    EvaluatorTemplate,
    GuardrailPolicy,
    SupportCase,
    WorkflowDefinition,
)
from agent_governance.policy import load_policy
from agent_governance.settings import DEFAULT_DATABASE_URL
from agent_governance.workflow_graph import workflow_graph_hash


def build_engine(database_url: str = DEFAULT_DATABASE_URL):
    return create_engine(database_url, pool_pre_ping=True)


def build_session_factory(database_url: str = DEFAULT_DATABASE_URL) -> sessionmaker[Session]:
    return sessionmaker(bind=build_engine(database_url), expire_on_commit=False)


def init_db(database_url: str = DEFAULT_DATABASE_URL) -> None:
    engine = build_engine(database_url)
    Base.metadata.create_all(engine)
    ensure_runtime_schema(engine)


def ensure_runtime_schema(engine) -> None:
    inspector = inspect(engine)
    if "users" in inspector.get_table_names():
        columns = {column["name"] for column in inspector.get_columns("users")}
        if "password_hash" not in columns:
            with engine.begin() as connection:
                connection.execute(text("ALTER TABLE users ADD COLUMN password_hash TEXT"))
    if "audit_events" in inspector.get_table_names():
        cols = {c["name"] for c in inspector.get_columns("audit_events")}
        with engine.begin() as connection:
            if "policy_id" not in cols:
                connection.execute(
                    text("ALTER TABLE audit_events ADD COLUMN policy_id VARCHAR(64)")
                )
            if "stage" not in cols:
                connection.execute(text("ALTER TABLE audit_events ADD COLUMN stage VARCHAR(40)"))
    if "workflow_definitions" in inspector.get_table_names():
        cols = {c["name"] for c in inspector.get_columns("workflow_definitions")}
        with engine.begin() as connection:
            if "domain" not in cols:
                connection.execute(
                    text(
                        "ALTER TABLE workflow_definitions ADD COLUMN domain VARCHAR(80) DEFAULT 'general'"
                    )
                )
            if "nodes" not in cols:
                connection.execute(
                    text(
                        "ALTER TABLE workflow_definitions ADD COLUMN nodes JSONB DEFAULT '[]'::jsonb"
                    )
                )
            if "edges" not in cols:
                connection.execute(
                    text(
                        "ALTER TABLE workflow_definitions ADD COLUMN edges JSONB DEFAULT '[]'::jsonb"
                    )
                )
            if "policy_bindings" not in cols:
                connection.execute(
                    text(
                        "ALTER TABLE workflow_definitions ADD COLUMN policy_bindings JSONB DEFAULT '{}'::jsonb"
                    )
                )
            if "review_rules" not in cols:
                connection.execute(
                    text(
                        "ALTER TABLE workflow_definitions ADD COLUMN review_rules JSONB DEFAULT '{}'::jsonb"
                    )
                )
            if "graph_version_hash" not in cols:
                connection.execute(
                    text(
                        "ALTER TABLE workflow_definitions ADD COLUMN graph_version_hash VARCHAR(64)"
                    )
                )
    if "user_environment_access" in inspector.get_table_names():
        with engine.begin() as connection:
            connection.execute(
                text(
                    """
                    UPDATE user_environment_access
                    SET permissions = permissions || '["workflow:create"]'::jsonb
                    WHERE permissions ? 'agent:create'
                      AND NOT permissions ? 'workflow:create'
                    """
                )
            )


def seed_guardrail_defaults(session: Session) -> None:
    from agent_governance.settings import DEFAULT_POLICY_PATH

    policy = load_policy(DEFAULT_POLICY_PATH)
    default_config = {
        "allowed_tools": list(policy.allowed_tools),
        "blocked_tools": list(policy.blocked_tools),
        "max_records_returned": policy.max_records_returned,
        "block_pii_in_response": policy.block_pii_in_response,
        "redact_pii_in_response": policy.redact_pii_in_response,
        "blocked_patterns": list(policy.blocked_patterns),
        "review_required_for": list(policy.review_required_for),
        "decision_thresholds": {
            "review": policy.decision_thresholds.review,
            "block": policy.decision_thresholds.block,
        },
        "tool_argument_rules": {
            tool_name: asdict(rule) for tool_name, rule in policy.tool_argument_rules.items()
        },
        "tool_side_effect_controls": {
            tool_name: asdict(control)
            for tool_name, control in policy.tool_side_effect_controls.items()
        },
    }

    if not session.get(GuardrailPolicy, "pol_default"):
        session.add(
            GuardrailPolicy(
                policy_id="pol_default",
                display_name="Default Policy",
                description="Seeded from the default policy.yaml. Edit to create custom policies.",
                environment="demo",
                config=default_config,
            )
        )
    else:
        default_policy = session.get(GuardrailPolicy, "pol_default")
        config = dict(default_policy.config or {})
        changed = False
        for key in ("tool_argument_rules", "tool_side_effect_controls"):
            if key not in config:
                config[key] = default_config[key]
                changed = True
        if changed:
            default_policy.config = config

    built_in = [
        EvaluatorTemplate(
            evaluator_id="eval_policy_compliance",
            display_name="Policy Compliance",
            evaluator_type="policy_compliance",
            scope="agent",
            description="Scores the fraction of policy decisions that were ALLOW in session.",
            default_config={"pass_threshold": 80},
        ),
        EvaluatorTemplate(
            evaluator_id="eval_tool_use_correctness",
            display_name="Tool Use Correctness",
            evaluator_type="tool_use_correctness",
            scope="agent",
            description="Checks that the agent only called tools it was explicitly granted.",
            default_config={"pass_threshold": 100},
        ),
        EvaluatorTemplate(
            evaluator_id="eval_pii_leakage",
            display_name="PII Leakage",
            evaluator_type="pii_leakage",
            scope="agent",
            description="Fails if any PII-related audit event was recorded for the session.",
            default_config={"pass_threshold": 100},
        ),
        EvaluatorTemplate(
            evaluator_id="eval_workflow_completion",
            display_name="Workflow Completion",
            evaluator_type="workflow_completion",
            scope="workflow",
            description="Scores overall workflow outcome: all COMPLETED=100, any BLOCK=0, any REVIEW=50.",
            default_config={"pass_threshold": 80},
        ),
        EvaluatorTemplate(
            evaluator_id="eval_response_quality",
            display_name="Response Quality",
            evaluator_type="response_quality",
            scope="workflow",
            description="Checks the lead agent's FINAL_RESPONSE_CHECK event status.",
            default_config={"pass_threshold": 80},
        ),
    ]
    for template in built_in:
        if not session.get(EvaluatorTemplate, template.evaluator_id):
            session.add(template)


def seed_demo_data(session: Session) -> None:
    seed_guardrail_defaults(session)
    seed_agent_identities(session)
    seed_workflow_definitions(session)

    existing = session.scalar(select(Customer).limit(1))
    if existing:
        return

    customers = [
        Customer(
            customer_id="C123",
            name="Ava Chen",
            email="ava.chen@example.com",
            phone="+61 400 111 222",
            city="Melbourne",
            tier="Gold",
        ),
        Customer(
            customer_id="C456",
            name="Noah Singh",
            email="noah.singh@example.com",
            phone="+61 411 333 444",
            city="Sydney",
            tier="Standard",
        ),
        Customer(
            customer_id="C789",
            name="Mia Roberts",
            email="mia.roberts@example.com",
            phone="+61 422 555 666",
            city="Melbourne",
            tier="Platinum",
        ),
    ]
    session.add_all(customers)

    now = datetime.now(UTC)
    session.add_all(
        [
            CustomerTransaction(
                transaction_id="T1001",
                customer_id="C123",
                merchant="GroceryMart",
                amount=42.10,
                currency="AUD",
                occurred_at=now - timedelta(days=2),
            ),
            CustomerTransaction(
                transaction_id="T1002",
                customer_id="C123",
                merchant="Streamly",
                amount=19.99,
                currency="AUD",
                occurred_at=now - timedelta(days=4),
            ),
            CustomerTransaction(
                transaction_id="T1003",
                customer_id="C123",
                merchant="Metro Fuel",
                amount=88.30,
                currency="AUD",
                occurred_at=now - timedelta(days=7),
            ),
            CustomerTransaction(
                transaction_id="T2001",
                customer_id="C456",
                merchant="Book Lane",
                amount=31.20,
                currency="AUD",
                occurred_at=now - timedelta(days=1),
            ),
            CustomerTransaction(
                transaction_id="T3001",
                customer_id="C789",
                merchant="Harbour Hotel",
                amount=620.00,
                currency="AUD",
                occurred_at=now - timedelta(days=3),
            ),
        ]
    )

    session.add_all(
        [
            SupportCase(
                case_id="SC1001",
                customer_id="C123",
                subject="Card replacement",
                status="OPEN",
            ),
            SupportCase(
                case_id="SC1002",
                customer_id="C789",
                subject="Disputed hotel charge",
                status="INVESTIGATING",
            ),
        ]
    )
    session.commit()


DEFAULT_AGENT_LLM_CONFIG = {
    "gateway": "litellm",
    "endpoint": "/llm/v1",
    "model": "ollama/qwen3.5:9b",
    "temperature": 0.2,
}


def seed_agent_identities(session: Session) -> None:
    defaults = [
        AgentIdentity(
            agent_id="customer-support-agent",
            display_name="Customer Support Agent",
            agent_type="task_agent",
            owner="Support Operations",
            environment="demo",
            purpose="Answer customer support questions using governed customer data tools.",
            permissions={
                "tools": [
                    "get_customer_profile",
                    "get_customer_transactions",
                    "search_customers",
                    "update_contact_info",
                ],
                "actions": [
                    "read_customer_profile",
                    "read_transactions",
                    "filtered_customer_search",
                    "update_contact_info",
                ],
                "scopes": {
                    "customer_access": "customer_id_or_filtered_search",
                    "max_search_limit": 25,
                    "pii_exposure": "review_required",
                },
            },
            metadata_json={
                "framework": "custom-python-agent",
                "data_domain": "customer_support",
                "identity_provider": "local-demo",
                "llm": {**DEFAULT_AGENT_LLM_CONFIG},
            },
        ),
        AgentIdentity(
            agent_id="customer-support-lead-agent",
            display_name="Customer Support Lead Agent",
            agent_type="lead_agent",
            owner="Support Operations",
            environment="demo",
            purpose="Plans customer support workflows and delegates work to specialist sub-agents.",
            permissions={
                "tools": [],
                "actions": ["plan_workflow", "delegate_to_sub_agents", "summarize_agent_outputs"],
                "scopes": {
                    "delegation": "customer_support_specialists",
                    "tool_execution": "delegated_only",
                },
            },
            metadata_json={
                "framework": "multi-agent-orchestrator",
                "data_domain": "customer_support",
                "identity_provider": "local-demo",
                "llm": {**DEFAULT_AGENT_LLM_CONFIG},
            },
        ),
        AgentIdentity(
            agent_id="identity-verification-agent",
            display_name="Identity Verification Agent",
            agent_type="gate_agent",
            owner="Support Operations",
            environment="demo",
            purpose="Retrieves scoped customer profile facts needed to ground support workflows.",
            permissions={
                "tools": ["get_customer_profile"],
                "actions": ["read_customer_profile"],
                "scopes": {
                    "customer_access": "customer_id",
                    "pii_exposure": "summaries_only",
                },
            },
            metadata_json={
                "framework": "multi-agent-specialist",
                "data_domain": "customer_profile",
                "identity_provider": "local-demo",
                "llm": {**DEFAULT_AGENT_LLM_CONFIG},
            },
        ),
        AgentIdentity(
            agent_id="transaction-analyst-agent",
            display_name="Transaction Analyst Agent",
            agent_type="task_agent",
            owner="Support Operations",
            environment="demo",
            purpose="Retrieves and summarizes recent customer transaction activity.",
            permissions={
                "tools": ["get_customer_transactions"],
                "actions": ["read_transactions"],
                "scopes": {
                    "customer_access": "customer_id",
                    "max_records_returned": 10,
                },
            },
            metadata_json={
                "framework": "multi-agent-specialist",
                "data_domain": "transactions",
                "identity_provider": "local-demo",
                "llm": {**DEFAULT_AGENT_LLM_CONFIG},
            },
        ),
        AgentIdentity(
            agent_id="risk-review-agent",
            display_name="Risk Review Agent",
            agent_type="review_agent",
            owner="Governance",
            environment="demo",
            purpose="Reviews delegated outputs and records workflow-level safety disposition.",
            permissions={
                "tools": [],
                "actions": ["review_outputs", "recommend_final_response"],
                "scopes": {
                    "pii_exposure": "blocked",
                    "decision_authority": "advisory",
                },
            },
            metadata_json={
                "framework": "multi-agent-specialist",
                "data_domain": "governance",
                "identity_provider": "local-demo",
                "llm": {**DEFAULT_AGENT_LLM_CONFIG},
            },
        ),
        AgentIdentity(
            agent_id="customer-support-cli",
            display_name="Customer Support CLI Agent",
            agent_type="task_agent",
            owner="Developer Experience",
            environment="local",
            purpose="Run the governed customer support demo from a terminal.",
            permissions={
                "tools": ["get_customer_profile", "get_customer_transactions", "search_customers"],
                "actions": [
                    "read_customer_profile",
                    "read_transactions",
                    "filtered_customer_search",
                ],
                "scopes": {
                    "customer_access": "customer_id_or_filtered_search",
                    "max_search_limit": 10,
                    "pii_exposure": "review_required",
                },
            },
            metadata_json={
                "framework": "cli",
                "data_domain": "customer_support",
                "identity_provider": "local-demo",
                "llm": {**DEFAULT_AGENT_LLM_CONFIG},
            },
        ),
        AgentIdentity(
            agent_id="banking-lead-agent",
            display_name="Banking Lead Agent",
            agent_type="lead_agent",
            owner="Banking Operations",
            environment="demo",
            purpose="Routes banking account inquiries through governed authentication and account-review nodes.",
            permissions={
                "tools": [],
                "actions": ["route_banking_request", "delegate_to_banking_nodes"],
                "scopes": {"domain": "banking", "tool_execution": "delegated_only"},
            },
            metadata_json={
                "framework": "multi-agent-orchestrator",
                "data_domain": "banking",
                "identity_provider": "local-demo",
                "execution_mode": "native",
                "llm": {**DEFAULT_AGENT_LLM_CONFIG},
            },
        ),
        AgentIdentity(
            agent_id="banking-auth-gate-agent",
            display_name="Banking Authentication Gate Agent",
            agent_type="gate_agent",
            owner="Banking Operations",
            environment="demo",
            purpose="Checks authenticated account scope before banking workflow routing proceeds.",
            permissions={
                "tools": [],
                "actions": ["verify_account_scope", "check_consent"],
                "scopes": {"account_access": "authenticated_account_id"},
            },
            metadata_json={
                "framework": "multi-agent-specialist",
                "data_domain": "banking_identity",
                "identity_provider": "local-demo",
                "execution_mode": "native",
                "llm": {**DEFAULT_AGENT_LLM_CONFIG},
            },
        ),
        AgentIdentity(
            agent_id="banking-account-inquiry-agent",
            display_name="Banking Account Inquiry Agent",
            agent_type="task_agent",
            owner="Banking Operations",
            environment="demo",
            purpose="Prepares scoped account-inquiry summaries after authentication gates pass.",
            permissions={
                "tools": [],
                "actions": ["summarize_account_activity", "prepare_account_answer"],
                "scopes": {
                    "account_access": "authenticated_account_id",
                    "pii_exposure": "review_required",
                },
            },
            metadata_json={
                "framework": "multi-agent-specialist",
                "data_domain": "banking_accounts",
                "identity_provider": "local-demo",
                "execution_mode": "native",
                "llm": {**DEFAULT_AGENT_LLM_CONFIG},
            },
        ),
        AgentIdentity(
            agent_id="banking-compliance-review-agent",
            display_name="Banking Compliance Review Agent",
            agent_type="review_agent",
            owner="Governance",
            environment="demo",
            purpose="Reviews high-risk banking responses and sensitive account summaries.",
            permissions={
                "tools": [],
                "actions": ["review_sensitive_account_output", "recommend_release_or_escalation"],
                "scopes": {"financial_data": "review_only", "decision_authority": "advisory"},
            },
            metadata_json={
                "framework": "multi-agent-specialist",
                "data_domain": "banking_compliance",
                "identity_provider": "local-demo",
                "execution_mode": "native",
                "llm": {**DEFAULT_AGENT_LLM_CONFIG},
            },
        ),
    ]

    for identity in defaults:
        existing = session.get(AgentIdentity, identity.agent_id)
        if not existing:
            session.add(identity)
        elif existing.agent_type != identity.agent_type:
            existing.agent_type = identity.agent_type


def seed_workflow_definitions(session: Session) -> None:
    definitions = [
        {
            "workflow_definition_id": "customer-support-investigation",
            "name": "Customer Support Investigation",
            "description": "Verify requester scope, review recent account activity, and prepare a governed response recommendation.",
            "owner": "Support Operations",
            "environment": "demo",
            "domain": "customer_support",
            "lead_agent_id": "customer-support-lead-agent",
            "trigger_type": "manual",
            "steps": [
                {
                    "step_id": "identity",
                    "label": "Verify requester scope",
                    "role": "gate_agent:identity",
                    "agent_id": "identity-verification-agent",
                    "node_type": "gate_agent",
                    "activation_policy": "always",
                    "activation_stage": "pre_route",
                    "task": "Verify customer profile for {{customer_id}}.",
                    "tool_name": "get_customer_profile",
                    "tool_args": {"customer_id": "{{customer_id}}"},
                },
                {
                    "step_id": "transactions",
                    "label": "Retrieve recent transactions",
                    "role": "task_agent:transactions",
                    "agent_id": "transaction-analyst-agent",
                    "node_type": "task_agent",
                    "activation_policy": "conditional",
                    "activation_stage": "routed",
                    "task": "Retrieve recent transactions for {{customer_id}}.",
                    "tool_name": "get_customer_transactions",
                    "tool_args": {"customer_id": "{{customer_id}}"},
                },
                {
                    "step_id": "risk_review",
                    "label": "Review workflow outputs",
                    "role": "review_agent:risk_review",
                    "agent_id": "risk-review-agent",
                    "node_type": "review_agent",
                    "activation_policy": "on_risk",
                    "activation_stage": "final_review",
                    "task": "Review outputs for safe response composition.",
                },
            ],
            "edges": [
                {
                    "edge_id": "lead->identity",
                    "from_node_id": "lead",
                    "to_node_id": "identity",
                    "conditions": {"required": True},
                },
                {
                    "edge_id": "identity->transactions",
                    "from_node_id": "identity",
                    "to_node_id": "transactions",
                    "conditions": {"when": "identity_verified"},
                },
                {
                    "edge_id": "transactions->risk_review",
                    "from_node_id": "transactions",
                    "to_node_id": "risk_review",
                    "conditions": {"when": "risk_detected_or_final_review"},
                },
            ],
        },
        {
            "workflow_definition_id": "banking-account-inquiry",
            "name": "Banking Account Inquiry",
            "description": "Authenticate account scope, route account inquiry work, and review sensitive financial summaries before release.",
            "owner": "Banking Operations",
            "environment": "demo",
            "domain": "banking",
            "lead_agent_id": "banking-lead-agent",
            "trigger_type": "manual",
            "steps": [
                {
                    "step_id": "auth_gate",
                    "label": "Authenticate account scope",
                    "role": "gate_agent:auth_gate",
                    "agent_id": "banking-auth-gate-agent",
                    "node_type": "gate_agent",
                    "activation_policy": "always",
                    "activation_stage": "pre_route",
                    "task": "Confirm the request is bound to the authenticated account scope.",
                },
                {
                    "step_id": "account_inquiry",
                    "label": "Prepare account inquiry",
                    "role": "task_agent:account_inquiry",
                    "agent_id": "banking-account-inquiry-agent",
                    "node_type": "task_agent",
                    "activation_policy": "conditional",
                    "activation_stage": "routed",
                    "task": "Prepare a scoped banking account inquiry response.",
                },
                {
                    "step_id": "compliance_review",
                    "label": "Review sensitive summary",
                    "role": "review_agent:compliance_review",
                    "agent_id": "banking-compliance-review-agent",
                    "node_type": "review_agent",
                    "activation_policy": "on_risk",
                    "activation_stage": "final_review",
                    "task": "Review sensitive financial information before release.",
                },
            ],
            "edges": [
                {
                    "edge_id": "lead->auth_gate",
                    "from_node_id": "lead",
                    "to_node_id": "auth_gate",
                    "conditions": {"required": True},
                },
                {
                    "edge_id": "auth_gate->account_inquiry",
                    "from_node_id": "auth_gate",
                    "to_node_id": "account_inquiry",
                    "conditions": {"when": "authenticated"},
                },
                {
                    "edge_id": "account_inquiry->compliance_review",
                    "from_node_id": "account_inquiry",
                    "to_node_id": "compliance_review",
                    "conditions": {"when": "sensitive_financial_summary"},
                },
            ],
        },
    ]

    for definition in definitions:
        if session.get(WorkflowDefinition, definition["workflow_definition_id"]):
            continue
        nodes = [
            {
                "node_id": "lead",
                "agent_id": definition["lead_agent_id"],
                "node_type": "lead_agent",
                "activation_policy": "always",
                "activation_stage": "pre_route",
                "capabilities": ["route_request", "coordinate_workflow"],
                "allowed_tools": [],
                "data_scope": {},
                "side_effect_level": "none",
            },
            *[
                {
                    "node_id": step["step_id"],
                    "agent_id": step["agent_id"],
                    "node_type": step["node_type"],
                    "activation_policy": step["activation_policy"],
                    "activation_stage": step["activation_stage"],
                    "capabilities": [step["task"]],
                    "allowed_tools": [step["tool_name"]] if step.get("tool_name") else [],
                    "data_scope": {},
                    "side_effect_level": "read_only",
                    "label": step["label"],
                    "task": step["task"],
                    "tool_name": step.get("tool_name"),
                    "tool_args": step.get("tool_args", {}),
                }
                for step in definition["steps"]
            ],
        ]
        session.add(
            WorkflowDefinition(
                workflow_definition_id=definition["workflow_definition_id"],
                name=definition["name"],
                description=definition["description"],
                owner=definition["owner"],
                environment=definition["environment"],
                domain=definition["domain"],
                lead_agent_id=definition["lead_agent_id"],
                trigger_type=definition["trigger_type"],
                steps=definition["steps"],
                nodes=nodes,
                edges=definition["edges"],
                policy_bindings={},
                review_rules={},
                graph_version_hash=workflow_graph_hash(nodes=nodes, edges=definition["edges"]),
                metadata_json={
                    "domain": definition["domain"],
                    "risk_controls": ["policy_check", "audit_trail", "human_review_when_required"],
                },
            )
        )
