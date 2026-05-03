from __future__ import annotations

import asyncio

from agent_governance.evaluation.judge import run_judge


def test_judge_stub_returns_review() -> None:
    result = asyncio.run(run_judge("response_quality", {"response": "test response"}))
    assert result.status == "REVIEW"
    assert result.criterion_name == "response_quality"
    assert result.judge_model is None

