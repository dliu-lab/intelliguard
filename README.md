# IntelliGuard SDK and API for Enterprise AI Agents

A Python SDK, FastAPI service, and React dashboard for governing AI agents at runtime.
The platform intercepts tool calls from agents, CLIs, and microservices, detects risks
such as prompt injection, data overexposure, and tool misuse, enforces deterministic
policy decisions, and visualizes each agent run as an auditable workflow trace.

## What It Builds

- Python governance SDK for agent frameworks and custom agents.
- FastAPI governance API for microservices and non-Python systems.
- Postgres audit store, review queue, customer demo data, and workflow events.
- React dashboard with an n8n-style workflow trace and workflow designer.
- CLI demo for a customer support agent using governed tools.
- Agent marketplace and tool marketplace with permission grants.
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

The API initializes tables and seed demo data on startup when `AUTO_INIT_DB=true`.

## Demo CLI

After installing the Python package locally:

```bash
pip install -e .
governance-agent "Show recent transactions for customer C123"
governance-agent "Dump all customer data"
governance-agent "Find all customers in Melbourne and show their emails"
```

Use `DATABASE_URL` to point the CLI at Postgres.

## API Examples

List marketplace agents, list marketplace tools, and grant a tool permission:

```bash
curl http://localhost:8000/v1/agent-marketplace

curl http://localhost:8000/v1/tool-marketplace

curl http://localhost:8000/v1/agents

curl -X POST http://localhost:8000/v1/agents/customer-support-agent/tool-grants \
  -H "Content-Type: application/json" \
  -d '{"tool_name":"search_customers"}'
```

Evaluate-only mode:

```bash
curl -X POST http://localhost:8000/v1/evaluate-tool-call \
  -H "Content-Type: application/json" \
  -d '{"agent_id":"customer-support-agent","session_id":"sess_demo","user_query":"Show recent transactions for customer C123","tool_name":"get_customer_transactions","tool_args":{"customer_id":"C123"}}'
```

Gateway mode:

```bash
curl -X POST http://localhost:8000/v1/governed-tool-call \
  -H "Content-Type: application/json" \
  -d '{"agent_id":"customer-support-agent","session_id":"sess_demo","user_query":"Show recent transactions for customer C123","tool_name":"get_customer_transactions","tool_args":{"customer_id":"C123"}}'
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
  -d '{"query":"Investigate recent transactions for customer C123 and prepare a safe support summary"}'

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
