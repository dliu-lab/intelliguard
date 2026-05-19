# IntelliGuard SDK and API for Enterprise AI Agents

A Python SDK, FastAPI service, and React dashboard for governing AI agents at runtime.
The platform intercepts tool calls from agents, CLIs, and microservices, detects risks
such as prompt injection, data overexposure, and tool misuse, enforces deterministic
policy decisions, and visualizes each agent run as an auditable workflow trace.

## What It Builds

- Python governance SDK for agent frameworks and custom agents.
- FastAPI governance API for microservices and non-Python systems.
- Postgres governance store for audit events, review queue, workflow traces, registry records, and evaluations.
- React dashboard with an n8n-style workflow trace and workflow designer.
- CLI harness for a governed agent using explicitly registered tools.
- Agent, tool, evaluator, guardrail, and knowledge-base registries with certification-aware permission grants.
- Multi-agent workflow grouping with lead and sub-agent traces.

## Tech Stack

Backend and governance runtime:

- Python 3.11+ package, built into a Python 3.12 API container.
- FastAPI service served by Uvicorn.
- Pydantic v2 response and request models.
- SQLAlchemy 2 with `psycopg` for persistence.
- PostgreSQL 16 in Docker Compose for audit events, review queue, workflow traces,
  runtime policies, agents, tools, evaluators, guardrails, and knowledge bases.
- YAML policy loading through PyYAML.
- Pytest and Ruff for backend verification and linting.

Dashboard:

- Next.js App Router with TypeScript.
- React 19 UI components.
- Tailwind CSS for styling and design tokens.
- Lucide React icons.
- Framer Motion for animated landing-page interactions.
- Static export through `next build`, served from Nginx in the dashboard container.

Local and container runtime:

- Docker Compose runs Postgres, the FastAPI API, and the static dashboard.
- Root `npm` scripts proxy to the dashboard package for local frontend commands.
- Dashboard API calls use `NEXT_PUBLIC_API_BASE_URL`, defaulting to
  `http://localhost:8000`.

## Run With Docker

```bash
docker compose up --build
```

Services:

- API: `http://localhost:8000`
- API docs: `http://localhost:8000/docs`
- Dashboard: `http://localhost:5175`
- Postgres: `localhost:55432`
- Workflow runner health: `http://localhost:8010/health`

The API initializes and migrates tables on startup when `AUTO_INIT_DB=true`.
It does not seed demo records by default. Set `SEED_DEMO_DATA=true` only for local demos.

Production-like runtime workers are included in the base Compose file:

- `workflow-runner` claims queued `workflow_runtime_runs` and executes certified deployment manifests.
- `evaluator-worker` reserves the async evaluator queue boundary.
- `event-worker` reserves the runtime event outbox publishing boundary.
- `kb-worker` indexes knowledge-base documents.

Optional Temporal services can be rendered or started with:

```bash
docker compose -f docker-compose.yml -f docker-compose.temporal.yml config
docker compose -f docker-compose.yml -f docker-compose.temporal.yml up --build
```

Runtime configuration variables:

| Variable | Purpose |
|---|---|
| `RUNTIME_QUEUE_BACKEND` | Queue implementation selector; current local default uses Postgres-backed polling. |
| `TEMPORAL_ADDRESS` | Temporal frontend address for durable workflow workers. |
| `WORKFLOW_RUNNER_CONCURRENCY` | Maximum workflow runs a runner process should execute concurrently. |
| `TOOL_GATEWAY_TIMEOUT_MS` | Connector/tool call timeout budget. |
| `MODEL_GATEWAY_ALLOWED_PROVIDERS` | Comma-separated model providers allowed through the model gateway. |
| `RUNTIME_MAX_PARALLEL_NODES` | Platform cap for manifest `max_parallel_nodes`. |
| `DB_POOL_SIZE` / `DB_MAX_OVERFLOW` | SQLAlchemy pool sizing per process. |
| `MAX_DB_CONNECTION_BUDGET` | Guardrail for maximum DB connections consumed by a worker process. |

