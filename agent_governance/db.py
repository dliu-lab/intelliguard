from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import create_engine, inspect, select, text
from sqlalchemy.orm import Session, sessionmaker

from agent_governance.models import (
    AgentIdentity,
    Base,
    Customer,
    CustomerTransaction,
    SupportCase,
)
from agent_governance.settings import DEFAULT_DATABASE_URL


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


def seed_demo_data(session: Session) -> None:
    seed_agent_identities(session)

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


def seed_agent_identities(session: Session) -> None:
    defaults = [
        AgentIdentity(
            agent_id="customer-support-agent",
            display_name="Customer Support Agent",
            agent_type="support_assistant",
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
            },
        ),
        AgentIdentity(
            agent_id="customer-support-lead-agent",
            display_name="Customer Support Lead Agent",
            agent_type="lead_orchestrator",
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
            },
        ),
        AgentIdentity(
            agent_id="identity-verification-agent",
            display_name="Identity Verification Agent",
            agent_type="sub_agent",
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
            },
        ),
        AgentIdentity(
            agent_id="transaction-analyst-agent",
            display_name="Transaction Analyst Agent",
            agent_type="sub_agent",
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
            },
        ),
        AgentIdentity(
            agent_id="risk-review-agent",
            display_name="Risk Review Agent",
            agent_type="sub_agent",
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
            },
        ),
        AgentIdentity(
            agent_id="customer-support-cli",
            display_name="Customer Support CLI Agent",
            agent_type="cli_agent",
            owner="Developer Experience",
            environment="local",
            purpose="Run the governed customer support demo from a terminal.",
            permissions={
                "tools": ["get_customer_profile", "get_customer_transactions", "search_customers"],
                "actions": ["read_customer_profile", "read_transactions", "filtered_customer_search"],
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
            },
        ),
    ]

    for identity in defaults:
        if not session.get(AgentIdentity, identity.agent_id):
            session.add(identity)
