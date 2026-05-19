from __future__ import annotations

from intelliguard.adk.manifest import RuntimeManifest
from intelliguard.runtime.codegen import generate_runtime_artifacts, persist_runtime_artifacts


def _manifest(runtime_type: str = "langgraph") -> RuntimeManifest:
    return RuntimeManifest.model_validate(
        {
            "manifest_version": "1.0",
            "workflow_definition_id": "workflow-1",
            "deployment_id": "deploy-1",
            "environment": "pre_prod",
            "runtime_type": runtime_type,
            "graph_version_hash": "graph-hash",
            "nodes": [{"node_id": "lead", "agent_id": "agent-1", "node_type": "lead_agent"}],
            "edges": [],
            "policy_snapshots": {"agent-1": "policy-hash"},
            "tool_snapshots": {"tool-1": "tool-hash"},
            "evaluator_snapshots": {},
            "knowledge_snapshots": {},
            "runtime_limits": {
                "timeout_seconds": 300,
                "max_parallel_nodes": 4,
                "max_tool_calls": 30,
                "max_llm_calls": 20,
                "max_cost_usd": 5.0,
            },
            "metadata": {"secret_ref": "vault://runtime/api-key", "password": "do-not-render"},
        }
    )


class FakeStore:
    def __init__(self) -> None:
        self.artifacts: list[dict] = []

    def create_workflow_generated_artifact(self, payload: dict) -> dict:
        artifact = {"artifact_id": f"artifact-{len(self.artifacts) + 1}", **payload}
        self.artifacts.append(artifact)
        return artifact


def test_generate_runtime_artifacts_include_runtime_code_and_k8s_without_secret_values() -> None:
    artifacts = generate_runtime_artifacts(_manifest("langgraph"), worker_pool="shared-readonly")
    by_type = {artifact.artifact_type: artifact for artifact in artifacts}

    assert {"runtime_manifest", "langgraph_module", "k8s_manifest"} <= set(by_type)
    for artifact in artifacts:
        assert "deploy-1" in artifact.content
        assert "graph-hash" in artifact.content
        assert "shared-readonly" in artifact.content
        assert "do-not-render" not in artifact.content
        assert "vault://runtime/api-key" not in artifact.content


def test_persist_runtime_artifacts_records_content_hashes() -> None:
    store = FakeStore()
    artifacts = generate_runtime_artifacts(_manifest("strands"), worker_pool="shared-readonly")

    rows = persist_runtime_artifacts(
        store=store,
        deployment_id="deploy-1",
        workflow_definition_id="workflow-1",
        artifacts=artifacts,
    )

    assert rows[0]["content_hash"] == artifacts[0].content_hash
    assert any(row["artifact_type"] == "strands_module" for row in rows)
