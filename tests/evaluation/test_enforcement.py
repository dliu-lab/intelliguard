from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from agent_governance.evaluation.enforcement import (
    CertificationEnforcementError,
    check_agent_certification,
    check_tool_certification,
    check_workflow_certification,
)


def _store_with_cert(status: str) -> MagicMock:
    store = MagicMock()
    store.get_tool_certification.return_value = {"status": status}
    return store


def test_certified_tool_passes_in_production() -> None:
    check_tool_certification(_store_with_cert("CERTIFIED"), "tool_123", "production")


def test_draft_tool_blocked_in_production() -> None:
    with pytest.raises(CertificationEnforcementError, match="DRAFT"):
        check_tool_certification(_store_with_cert("DRAFT"), "tool_123", "production")


def test_draft_tool_allowed_in_lower_environment() -> None:
    check_tool_certification(_store_with_cert("DRAFT"), "tool_123", "dev")


def test_failed_tool_blocked_in_lower_environment() -> None:
    with pytest.raises(CertificationEnforcementError, match="FAILED"):
        check_tool_certification(_store_with_cert("FAILED"), "tool_123", "dev")


def _agent_store_with_cert(status: str | None) -> MagicMock:
    store = MagicMock()
    store.get_agent_certification.return_value = {"status": status} if status else None
    return store


def test_certified_agent_passes_in_production() -> None:
    check_agent_certification(_agent_store_with_cert("CERTIFIED"), "agent_123", "production")


def test_uncertified_agent_blocked_in_production() -> None:
    with pytest.raises(CertificationEnforcementError, match="FAILED"):
        check_agent_certification(_agent_store_with_cert("FAILED"), "agent_123", "production")


def test_missing_agent_certification_allowed_in_lower_environment() -> None:
    check_agent_certification(_agent_store_with_cert(None), "agent_123", "demo")


def test_failed_agent_blocked_in_lower_environment() -> None:
    with pytest.raises(CertificationEnforcementError, match="FAILED"):
        check_agent_certification(_agent_store_with_cert("FAILED"), "agent_123", "demo")


def _workflow_store_with_cert(status: str | None) -> MagicMock:
    store = MagicMock()
    store.get_workflow_certification.return_value = {"status": status} if status else None
    return store


def test_certified_workflow_passes_in_production() -> None:
    check_workflow_certification(
        _workflow_store_with_cert("CERTIFIED"), "workflow_123", "production"
    )


def test_missing_workflow_certification_allowed_in_lower_environment() -> None:
    check_workflow_certification(_workflow_store_with_cert(None), "workflow_123", "demo")


def test_failed_workflow_blocked_in_lower_environment() -> None:
    with pytest.raises(CertificationEnforcementError, match="FAILED"):
        check_workflow_certification(
            _workflow_store_with_cert("FAILED"), "workflow_123", "demo"
        )
