from __future__ import annotations

from scripts.runtime_load_test import summarize_latencies


def test_runtime_load_summary_reports_percentiles() -> None:
    summary = summarize_latencies([0.1, 0.2, 0.3, 0.4, 0.5])

    assert summary["count"] == 5
    assert summary["p50"] == 0.3
    assert summary["p95"] == 0.5
    assert summary["p99"] == 0.5
