from __future__ import annotations

import re
from uuid import uuid4

from agent_governance.runner import GovernedToolResult, GovernedToolRunner


CUSTOMER_ID_RE = re.compile(r"\bC\d{3,}\b", re.IGNORECASE)


def route_customer_support_tool(query: str) -> tuple[str, dict]:
    lowered = query.lower()
    customer_match = CUSTOMER_ID_RE.search(query)
    customer_id = customer_match.group(0).upper() if customer_match else "C123"

    if "dump" in lowered or "all customer data" in lowered or "show all records" in lowered:
        return "search_customers", {"filter": {}}
    if "transaction" in lowered:
        return "get_customer_transactions", {"customer_id": customer_id}
    if "profile" in lowered:
        return "get_customer_profile", {"customer_id": customer_id}
    if "search" in lowered or "find" in lowered or "customers" in lowered:
        filter_value = {"limit": 25}
        if "melbourne" in lowered:
            filter_value["city"] = "Melbourne"
        if "sydney" in lowered:
            filter_value["city"] = "Sydney"
        if "email" in lowered:
            filter_value["include_email"] = True
        return "search_customers", {"filter": filter_value}

    return "get_customer_profile", {"customer_id": customer_id}


def format_tool_response(tool_name: str, result) -> str:
    if result is None:
        return "No matching customer record was found."
    if tool_name == "get_customer_transactions":
        if not result:
            return "No recent transactions were found."
        lines = ["Recent transactions:"]
        for row in result:
            lines.append(
                f"- {row['occurred_at'][:10]}: {row['currency']} {row['amount']:.2f} at {row['merchant']}"
            )
        return "\n".join(lines)
    if tool_name == "get_customer_profile":
        return (
            f"Customer {result['customer_id']} is {result['name']}, a {result['tier']} customer "
            f"in {result['city']}. Email: {result['email']}. Phone: {result['phone']}."
        )
    if tool_name == "search_customers":
        return f"Found {len(result)} matching customers: " + ", ".join(
            f"{row['customer_id']} ({row['name']})" for row in result
        )
    return str(result)


def run_customer_support_agent(
    *,
    runner: GovernedToolRunner,
    query: str,
    session_id: str | None = None,
) -> dict:
    session_id = session_id or f"sess_{uuid4().hex[:12]}"
    tool_name, tool_args = route_customer_support_tool(query)
    tool_result = runner.call_tool(
        session_id=session_id,
        user_query=query,
        tool_name=tool_name,
        tool_args=tool_args,
    )

    if tool_result.decision != "ALLOW":
        return _result_payload(session_id, tool_name, tool_result)

    response_text = format_tool_response(tool_name, tool_result.result)
    final_check = runner.check_final_response(session_id=session_id, response_text=response_text)
    return _result_payload(session_id, tool_name, final_check, raw_result=tool_result.result)


def _result_payload(
    session_id: str,
    tool_name: str,
    result: GovernedToolResult,
    raw_result=None,
) -> dict:
    return {
        "session_id": session_id,
        "tool_name": tool_name,
        "decision": result.decision,
        "risk_score": result.risk_score,
        "risk_types": result.risk_types,
        "reason": result.reason,
        "response": result.response_text,
        "review_id": result.review_id,
        "audit_event_id": result.audit_event_id,
        "raw_result": raw_result,
    }

