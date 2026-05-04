---
name: components
description: "Skill for the _components area of intelliguard. 246 symbols across 13 files."
---

# _components

246 symbols | 13 files | Cohesion: 70%

## When to Use

- Working with code in `dashboard/`
- Understanding how request, authHeaders, withParams work
- Modifying _components-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `dashboard/lib/api.ts` | request, authHeaders, withParams, me, listAgents (+47) |
| `dashboard/app/platform/_components/RecordListWorkspace.tsx` | workflowDomain, asRecords, numberValue, objectValue, decisionTone (+46) |
| `dashboard/app/platform/_components/WorkflowBuilderWorkspace.tsx` | canvasWorldWidth, clamp, defaultNodePositions, safeOption, addStep (+43) |
| `dashboard/app/platform/_components/utils.ts` | joinParts, padTimePart, formatIsoTimestamp, formatTimestamp, readNestedText (+20) |
| `dashboard/app/platform/_components/SelectedAgentModal.tsx` | loadAssignments, loadCertification, refreshAssignments, refreshCertification, runAction (+13) |
| `dashboard/app/platform/_components/ToolRegistryWorkspace.tsx` | submitTool, runEvaluation, saveTool, certificationStatus, toolUpdatedAt (+13) |
| `dashboard/app/platform/_components/EvaluationCenterWorkspace.tsx` | CoverageRow, certificationStatus, countByStatus, coverage, certifiedCount (+4) |
| `dashboard/app/platform/_components/MonitoringWorkspace.tsx` | DecisionBar, decisionCounts, riskCounts, averageRisk, certificationStatus (+2) |
| `dashboard/app/platform/_components/ControlPlaneWorkspace.tsx` | agentDomainFilterValue, agentDomainLabel, agentUpdatedAt, ControlPlaneWorkspace, selectTab (+2) |
| `dashboard/app/platform/page.tsx` | loadWorkspace, logout, refreshWorkspace, PlatformPage, openBackendComponent |

## Entry Points

Start here when exploring this area:

- **`request`** (Function) — `dashboard/lib/api.ts:93`
- **`authHeaders`** (Function) — `dashboard/lib/api.ts:120`
- **`withParams`** (Function) — `dashboard/lib/api.ts:126`
- **`me`** (Function) — `dashboard/lib/api.ts:162`
- **`listAgents`** (Function) — `dashboard/lib/api.ts:168`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `request` | Function | `dashboard/lib/api.ts` | 93 |
| `authHeaders` | Function | `dashboard/lib/api.ts` | 120 |
| `withParams` | Function | `dashboard/lib/api.ts` | 126 |
| `me` | Function | `dashboard/lib/api.ts` | 162 |
| `listAgents` | Function | `dashboard/lib/api.ts` | 168 |
| `listWorkflows` | Function | `dashboard/lib/api.ts` | 174 |
| `getWorkflowDetail` | Function | `dashboard/lib/api.ts` | 180 |
| `listWorkflowDefinitions` | Function | `dashboard/lib/api.ts` | 186 |
| `listSessions` | Function | `dashboard/lib/api.ts` | 192 |
| `listReviewQueue` | Function | `dashboard/lib/api.ts` | 198 |
| `resolveReview` | Function | `dashboard/lib/api.ts` | 204 |
| `listAuditEvents` | Function | `dashboard/lib/api.ts` | 216 |
| `listGuardrailPolicies` | Function | `dashboard/lib/api.ts` | 222 |
| `listEvaluatorTemplates` | Function | `dashboard/lib/api.ts` | 228 |
| `listKnowledgeBases` | Function | `dashboard/lib/api.ts` | 234 |
| `listTools` | Function | `dashboard/lib/api.ts` | 240 |
| `listEnvironments` | Function | `dashboard/lib/api.ts` | 246 |
| `getMonitoringMetrics` | Function | `dashboard/lib/api.ts` | 252 |
| `createAgent` | Function | `dashboard/lib/api.ts` | 258 |
| `deleteAgent` | Function | `dashboard/lib/api.ts` | 266 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `WorkflowCanvas → IsRecord` | cross_community | 6 |
| `WorkflowCanvas → CanvasNodeIds` | cross_community | 6 |
| `WorkflowTraceWorkspace → ReadText` | cross_community | 5 |
| `WorkflowCanvas → CanvasWorldWidth` | cross_community | 5 |
| `WorkflowCanvas → Clamp` | cross_community | 5 |
| `StartDrag → IsRecord` | cross_community | 5 |
| `StartDrag → CanvasNodeIds` | cross_community | 5 |
| `WorkflowTraceWorkspace → AsRecords` | cross_community | 4 |
| `EvaluationCenterWorkspace → ReadText` | cross_community | 4 |
| `EvaluationCenterWorkspace → PadTimePart` | cross_community | 4 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Agent_governance | 9 calls |

## How to Explore

1. `gitnexus_context({name: "request"})` — see callers and callees
2. `gitnexus_query({query: "_components"})` — find related execution flows
3. Read key files listed above for implementation details
