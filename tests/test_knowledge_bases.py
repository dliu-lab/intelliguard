from __future__ import annotations

from agent_governance.models import (
    AgentKBAssignment,
    KnowledgeBase,
    KnowledgeIndexVersion,
    KnowledgeSource,
)


def test_knowledge_models_are_declared() -> None:
    assert KnowledgeBase.__tablename__ == "knowledge_bases"
    assert KnowledgeSource.__tablename__ == "knowledge_sources"
    assert KnowledgeIndexVersion.__tablename__ == "knowledge_index_versions"
    assert AgentKBAssignment.__tablename__ == "agent_kb_assignments"
