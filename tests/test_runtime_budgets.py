from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from intelliguard.runtime.budgets import (
    RuntimeBudget,
    RuntimeBudgetExceeded,
    assert_db_connection_budget,
)
from intelliguard.runtime.dispatcher import InMemoryRunQueue, QueueSaturatedError
from tests.test_runtime_dispatcher import FakeStore


def test_budget_stops_when_tool_call_limit_is_exceeded() -> None:
    events: list[dict] = []
    budget = RuntimeBudget(
        max_tool_calls=1,
        max_llm_calls=10,
        deadline=datetime.now(UTC) + timedelta(seconds=30),
        event_sink=events.append,
    )

    budget.record_tool_call()
    with pytest.raises(RuntimeBudgetExceeded):
        budget.record_tool_call()

    assert events[-1]["event_type"] == "budget.exceeded"


def test_budget_stops_when_llm_call_limit_is_exceeded() -> None:
    budget = RuntimeBudget(
        max_tool_calls=10,
        max_llm_calls=0,
        deadline=datetime.now(UTC) + timedelta(seconds=30),
    )

    with pytest.raises(RuntimeBudgetExceeded):
        budget.record_llm_call()


def test_budget_stops_after_deadline() -> None:
    budget = RuntimeBudget(
        max_tool_calls=10,
        max_llm_calls=10,
        deadline=datetime.now(UTC) - timedelta(seconds=1),
    )

    with pytest.raises(RuntimeBudgetExceeded):
        budget.assert_within_limits()


def test_dispatcher_rejects_saturated_queue() -> None:
    from intelliguard.runtime.dispatcher import RuntimeRunDispatcher

    queue = InMemoryRunQueue()
    dispatcher = RuntimeRunDispatcher(store=FakeStore(), queue=queue, max_queue_depth=0)

    with pytest.raises(QueueSaturatedError):
        dispatcher.submit(deployment_id="deploy-1", user_query="Handle case")


def test_db_connection_budget_fails_fast_when_pool_exceeds_budget() -> None:
    with pytest.raises(ValueError):
        assert_db_connection_budget(pool_size=10, max_overflow=10, max_budget=12)

    assert_db_connection_budget(pool_size=5, max_overflow=5, max_budget=12) is None
