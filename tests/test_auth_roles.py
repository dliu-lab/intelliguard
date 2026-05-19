from __future__ import annotations

import pytest

from intelliguard.persistence.models import new_id
from intelliguard.persistence.store import GovernanceStore


def test_multi_role_user_can_select_active_login_role(store: GovernanceStore) -> None:
    email = f"{new_id('multi_role')}@example.com"
    store.create_user(
        email=email,
        password="password-123",
        display_name="Multi Role User",
        roles=["Agent Developer", "Support Operations Manager"],
        is_super_admin=False,
        environment_access=[],
    )

    default_user, default_token = store.authenticate_user(email=email, password="password-123")
    assert default_user["role"] == "Agent Developer"
    assert default_user["roles"] == ["Agent Developer", "Support Operations Manager"]
    assert store.user_context_for_token(default_token)["role"] == "Agent Developer"

    selected_user, selected_token = store.authenticate_user(
        email=email, password="password-123", role="Support Operations Manager"
    )
    assert selected_user["role"] == "Support Operations Manager"
    assert selected_user["roles"] == ["Agent Developer", "Support Operations Manager"]
    assert store.user_context_for_token(selected_token)["role"] == "Support Operations Manager"

    with pytest.raises(ValueError, match="Selected role does not match this account"):
        store.authenticate_user(email=email, password="password-123", role="Governance Reviewer")


def test_login_role_options_are_limited_to_authenticated_account_roles(
    store: GovernanceStore,
) -> None:
    email = f"{new_id('login_roles')}@example.com"
    store.create_user(
        email=email,
        password="password-123",
        display_name="Login Role User",
        roles=["Agent Developer", "Support Operations Manager"],
        is_super_admin=False,
        environment_access=[],
    )

    role_options = store.login_role_options(email=email, password="password-123")

    assert role_options == {
        "roles": ["Agent Developer", "Support Operations Manager"],
        "default_role": "Agent Developer",
    }

    with pytest.raises(ValueError, match="Invalid email or password"):
        store.login_role_options(email=email, password="wrong-password")
