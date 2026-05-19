from __future__ import annotations

import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Protocol
from uuid import uuid4


@dataclass(frozen=True)
class DeploymentJobRequest:
    deployment_id: str
    environment: str
    backend: str
    requested_by: str
    worker_pool: str
    artifact_ids: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class DeploymentJobResult:
    status: str
    image_ref: str | None = None
    logs: list[str] = field(default_factory=list)
    workload_names: list[str] = field(default_factory=list)


class DeploymentBackend(Protocol):
    backend_name: str

    def deploy(self, request: DeploymentJobRequest) -> DeploymentJobResult:
        raise NotImplementedError


class LocalComposeDeploymentBackend:
    backend_name = "local_compose"

    def __init__(self, health_url: str) -> None:
        self.health_url = health_url

    def verify_worker_pool_health(self) -> tuple[bool, str]:
        try:
            with urllib.request.urlopen(self.health_url, timeout=3) as response:
                if 200 <= response.status < 300:
                    return True, f"Worker pool reachable at {self.health_url}."
                return False, f"Worker pool returned HTTP {response.status}."
        except (OSError, urllib.error.URLError) as exc:
            return False, f"Worker pool health check failed: {exc}."

    def deploy(self, request: DeploymentJobRequest) -> DeploymentJobResult:
        healthy, message = self.verify_worker_pool_health()
        if not healthy:
            return DeploymentJobResult(status="FAILED", logs=[message])
        return DeploymentJobResult(
            status="RUNNING",
            logs=[
                message,
                "Local Compose backend uses the preconfigured workflow-runner service.",
                f"Deployment {request.deployment_id} assigned to worker pool {request.worker_pool}.",
            ],
        )


class KubernetesDeploymentBackend:
    backend_name = "kubernetes"

    def __init__(self, namespace: str = "default") -> None:
        self.namespace = namespace

    def deploy(self, request: DeploymentJobRequest) -> DeploymentJobResult:
        workload = f"intelliguard-runtime-{request.deployment_id.replace('_', '-')}"
        return DeploymentJobResult(
            status="DEPLOYING",
            logs=[
                f"Kubernetes deployment recorded for namespace {self.namespace}.",
                f"Workload {workload} should be applied by CI/CD or the cluster operator.",
            ],
            workload_names=[workload],
        )


class DeploymentOrchestrator:
    def __init__(self, *, store: Any, backends: dict[str, DeploymentBackend]) -> None:
        self.store = store
        self.backends = backends

    def deploy(self, request: DeploymentJobRequest) -> dict[str, Any]:
        backend = self.backends.get(request.backend)
        if backend is None:
            raise ValueError(f"Unsupported deployment backend: {request.backend}")
        started = self.store.create_deployment_job(
            {
                "job_id": f"job_{uuid4().hex[:16]}",
                "deployment_id": request.deployment_id,
                "environment": request.environment,
                "backend": request.backend,
                "status": "DEPLOYING",
                "requested_by": request.requested_by,
                "worker_pool": request.worker_pool,
                "logs": [f"Starting {request.backend} deployment."],
            }
        )
        result = backend.deploy(request)
        payload = {
            "status": result.status,
            "image_ref": result.image_ref,
            "logs": [*result.logs, *started.get("logs", [])],
            "worker_pool": request.worker_pool,
            "metadata": {"workload_names": result.workload_names},
        }
        if result.status == "FAILED":
            payload["error"] = result.logs[-1] if result.logs else "Deployment failed"
        return self.store.update_deployment_job(started["job_id"], payload)
