from __future__ import annotations

import argparse
import os
from typing import Any

from sqlalchemy.engine import URL, make_url
from sqlalchemy.exc import OperationalError

from intelliguard.multi_agent import run_customer_support_workflow
from intelliguard.settings import DEFAULT_DATABASE_URL, load_settings
from intelliguard.store import GovernanceStore
from intelliguard.tools import build_customer_tool_registry


WORKFLOW_DEFINITION_ID = "review-trigger-email-search"
DEFAULT_QUERY = "Find customers in Melbourne and include their emails"
DEFAULT_LOCAL_DATABASE_URL = "postgresql+psycopg://governance:governance@localhost:55432/governance"


def review_trigger_workflow_definition() -> dict[str, Any]:
    return {
        "workflow_definition_id": WORKFLOW_DEFINITION_ID,
        "name": "Review Trigger: Customer Email Search",
        "description": (
            "Demo workflow that intentionally requests customer email exposure so the runtime "
            "routes the search step to human review."
        ),
        "owner": "Governance",
        "environment": "demo",
        "lead_agent_id": "customer-support-lead-agent",
        "trigger_type": "manual",
        "steps": [
            {
                "step_id": "email_search_review",
                "label": "Search customers with email exposure",
                "role": "sub_agent:customer_search",
                "agent_id": "customer-support-agent",
                "task": DEFAULT_QUERY,
                "tool_name": "search_customers",
                "tool_args": {
                    "filter": {
                        "city": "Melbourne",
                        "include_email": True,
                        "limit": 10,
                    }
                },
            },
            {
                "step_id": "risk_review",
                "label": "Confirm human review route",
                "role": "sub_agent:risk_review",
                "agent_id": "risk-review-agent",
                "task": "Confirm the workflow paused for human review.",
            },
        ],
        "metadata": {
            "domain": "customer_support",
            "demo_scenario": "review_path",
            "expected_decision": "REVIEW",
            "expected_review_reason": "email_address_exposure",
            "test_prompt": DEFAULT_QUERY,
            "risk_controls": ["email_address_exposure", "human_review_queue"],
        },
    }


def install_review_trigger_workflow(store: GovernanceStore) -> dict[str, Any]:
    return store.upsert_workflow_definition(review_trigger_workflow_definition())


def _store_database_url(store: GovernanceStore) -> str:
    return store.session_factory.kw["bind"].url.render_as_string(hide_password=False)


def build_database_url(
    *,
    database_url: str | None,
    host: str | None,
    port: int | None,
    database: str,
    user: str,
    password: str,
) -> str:
    if database_url:
        return database_url

    if host or port:
        return URL.create(
            drivername="postgresql+psycopg",
            username=user,
            password=password,
            host=host or "localhost",
            port=port or 55432,
            database=database,
        ).render_as_string(hide_password=False)

    settings = load_settings()
    if "DATABASE_URL" in os.environ or settings.database_url != DEFAULT_DATABASE_URL:
        return settings.database_url

    return DEFAULT_LOCAL_DATABASE_URL


def run_review_trigger_workflow(
    store: GovernanceStore, query: str = DEFAULT_QUERY
) -> dict[str, Any]:
    workflow_definition = install_review_trigger_workflow(store)
    settings = load_settings()
    return run_customer_support_workflow(
        database_url=_store_database_url(store),
        policy_path=settings.policy_path,
        tools=build_customer_tool_registry(),
        query=query,
        workflow_definition=workflow_definition,
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Install or run a demo workflow that triggers human review."
    )
    parser.add_argument(
        "--run",
        action="store_true",
        help="Run the workflow immediately after installing it.",
    )
    parser.add_argument(
        "--query",
        default=DEFAULT_QUERY,
        help="Workflow prompt to use with --run.",
    )
    parser.add_argument(
        "--database-url",
        default=None,
        help="Full SQLAlchemy database URL. Overrides host/port/user/password/database.",
    )
    parser.add_argument("--host", default=None, help="Postgres host. Defaults to localhost.")
    parser.add_argument("--port", type=int, default=None, help="Postgres port. Defaults to 55432.")
    parser.add_argument("--database", default="governance", help="Postgres database name.")
    parser.add_argument("--user", default="governance", help="Postgres username.")
    parser.add_argument("--password", default="governance", help="Postgres password.")
    parser.add_argument(
        "--policy-path",
        default=None,
        help="Policy YAML path to use when --run is set. Defaults to settings.",
    )
    args = parser.parse_args()

    settings = load_settings()
    database_url = build_database_url(
        database_url=args.database_url,
        host=args.host,
        port=args.port,
        database=args.database,
        user=args.user,
        password=args.password,
    )
    store = GovernanceStore(database_url)
    try:
        workflow = install_review_trigger_workflow(store)
        print(f"Installed workflow definition: {workflow['workflow_definition_id']}")

        if args.run:
            result = run_customer_support_workflow(
                database_url=database_url,
                policy_path=args.policy_path or settings.policy_path,
                tools=build_customer_tool_registry(),
                query=args.query,
                workflow_definition=workflow,
            )
            print(f"Workflow run: {result['workflow_id']} decision={result['decision']}")
    except OperationalError as error:
        safe_url = make_url(database_url).render_as_string(hide_password=True)
        raise SystemExit(
            f"Could not connect to Postgres at {safe_url}. "
            "Start the database or pass --database-url/--host/--port. "
            "For this repo's docker-compose setup, try: --host localhost --port 55432"
        ) from error


if __name__ == "__main__":
    main()
