from __future__ import annotations

import io

from agent_governance.runtime.deployment_orchestrator import (
    DeploymentJobRequest,
    DeploymentOrchestrator,
    KubernetesDeploymentBackend,
    LocalComposeDeploymentBackend,
)


class FakeResponse(io.BytesIO):
    status = 200

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


class FakeStore:
    def __init__(self) -> None:
        self.jobs: list[dict] = []

    def create_deployment_job(self, payload: dict) -> dict:
        job = {"job_id": f"job-{len(self.jobs) + 1}", **payload}
        self.jobs.append(job)
        return job

    def update_deployment_job(self, job_id: str, payload: dict) -> dict:
        for job in self.jobs:
            if job["job_id"] == job_id:
                job.update(payload)
                return job
        raise ValueError("missing job")


def test_local_compose_backend_returns_running_only_after_health_probe(monkeypatch) -> None:
    monkeypatch.setattr(
        "urllib.request.urlopen",
        lambda *_args, **_kwargs: FakeResponse(b"ok"),
    )
    backend = LocalComposeDeploymentBackend(health_url="http://worker/health")

    result = backend.deploy(
        DeploymentJobRequest(
            deployment_id="deploy-1",
            environment="local",
            backend="local_compose",
            requested_by="ops@example.com",
            worker_pool="shared-readonly",
        )
    )

    assert result.status == "RUNNING"
    assert "reachable" in result.logs[0]


def test_deployment_orchestrator_persists_failed_compose_logs(monkeypatch) -> None:
    def _raise(*_args, **_kwargs):
        raise OSError("connection refused")

    monkeypatch.setattr("urllib.request.urlopen", _raise)
    store = FakeStore()
    orchestrator = DeploymentOrchestrator(
        store=store,
        backends={"local_compose": LocalComposeDeploymentBackend("http://worker/health")},
    )

    job = orchestrator.deploy(
        DeploymentJobRequest(
            deployment_id="deploy-1",
            environment="local",
            backend="local_compose",
            requested_by="ops@example.com",
            worker_pool="shared-readonly",
        )
    )

    assert job["status"] == "FAILED"
    assert "health check failed" in job["logs"][0]


def test_kubernetes_backend_records_deploying_workloads() -> None:
    backend = KubernetesDeploymentBackend(namespace="intelliguard")

    result = backend.deploy(
        DeploymentJobRequest(
            deployment_id="deploy_1",
            environment="production",
            backend="kubernetes",
            requested_by="ops@example.com",
            worker_pool="shared-governed-write",
        )
    )

    assert result.status == "DEPLOYING"
    assert result.workload_names == ["intelliguard-runtime-deploy-1"]
