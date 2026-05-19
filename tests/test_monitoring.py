from __future__ import annotations

from intelliguard.telemetry.monitoring import build_monitoring_metrics
from intelliguard.persistence.store import GovernanceStore


def test_monitoring_metrics_include_certification_and_review_health(
    store: GovernanceStore,
) -> None:
    tool = store.create_tool_record(
        {
            "tool_name": "monitoring_test_tool",
            "display_name": "Monitoring Test Tool",
            "description": "Tool used by monitoring metric tests.",
            "category": "tests",
            "side_effect_level": "read_only",
            "environment": "demo",
            "owner": "Tests",
            "input_schema": {"type": "object"},
            "output_schema": {"type": "object"},
            "permissions": {"requires_grant": True},
            "allowed_actions": ["read_test_data"],
            "metadata": {},
        }
    )
    store.update_tool_certification(tool["tool_id"], {"status": "CERTIFIED"})

    metrics = build_monitoring_metrics(store, environment="demo")

    assert metrics["certification_coverage"]["tools"]["certified"] >= 1
    assert "decision_totals" in metrics
    assert "review_queue" in metrics
    assert "evaluation_quality" in metrics
