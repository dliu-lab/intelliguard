from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Any

from intelliguard.adk.manifest import RuntimeManifest


SECRET_KEY_TOKENS = ("secret", "password", "token", "credential", "api_key", "apikey")


@dataclass(frozen=True)
class GeneratedArtifact:
    artifact_type: str
    artifact_name: str
    content: str

    @property
    def content_hash(self) -> str:
        return hashlib.sha256(self.content.encode("utf-8")).hexdigest()[:24]


def _scrub_secrets(value: Any) -> Any:
    if isinstance(value, dict):
        scrubbed: dict[str, Any] = {}
        for key, item in value.items():
            if any(token in key.lower() for token in SECRET_KEY_TOKENS):
                scrubbed[key] = "[redacted]"
            else:
                scrubbed[key] = _scrub_secrets(item)
        return scrubbed
    if isinstance(value, list):
        return [_scrub_secrets(item) for item in value]
    return value


def generate_runtime_artifacts(
    manifest: RuntimeManifest,
    *,
    worker_pool: str,
) -> list[GeneratedArtifact]:
    artifacts = [
        GeneratedArtifact(
            artifact_type="runtime_manifest",
            artifact_name=f"{manifest.deployment_id}.manifest.json",
            content=json.dumps(
                _runtime_manifest_payload(manifest, worker_pool=worker_pool),
                sort_keys=True,
                indent=2,
            ),
        )
    ]
    if manifest.runtime_type == "langgraph":
        artifacts.append(_langgraph_module(manifest, worker_pool=worker_pool))
    if manifest.runtime_type == "strands":
        artifacts.append(_strands_module(manifest, worker_pool=worker_pool))
    artifacts.append(_k8s_manifest(manifest, worker_pool=worker_pool))
    return artifacts


def persist_runtime_artifacts(
    *,
    store: Any,
    deployment_id: str,
    workflow_definition_id: str,
    artifacts: list[GeneratedArtifact],
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for artifact in artifacts:
        rows.append(
            store.create_workflow_generated_artifact(
                {
                    "deployment_id": deployment_id,
                    "workflow_definition_id": workflow_definition_id,
                    "artifact_type": artifact.artifact_type,
                    "artifact_name": artifact.artifact_name,
                    "content": artifact.content,
                    "content_hash": artifact.content_hash,
                    "status": "GENERATED",
                }
            )
        )
    return rows


def _runtime_manifest_payload(manifest: RuntimeManifest, *, worker_pool: str) -> dict[str, Any]:
    payload = manifest.model_dump(mode="json")
    payload["metadata"] = {
        **(payload.get("metadata") or {}),
        "worker_pool": worker_pool,
        "manifest_hash": manifest.manifest_hash(),
    }
    return _scrub_secrets(payload)


def _langgraph_module(manifest: RuntimeManifest, *, worker_pool: str) -> GeneratedArtifact:
    return GeneratedArtifact(
        artifact_type="langgraph_module",
        artifact_name=f"{manifest.deployment_id}_langgraph.py",
        content=(
            "from intelliguard.adapters.langgraph import LangGraphBuildAdapter\n"
            "from intelliguard.adk.manifest import RuntimeManifest\n\n"
            f"DEPLOYMENT_ID = {manifest.deployment_id!r}\n"
            f"GRAPH_VERSION_HASH = {manifest.graph_version_hash!r}\n"
            f"WORKER_POOL = {worker_pool!r}\n"
            f"MANIFEST = {json.dumps(_runtime_manifest_payload(manifest, worker_pool=worker_pool), sort_keys=True)!r}\n\n"
            "def build_graph():\n"
            "    manifest = RuntimeManifest.model_validate_json(MANIFEST)\n"
            "    return LangGraphBuildAdapter().build(manifest)\n"
        ),
    )


def _strands_module(manifest: RuntimeManifest, *, worker_pool: str) -> GeneratedArtifact:
    return GeneratedArtifact(
        artifact_type="strands_module",
        artifact_name=f"{manifest.deployment_id}_strands.py",
        content=(
            "from intelliguard.adapters.strands import StrandsBuildAdapter\n"
            "from intelliguard.adk.manifest import RuntimeManifest\n\n"
            f"DEPLOYMENT_ID = {manifest.deployment_id!r}\n"
            f"GRAPH_VERSION_HASH = {manifest.graph_version_hash!r}\n"
            f"WORKER_POOL = {worker_pool!r}\n"
            f"MANIFEST = {json.dumps(_runtime_manifest_payload(manifest, worker_pool=worker_pool), sort_keys=True)!r}\n\n"
            "def build_agent_runtime():\n"
            "    manifest = RuntimeManifest.model_validate_json(MANIFEST)\n"
            "    return StrandsBuildAdapter().build(manifest)\n"
        ),
    )


def _k8s_manifest(manifest: RuntimeManifest, *, worker_pool: str) -> GeneratedArtifact:
    name = manifest.deployment_id.replace("_", "-")
    return GeneratedArtifact(
        artifact_type="k8s_manifest",
        artifact_name=f"{manifest.deployment_id}.k8s.yaml",
        content=(
            "apiVersion: apps/v1\n"
            "kind: Deployment\n"
            "metadata:\n"
            f"  name: intelliguard-runtime-{name}\n"
            "  labels:\n"
            f"    intelliguard.ai/deployment-id: {manifest.deployment_id}\n"
            f"    intelliguard.ai/manifest-hash: {manifest.manifest_hash()}\n"
            f"    intelliguard.ai/graph-hash: {manifest.graph_version_hash}\n"
            f"    intelliguard.ai/runtime-type: {manifest.runtime_type}\n"
            f"    intelliguard.ai/worker-pool: {worker_pool}\n"
            "spec:\n"
            "  replicas: 1\n"
            "  selector:\n"
            "    matchLabels:\n"
            f"      app: intelliguard-runtime-{name}\n"
            "  template:\n"
            "    metadata:\n"
            "      labels:\n"
            f"        app: intelliguard-runtime-{name}\n"
            f"        intelliguard.ai/worker-pool: {worker_pool}\n"
            "    spec:\n"
            "      containers:\n"
            "        - name: workflow-runner\n"
            "          image: ${INTELLIGUARD_RUNTIME_IMAGE}\n"
            "          env:\n"
            f"            - name: INTELLIGUARD_DEPLOYMENT_ID\n              value: {manifest.deployment_id}\n"
            f"            - name: INTELLIGUARD_MANIFEST_HASH\n              value: {manifest.manifest_hash()}\n"
        ),
    )
