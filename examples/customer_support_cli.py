from __future__ import annotations

import argparse
import json

from intelliguard.customer_agent import run_customer_support_agent
from intelliguard.db import init_db
from intelliguard.runner import GovernedToolRunner
from intelliguard.settings import load_settings
from intelliguard.store import GovernanceStore
from intelliguard.tools import build_customer_tool_registry


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the governed customer support agent.")
    parser.add_argument("query", help="Customer support request to send to the agent.")
    parser.add_argument("--agent-id", default="customer-support-cli")
    parser.add_argument("--session-id", default=None)
    parser.add_argument("--json", action="store_true", help="Print the full JSON payload.")
    args = parser.parse_args()

    settings = load_settings()
    if settings.auto_init_db:
        init_db(settings.database_url)
    if settings.seed_demo_data:
        GovernanceStore(settings.database_url).seed_demo_data()

    runner = GovernedToolRunner(
        agent_id=args.agent_id,
        database_url=settings.database_url,
        policy_path=settings.policy_path,
        tools=build_customer_tool_registry(),
    )
    result = run_customer_support_agent(runner=runner, query=args.query, session_id=args.session_id)

    if args.json:
        print(json.dumps(result, indent=2, default=str))
        return

    print(f"Decision: {result['decision']}")
    print(f"Risk score: {result['risk_score']}")
    if result["risk_types"]:
        print(f"Risk types: {', '.join(result['risk_types'])}")
    print(result["response"] or result["reason"])


if __name__ == "__main__":
    main()
