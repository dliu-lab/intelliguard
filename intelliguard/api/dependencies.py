from __future__ import annotations

from typing import Any

from fastapi import Header, HTTPException

from intelliguard.store import GovernanceStore


def bearer_token(authorization: str | None = Header(default=None, alias="Authorization")) -> str:
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="Authentication required")
    return token


def current_user_for_token(token: str, store: GovernanceStore) -> dict[str, Any]:
    user = store.user_context_for_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    return user


def require_super_admin(user: dict[str, Any]) -> None:
    if not user.get("is_super_admin"):
        raise HTTPException(status_code=403, detail="Super admin access required")


def visible_environment(environment: str | None, user: dict[str, Any]) -> str | list[str] | None:
    if user["is_super_admin"]:
        return None if environment in (None, "all") else environment
    allowed = user["allowed_environments"]
    if not allowed:
        raise HTTPException(
            status_code=403, detail="No environment access has been assigned to this user"
        )
    if environment in (None, "all"):
        return allowed
    if environment not in allowed:
        raise HTTPException(
            status_code=403, detail=f"Role {user['role']} cannot access {environment}"
        )
    return environment


def require_environment_access(
    user: dict[str, Any],
    environment: str | None,
    store: GovernanceStore,
    permission: str = "read",
) -> None:
    if user["is_super_admin"]:
        return
    if not environment or not store.user_has_permission(user, environment, permission):
        raise HTTPException(
            status_code=403,
            detail=f"Role {user['role']} cannot perform {permission} in {environment or 'this environment'}",
        )


def require_agent_identity_for_access(
    agent_id: str,
    user: dict[str, Any],
    store: GovernanceStore,
    permission: str = "read",
) -> dict[str, Any]:
    identity = store.find_agent_identity(agent_id)
    if not identity:
        raise HTTPException(status_code=404, detail="Agent not found")
    require_environment_access(user, identity.get("environment"), store, permission)
    return identity
