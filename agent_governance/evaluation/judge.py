from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class JudgeResult:
    criterion_name: str
    status: str
    evidence_sentence: str
    judge_model: str | None
    prompt_version: str | None
    raw_response: str | None


async def run_judge(
    criterion_name: str,
    input_data: dict[str, Any],
    judge_config: dict[str, Any] | None = None,
) -> JudgeResult:
    _ = input_data, judge_config
    return JudgeResult(
        criterion_name=criterion_name,
        status="REVIEW",
        evidence_sentence=(
            "LLM-as-judge is not calibrated yet. Route this criterion through human "
            "review until judge versions and agreement metrics are available."
        ),
        judge_model=None,
        prompt_version=None,
        raw_response=None,
    )

