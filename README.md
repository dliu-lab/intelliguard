# IntelliGuard SDK and API for Enterprise AI Agents

A Python SDK, FastAPI service, and React dashboard for governing AI agents at runtime.
The platform intercepts tool calls from agents, CLIs, and microservices, detects risks
such as prompt injection, data overexposure, and tool misuse, enforces deterministic
policy decisions, and visualizes each agent run as an auditable workflow trace.

## What It Builds

- Python governance SDK for agent frameworks and custom agents.
- FastAPI governance API for microservices and non-Python systems.
- Postgres audit store, review queue, customer demo data, and workflow events.
- React dashboard with an n8n-style workflow trace using React Flow.
- CLI demo for a customer support agent using governed tools.
- Agent marketplace and tool marketplace with permission grants.
- Multi-agent workflow grouping with lead and sub-agent traces.

## Run With Docker

```bash
docker compose up --build
```

Services:

- API: `http://localhost:8000`
- API docs: `http://localhost:8000/docs`
- Dashboard: `http://localhost:5173`
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
