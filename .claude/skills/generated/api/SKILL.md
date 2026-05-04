---
name: api
description: "Skill for the Api area of intelliguard. 31 symbols across 2 files."
---

# Api

31 symbols | 2 files | Cohesion: 76%

## When to Use

- Working with code in `archive/`
- Understanding how workflow, App, syncViewFromHash work
- Modifying api-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `archive/5174-vite-dashboard/src/App.jsx` | agentTemplateFor, workflowTemplateFor, guardrailPolicyTemplateFor, viewFromHash, decisionClass (+18) |
| `api/main.py` | workflow, tools, policies, agents, environments (+3) |

## Entry Points

Start here when exploring this area:

- **`workflow`** (Function) — `api/main.py:1169`
- **`App`** (Function) — `archive/5174-vite-dashboard/src/App.jsx:285`
- **`syncViewFromHash`** (Function) — `archive/5174-vite-dashboard/src/App.jsx:335`
- **`runWorkflowDemo`** (Function) — `archive/5174-vite-dashboard/src/App.jsx:548`
- **`selectWorkflow`** (Function) — `archive/5174-vite-dashboard/src/App.jsx:572`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `workflow` | Function | `api/main.py` | 1169 |
| `App` | Function | `archive/5174-vite-dashboard/src/App.jsx` | 285 |
| `syncViewFromHash` | Function | `archive/5174-vite-dashboard/src/App.jsx` | 335 |
| `runWorkflowDemo` | Function | `archive/5174-vite-dashboard/src/App.jsx` | 548 |
| `selectWorkflow` | Function | `archive/5174-vite-dashboard/src/App.jsx` | 572 |
| `selectWorkflowSession` | Function | `archive/5174-vite-dashboard/src/App.jsx` | 585 |
| `viewWorkflowTrace` | Function | `archive/5174-vite-dashboard/src/App.jsx` | 592 |
| `updateWorkflowBuilderStep` | Function | `archive/5174-vite-dashboard/src/App.jsx` | 699 |
| `updateWorkflowBuilderStepToolArgs` | Function | `archive/5174-vite-dashboard/src/App.jsx` | 713 |
| `loadJsonFile` | Function | `archive/5174-vite-dashboard/src/App.jsx` | 760 |
| `switchView` | Function | `archive/5174-vite-dashboard/src/App.jsx` | 860 |
| `tools` | Function | `api/main.py` | 457 |
| `policies` | Function | `api/main.py` | 465 |
| `agents` | Function | `api/main.py` | 474 |
| `environments` | Function | `api/main.py` | 481 |
| `me` | Function | `api/main.py` | 488 |
| `workflows` | Function | `api/main.py` | 1096 |
| `sessions` | Function | `api/main.py` | 1162 |
| `updateSelectedEnvironment` | Function | `archive/5174-vite-dashboard/src/App.jsx` | 352 |
| `refresh` | Function | `archive/5174-vite-dashboard/src/App.jsx` | 413 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `App → ViewFromHash` | intra_community | 3 |
| `RunWorkflowDemo → Request` | cross_community | 3 |
| `RunWorkflowDemo → AuthHeaders` | cross_community | 3 |
| `RunWorkflowDemo → Me` | cross_community | 3 |
| `RunWorkflowDemo → UpdateSelectedEnvironment` | cross_community | 3 |
| `RunWorkflowDemo → Sessions` | cross_community | 3 |
| `RunWorkflowDemo → Workflows` | cross_community | 3 |
| `UpdateAgentProfile → Me` | cross_community | 3 |
| `UpdateAgentProfile → UpdateSelectedEnvironment` | cross_community | 3 |
| `UpdateAgentProfile → Sessions` | cross_community | 3 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Cluster_79 | 3 calls |
| Cluster_80 | 1 calls |
| _components | 1 calls |
| Agent_governance | 1 calls |

## How to Explore

1. `gitnexus_context({name: "workflow"})` — see callers and callees
2. `gitnexus_query({query: "api"})` — find related execution flows
3. Read key files listed above for implementation details
