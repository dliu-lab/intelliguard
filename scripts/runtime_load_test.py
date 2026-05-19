from __future__ import annotations

import argparse
import json
import statistics
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any


def summarize_latencies(values: list[float]) -> dict[str, float | int]:
    if not values:
        return {"count": 0, "p50": 0.0, "p95": 0.0, "p99": 0.0}
    sorted_values = sorted(values)
    return {
        "count": len(sorted_values),
        "p50": round(statistics.median(sorted_values), 4),
        "p95": round(_percentile(sorted_values, 0.95), 4),
        "p99": round(_percentile(sorted_values, 0.99), 4),
    }


def run_load_test(
    *,
    api_base_url: str,
    deployment_id: str,
    runs: int,
    concurrency: int,
) -> dict[str, Any]:
    latencies: list[float] = []
    with ThreadPoolExecutor(max_workers=concurrency) as executor:
        futures = [
            executor.submit(_submit_run, api_base_url, deployment_id, index)
            for index in range(runs)
        ]
        for future in as_completed(futures):
            latencies.append(future.result())
    return {
        "workflow_latency_seconds": summarize_latencies(latencies),
        "tool_gateway_latency_seconds": {"count": 0, "p50": 0.0, "p95": 0.0, "p99": 0.0},
        "policy_decision_latency_seconds": {"count": 0, "p50": 0.0, "p95": 0.0, "p99": 0.0},
        "evaluator_latency_seconds": {"count": 0, "p50": 0.0, "p95": 0.0, "p99": 0.0},
        "event_stream_lag_seconds": {"count": 0, "p50": 0.0, "p95": 0.0, "p99": 0.0},
        "queue_wait_seconds": {"count": 0, "p50": 0.0, "p95": 0.0, "p99": 0.0},
    }


def _submit_run(api_base_url: str, deployment_id: str, index: int) -> float:
    body = json.dumps(
        {
            "deployment_id": deployment_id,
            "query": f"Performance smoke run {index}",
            "idempotency_key": f"perf-{index}",
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        f"{api_base_url.rstrip('/')}/v1/multi-agent-runs",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    start = time.perf_counter()
    with urllib.request.urlopen(request, timeout=30) as response:
        response.read()
    return time.perf_counter() - start


def _percentile(values: list[float], percentile: float) -> float:
    index = min(len(values) - 1, max(0, int(round((len(values) - 1) * percentile))))
    return values[index]


def main() -> None:
    parser = argparse.ArgumentParser(description="Run IntelliGuard workflow runtime load test.")
    parser.add_argument("--deployment-id", required=True)
    parser.add_argument("--runs", type=int, default=10)
    parser.add_argument("--concurrency", type=int, default=2)
    parser.add_argument("--api-base-url", default="http://localhost:8000")
    args = parser.parse_args()
    print(
        json.dumps(
            run_load_test(
                api_base_url=args.api_base_url,
                deployment_id=args.deployment_id,
                runs=args.runs,
                concurrency=args.concurrency,
            ),
            indent=2,
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
