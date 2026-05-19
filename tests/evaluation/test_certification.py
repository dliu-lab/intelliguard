from __future__ import annotations

import pytest

from intelliguard.evaluation.certification import (
    CertificationError,
    decide_certification,
    validate_transition,
)


def test_review_without_fail_certifies() -> None:
    decision = decide_certification(
        [
            {"criterion_name": "input_schema_validation", "status": "PASS", "evidence_sentence": "ok"},
            {"criterion_name": "pii_field_leakage", "status": "REVIEW", "evidence_sentence": "review"},
        ]
    )
    assert decision.status == "CERTIFIED"
    assert decision.failure_reason is None


def test_fail_blocks_certification() -> None:
    decision = decide_certification(
        [
            {
                "criterion_name": "input_schema_validation",
                "status": "FAIL",
                "evidence_sentence": "schema missing",
            }
        ]
    )
    assert decision.status == "FAILED"
    assert "schema missing" in (decision.failure_reason or "")


def test_valid_transitions() -> None:
    validate_transition("DRAFT", "EVALUATING")
    validate_transition("EVALUATING", "CERTIFIED")
    validate_transition("CERTIFIED", "NEEDS_REEVALUATION")
    validate_transition("FAILED", "EVALUATING")


def test_invalid_transition_raises() -> None:
    with pytest.raises(CertificationError, match="DRAFT -> CERTIFIED"):
        validate_transition("DRAFT", "CERTIFIED")