Runtime performance smoke:

```bash
python scripts/runtime_load_test.py --deployment-id dep_123 --runs 1000 --concurrency 50
```

The script reports p50, p95, and p99 workflow latency plus placeholders for tool gateway,
policy decision, evaluator, event stream lag, and queue wait metrics. Those placeholder
metrics are populated once the corresponding runtime spans are exported by the event worker.

## Demo CLI

The CLI harness is for local demos only and expects `SEED_DEMO_DATA=true`.
After installing the Python package locally:

```bash
pip install -e .
governance-agent "Show recent transactions for customer C123"
governance-agent "Dump all customer data"
governance-agent "Find all customers in Melbourne and show their emails"
```

Use `DATABASE_URL` to point the CLI at Postgres.

## API Examples

List registered agents, list registered tools, evaluate a tool contract, and grant a tool permission.
These examples assume you have already registered the agent and tool records through
the dashboard or API:

```bash
curl http://localhost:8000/v1/agents

curl http://localhost:8000/v1/tools

curl -X POST http://localhost:8000/v1/tools/tool_example/evaluate

curl -X POST http://localhost:8000/v1/agents/banking-account-inquiry-agent/tool-grants \
  -H "Content-Type: application/json" \
  -d '{"tool_name":"get_account_summary"}'
```

Evaluate-only mode:

```bash
curl -X POST http://localhost:8000/v1/evaluate-tool-call \
  -H "Content-Type: application/json" \
  -d '{"agent_id":"banking-account-inquiry-agent","session_id":"sess_demo","user_query":"Summarize account activity for authenticated account A123","tool_name":"get_account_summary","tool_args":{"account_id":"A123"}}'
```

Gateway mode:

```bash
curl -X POST http://localhost:8000/v1/governed-tool-call \
  -H "Content-Type: application/json" \
  -d '{"agent_id":"banking-account-inquiry-agent","session_id":"sess_demo","user_query":"Summarize account activity for authenticated account A123","tool_name":"get_account_summary","tool_args":{"account_id":"A123"}}'
```

Agent demo mode:

```bash
curl -X POST http://localhost:8000/v1/agent-runs \
  -H "Content-Type: application/json" \
  -d '{"query":"Dump all customer data"}'
```

Multi-agent workflow mode:

```bash
curl -X POST http://localhost:8000/v1/multi-agent-runs \
  -H "Content-Type: application/json" \
  -d '{"query":"Prepare a safe account inquiry response for authenticated account A123"}'

curl http://localhost:8000/v1/workflows
```

## Workflow Spec

See [docs/workflow-spec.md](docs/workflow-spec.md).

## Naming Conventions

Use stable, lowercase identifiers so agents, workflow graphs, audit evidence, and
policy bindings stay predictable across the API and dashboard.

| Field | Convention | Example |
|---|---|---|
| `agent_id` | kebab-case | `banking-auth-gate-agent` |
| `workflow_definition_id` | kebab-case | `banking-account-inquiry` |
| `tool_name` | snake_case | `get_customer_profile` |
| `step_id` / `node_id` | snake_case | `auth_gate` |
| `domain` | snake_case | `banking_accounts` |
| `environment` | lowercase token using letters, numbers, hyphens, or underscores | `demo`, `pre_prod` |
| `agent_type` / `node_type` | shared controlled vocabulary | `lead_agent`, `gate_agent`, `task_agent` |
| `version` | semver-style | `1.0.0` |

Shared `agent_type` / `node_type` values:

- `lead_agent`
- `gate_agent`
- `task_agent`
- `review_agent`
- `approval_agent`
- `terminal_agent`

Workflow node type is derived from the registered agent type. If the same runtime
needs a different workflow role, register a separate configured agent identity or
version rather than overriding the type inside a workflow.
