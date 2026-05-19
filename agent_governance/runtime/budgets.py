from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Callable


class RuntimeBudgetExceeded(RuntimeError):
    pass


@dataclass
class RuntimeBudget:
    max_tool_calls: int
    max_llm_calls: int
    deadline: datetime
    event_sink: Callable[[dict], None] | None = None
    tool_calls: int = 0
    llm_calls: int = 0

    def record_tool_call(self) -> None:
        self.tool_calls += 1
        self.assert_within_limits()

    def record_llm_call(self) -> None:
        self.llm_calls += 1
        self.assert_within_limits()

    def assert_within_limits(self) -> None:
        if self.tool_calls > self.max_tool_calls:
            self._raise("max_tool_calls exceeded")
        if self.llm_calls > self.max_llm_calls:
            self._raise("max_llm_calls exceeded")
        if datetime.now(UTC) > self.deadline:
            self._raise("runtime timeout exceeded")

    def _raise(self, reason: str) -> None:
        event = {"event_type": "budget.exceeded", "reason": reason}
        if self.event_sink:
            self.event_sink(event)
        raise RuntimeBudgetExceeded(reason)


def assert_db_connection_budget(*, pool_size: int, max_overflow: int, max_budget: int) -> None:
    possible_connections = pool_size + max_overflow
    if possible_connections > max_budget:
        raise ValueError(
            "DB connection budget exceeded: "
            f"pool_size + max_overflow = {possible_connections}, budget = {max_budget}."
        )
