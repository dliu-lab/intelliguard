---
name: marketplace
description: "Skill for the Marketplace area of intelliguard. 17 symbols across 1 files."
---

# Marketplace

17 symbols | 1 files | Cohesion: 90%

## When to Use

- Working with code in `archive/`
- Understanding how refreshAssignmentSummary, handleAssignGuardrail, handleDeleteGuardrail work
- Modifying marketplace-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `archive/5174-vite-dashboard/src/components/marketplace/AgentMarketplace.jsx` | refreshAssignmentSummary, handleAssignGuardrail, handleDeleteGuardrail, handleAssignEvaluator, handleDeleteEvaluator (+12) |

## Entry Points

Start here when exploring this area:

- **`refreshAssignmentSummary`** (Function) — `archive/5174-vite-dashboard/src/components/marketplace/AgentMarketplace.jsx:135`
- **`handleAssignGuardrail`** (Function) — `archive/5174-vite-dashboard/src/components/marketplace/AgentMarketplace.jsx:143`
- **`handleDeleteGuardrail`** (Function) — `archive/5174-vite-dashboard/src/components/marketplace/AgentMarketplace.jsx:148`
- **`handleAssignEvaluator`** (Function) — `archive/5174-vite-dashboard/src/components/marketplace/AgentMarketplace.jsx:153`
- **`handleDeleteEvaluator`** (Function) — `archive/5174-vite-dashboard/src/components/marketplace/AgentMarketplace.jsx:158`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `refreshAssignmentSummary` | Function | `archive/5174-vite-dashboard/src/components/marketplace/AgentMarketplace.jsx` | 135 |
| `handleAssignGuardrail` | Function | `archive/5174-vite-dashboard/src/components/marketplace/AgentMarketplace.jsx` | 143 |
| `handleDeleteGuardrail` | Function | `archive/5174-vite-dashboard/src/components/marketplace/AgentMarketplace.jsx` | 148 |
| `handleAssignEvaluator` | Function | `archive/5174-vite-dashboard/src/components/marketplace/AgentMarketplace.jsx` | 153 |
| `handleDeleteEvaluator` | Function | `archive/5174-vite-dashboard/src/components/marketplace/AgentMarketplace.jsx` | 158 |
| `handleAssignKB` | Function | `archive/5174-vite-dashboard/src/components/marketplace/AgentMarketplace.jsx` | 163 |
| `handleDeleteKBAssignment` | Function | `archive/5174-vite-dashboard/src/components/marketplace/AgentMarketplace.jsx` | 168 |
| `AgentMarketplace` | Function | `archive/5174-vite-dashboard/src/components/marketplace/AgentMarketplace.jsx` | 53 |
| `currentFormEnvironment` | Function | `archive/5174-vite-dashboard/src/components/marketplace/AgentMarketplace.jsx` | 179 |
| `handleEnvironmentChange` | Function | `archive/5174-vite-dashboard/src/components/marketplace/AgentMarketplace.jsx` | 187 |
| `profileFormFor` | Function | `archive/5174-vite-dashboard/src/components/marketplace/AgentMarketplace.jsx` | 23 |
| `SelectedAgentPanel` | Function | `archive/5174-vite-dashboard/src/components/marketplace/AgentMarketplace.jsx` | 447 |
| `runAction` | Function | `archive/5174-vite-dashboard/src/components/marketplace/AgentMarketplace.jsx` | 543 |
| `refreshAssignments` | Function | `archive/5174-vite-dashboard/src/components/marketplace/AgentMarketplace.jsx` | 555 |
| `updateProfileField` | Function | `archive/5174-vite-dashboard/src/components/marketplace/AgentMarketplace.jsx` | 566 |
| `saveProfile` | Function | `archive/5174-vite-dashboard/src/components/marketplace/AgentMarketplace.jsx` | 571 |
| `fetchAgentAssignmentSummary` | Function | `archive/5174-vite-dashboard/src/components/marketplace/AgentMarketplace.jsx` | 39 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `HandleAssignGuardrail → FetchAgentAssignmentSummary` | cross_community | 3 |
| `HandleDeleteGuardrail → FetchAgentAssignmentSummary` | cross_community | 3 |
| `HandleAssignEvaluator → FetchAgentAssignmentSummary` | cross_community | 3 |
| `HandleDeleteEvaluator → FetchAgentAssignmentSummary` | cross_community | 3 |
| `HandleAssignKB → FetchAgentAssignmentSummary` | cross_community | 3 |
| `HandleDeleteKBAssignment → FetchAgentAssignmentSummary` | cross_community | 3 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Cluster_80 | 1 calls |

## How to Explore

1. `gitnexus_context({name: "refreshAssignmentSummary"})` — see callers and callees
2. `gitnexus_query({query: "marketplace"})` — find related execution flows
3. Read key files listed above for implementation details
