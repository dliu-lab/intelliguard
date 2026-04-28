from __future__ import annotations

from typing import Any, Callable

from sqlalchemy import select
from sqlalchemy.orm import Session

from agent_governance.models import Customer, CustomerTransaction

ToolFunction = Callable[..., Any]


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: dict[str, ToolFunction] = {}
        self._metadata: dict[str, dict[str, Any]] = {}

    def register(self, name: str, func: ToolFunction, metadata: dict[str, Any] | None = None) -> None:
        self._tools[name] = func
        self._metadata[name] = {
            "tool_name": name,
            "display_name": name.replace("_", " ").title(),
            "category": "customer_data",
            "access_model": "grant_required",
            "status": "available",
            **(metadata or {}),
        }

    def register_configured_tool(self, payload: dict[str, Any]) -> dict[str, Any]:
        name = payload["tool_name"]

        def configured_tool(_db: Session, **tool_args: Any) -> dict[str, Any]:
            return {
                "tool_name": name,
                "mode": "configured_marketplace_tool",
                "received_args": tool_args,
                "message": "Configured marketplace tool executed without external side effects.",
            }

        metadata = {
            "display_name": payload.get("display_name") or name.replace("_", " ").title(),
            "category": payload.get("category", "custom"),
            "description": payload.get("description", ""),
            "access_model": payload.get("access_model", "grant_required"),
            "input_schema": payload.get("input_schema", {}),
            "output_schema": payload.get("output_schema", {}),
            "metadata": payload.get("metadata", {}),
            "status": "configured",
        }
        self.register(name, configured_tool, metadata=metadata)
        return self.metadata_for(name)

    def get(self, name: str) -> ToolFunction:
        if name not in self._tools:
            raise KeyError(f"Tool {name} is not registered.")
        return self._tools[name]

    def names(self) -> list[str]:
        return sorted(self._tools)

    def metadata_for(self, name: str) -> dict[str, Any]:
        return dict(self._metadata[name])

    def marketplace(self) -> list[dict[str, Any]]:
        return [self.metadata_for(name) for name in self.names()]


def _customer_to_dict(customer: Customer, include_contact: bool = True) -> dict[str, Any]:
    payload = {
        "customer_id": customer.customer_id,
        "name": customer.name,
        "city": customer.city,
        "tier": customer.tier,
    }
    if include_contact:
        payload.update({"email": customer.email, "phone": customer.phone})
    return payload


def get_customer_profile(db: Session, customer_id: str) -> dict[str, Any] | None:
    customer = db.get(Customer, customer_id)
    return _customer_to_dict(customer) if customer else None


def get_customer_transactions(db: Session, customer_id: str, limit: int = 10) -> list[dict[str, Any]]:
    rows = db.scalars(
        select(CustomerTransaction)
        .where(CustomerTransaction.customer_id == customer_id)
        .order_by(CustomerTransaction.occurred_at.desc())
        .limit(limit)
    ).all()
    return [
        {
            "transaction_id": row.transaction_id,
            "customer_id": row.customer_id,
            "merchant": row.merchant,
            "amount": float(row.amount),
            "currency": row.currency,
            "occurred_at": row.occurred_at.isoformat(),
        }
        for row in rows
    ]


def search_customers(db: Session, filter: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    filter = filter or {}
    stmt = select(Customer).order_by(Customer.customer_id)
    if city := filter.get("city"):
        stmt = stmt.where(Customer.city.ilike(city))
    if tier := filter.get("tier"):
        stmt = stmt.where(Customer.tier.ilike(tier))

    include_email = bool(filter.get("include_email"))
    include_contact = include_email or bool(filter.get("include_contact"))
    rows = db.scalars(stmt.limit(int(filter.get("limit", 100)))).all()
    return [_customer_to_dict(row, include_contact=include_contact) for row in rows]


def update_contact_info(db: Session, customer_id: str, new_value: dict[str, str]) -> dict[str, Any]:
    customer = db.get(Customer, customer_id)
    if not customer:
        return {"updated": False, "reason": "customer_not_found"}

    if email := new_value.get("email"):
        customer.email = email
    if phone := new_value.get("phone"):
        customer.phone = phone
    db.flush()
    return {"updated": True, "customer_id": customer.customer_id}


def build_customer_tool_registry() -> ToolRegistry:
    registry = ToolRegistry()
    registry.register(
        "get_customer_profile",
        get_customer_profile,
        metadata={"description": "Retrieve a scoped customer profile by customer ID."},
    )
    registry.register(
        "get_customer_transactions",
        get_customer_transactions,
        metadata={"description": "Retrieve recent customer transactions by customer ID."},
    )
    registry.register(
        "search_customers",
        search_customers,
        metadata={"description": "Search customer records using governed filters."},
    )
    registry.register(
        "update_contact_info",
        update_contact_info,
        metadata={"description": "Update customer contact details after policy approval."},
    )
    return registry
