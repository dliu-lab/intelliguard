---
name: cluster-79
description: "Skill for the Cluster_79 area of intelliguard. 5 symbols across 1 files."
---

# Cluster_79

5 symbols | 1 files | Cohesion: 73%

## When to Use

- Working with code in `archive/`
- Understanding how updateWorkflowDefinitionField, addWorkflowBuilderStep, removeWorkflowBuilderStep work
- Modifying cluster_79-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `archive/5174-vite-dashboard/src/App.jsx` | parseWorkflowDefinition, updateWorkflowDefinitionJson, updateWorkflowDefinitionField, addWorkflowBuilderStep, removeWorkflowBuilderStep |

## Entry Points

Start here when exploring this area:

- **`updateWorkflowDefinitionField`** (Function) — `archive/5174-vite-dashboard/src/App.jsx:693`
- **`addWorkflowBuilderStep`** (Function) — `archive/5174-vite-dashboard/src/App.jsx:726`
- **`removeWorkflowBuilderStep`** (Function) — `archive/5174-vite-dashboard/src/App.jsx:747`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `updateWorkflowDefinitionField` | Function | `archive/5174-vite-dashboard/src/App.jsx` | 693 |
| `addWorkflowBuilderStep` | Function | `archive/5174-vite-dashboard/src/App.jsx` | 726 |
| `removeWorkflowBuilderStep` | Function | `archive/5174-vite-dashboard/src/App.jsx` | 747 |
| `parseWorkflowDefinition` | Function | `archive/5174-vite-dashboard/src/App.jsx` | 246 |
| `updateWorkflowDefinitionJson` | Function | `archive/5174-vite-dashboard/src/App.jsx` | 260 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `AddWorkflowBuilderStep → ParseWorkflowDefinition` | intra_community | 3 |
| `RemoveWorkflowBuilderStep → ParseWorkflowDefinition` | intra_community | 3 |

## How to Explore

1. `gitnexus_context({name: "updateWorkflowDefinitionField"})` — see callers and callees
2. `gitnexus_query({query: "cluster_79"})` — find related execution flows
3. Read key files listed above for implementation details
