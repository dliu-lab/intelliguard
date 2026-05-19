from __future__ import annotations

import pytest

from intelliguard.adapters.http_service import (
    ConnectorPolicyError,
    HttpServiceConnector,
    connector_tool_metadata,
    validate_connector_record,
)
from intelliguard.adapters.mcp_service import McpServiceConnector


def _connector_record() -> dict:
    return {
        "connector_id": "claims-http",
        "name": "Claims API",
        "connector_type": "http",
        "environment": "demo",
        "owner": "Claims Ops",
        "config": {
            "base_url": "https://claims.example.test",
            "timeout_seconds": 5,
            "secrets": {"api_key_ref": "secret://claims/api-key"},
            "allowed_operations": {
                "get_claim": {"method": "GET", "path": "/claims/{claim_id}"},
                "create_note": {"method": "POST", "path": "/claims/{claim_id}/notes"},
            },
        },
    }


def test_connector_registration_requires_environment_owner_and_secret_refs() -> None:
    record = validate_connector_record(_connector_record())

    assert record["environment"] == "demo"
    assert record["owner"] == "Claims Ops"
    assert record["config"]["secrets"] == {"api_key_ref": "secret://claims/api-key"}

    bad_record = _connector_record()
    bad_record["owner"] = ""
    with pytest.raises(ValueError, match="owner"):
        validate_connector_record(bad_record)

    bad_secret = _connector_record()
    bad_secret["config"]["secrets"] = {"api_key": "plain-text"}
    with pytest.raises(ValueError, match="Secrets must be stored by reference"):
        validate_connector_record(bad_secret)


def test_http_connector_blocks_operation_not_allow_listed() -> None:
    connector = HttpServiceConnector(_connector_record())

    with pytest.raises(ConnectorPolicyError, match="not allow-listed"):
        connector.execute("delete_claim", {"claim_id": "CLM-1"})


def test_http_connector_executes_allowed_operation_with_structured_metadata() -> None:
    calls = []

    def transport(request):
        calls.append(request)
        return {"status_code": 200, "json": {"claim_id": "CLM-1"}}

    connector = HttpServiceConnector(_connector_record(), transport=transport)
    result = connector.execute("get_claim", {"claim_id": "CLM-1"})

    assert calls[0]["method"] == "GET"
    assert calls[0]["url"] == "https://claims.example.test/claims/CLM-1"
    assert calls[0]["timeout_seconds"] == 5
    assert result.ok is True
    assert result.metadata["connector_id"] == "claims-http"
    assert result.data == {"claim_id": "CLM-1"}


def test_tool_records_can_reference_connector_operation() -> None:
    metadata = connector_tool_metadata("claims-http", "get_claim")

    assert metadata["connector_id"] == "claims-http"
    assert metadata["connector_operation"] == "get_claim"
    assert metadata["execution_boundary"] == "service_connector"


def test_mcp_connector_maps_server_tool_to_tool_record() -> None:
    connector = McpServiceConnector(server_name="claims-mcp", environment="demo")
    payload = connector.tool_to_registration_payload(
        tool_name="lookup_claim",
        description="Look up claim details.",
        input_schema={"type": "object"},
    )

    assert payload["tool_name"] == "claims_mcp.lookup_claim"
    assert payload["metadata"]["mcp_server_name"] == "claims-mcp"
    assert payload["metadata"]["execution_boundary"] == "mcp_connector"
