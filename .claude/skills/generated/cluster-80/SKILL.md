---
name: cluster-80
description: "Skill for the Cluster_80 area of intelliguard. 6 symbols across 2 files."
---

# Cluster_80

6 symbols | 2 files | Cohesion: 59%

## When to Use

- Working with code in `archive/`
- Understanding how grantTool, updateAgentProfile, revokeTool work
- Modifying cluster_80-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `archive/5174-vite-dashboard/src/App.jsx` | grantTool, updateAgentProfile, revokeTool, createGuardrailPolicyFromJson, createKnowledgeBaseFromJson |
| `archive/5174-vite-dashboard/src/lib/permissions.js` | userCan |

## Entry Points

Start here when exploring this area:

- **`grantTool`** (Function) — `archive/5174-vite-dashboard/src/App.jsx:608`
- **`updateAgentProfile`** (Function) — `archive/5174-vite-dashboard/src/App.jsx:646`
- **`revokeTool`** (Function) — `archive/5174-vite-dashboard/src/App.jsx:772`
- **`createGuardrailPolicyFromJson`** (Function) — `archive/5174-vite-dashboard/src/App.jsx:822`
- **`createKnowledgeBaseFromJson`** (Function) — `archive/5174-vite-dashboard/src/App.jsx:841`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `grantTool` | Function | `archive/5174-vite-dashboard/src/App.jsx` | 608 |
| `updateAgentProfile` | Function | `archive/5174-vite-dashboard/src/App.jsx` | 646 |
| `revokeTool` | Function | `archive/5174-vite-dashboard/src/App.jsx` | 772 |
| `createGuardrailPolicyFromJson` | Function | `archive/5174-vite-dashboard/src/App.jsx` | 822 |
| `createKnowledgeBaseFromJson` | Function | `archive/5174-vite-dashboard/src/App.jsx` | 841 |
| `userCan` | Function | `archive/5174-vite-dashboard/src/lib/permissions.js` | 0 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `UpdateAgentProfile → Me` | cross_community | 3 |
| `UpdateAgentProfile → UpdateSelectedEnvironment` | cross_community | 3 |
| `UpdateAgentProfile → Sessions` | cross_community | 3 |
| `UpdateAgentProfile → Workflows` | cross_community | 3 |
| `CreateGuardrailPolicyFromJson → Me` | cross_community | 3 |
| `CreateGuardrailPolicyFromJson → UpdateSelectedEnvironment` | cross_community | 3 |
| `CreateGuardrailPolicyFromJson → Sessions` | cross_community | 3 |
| `CreateGuardrailPolicyFromJson → Workflows` | cross_community | 3 |
| `CreateKnowledgeBaseFromJson → Me` | cross_community | 3 |
| `CreateKnowledgeBaseFromJson → UpdateSelectedEnvironment` | cross_community | 3 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Api | 5 calls |

## How to Explore

1. `gitnexus_context({name: "grantTool"})` — see callers and callees
2. `gitnexus_query({query: "cluster_80"})` — find related execution flows
3. Read key files listed above for implementation details
