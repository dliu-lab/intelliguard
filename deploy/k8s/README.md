# IntelliGuard Kubernetes Runtime Base

Apply the base manifests after replacing `secrets.example.yaml` with an environment-specific secret:

```bash
kubectl create namespace intelliguard
kubectl apply -k deploy/k8s/base
kubectl rollout status deployment/intelliguard-api -n intelliguard
kubectl rollout status deployment/intelliguard-workflow-runner -n intelliguard
```

The base separates the control plane from workflow, evaluator, knowledge, event, and Temporal workers so each pool can scale and be isolated independently.
