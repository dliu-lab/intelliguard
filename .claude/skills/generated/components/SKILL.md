---
name: components
description: "Skill for the _components area of intelliguard. 327 symbols across 17 files."
---

# _components

327 symbols | 17 files | Cohesion: 70%

## When to Use

- Working with code in `dashboard/`
- Understanding how request, authHeaders, withParams work
- Modifying _components-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `dashboard/lib/api.ts` | request, authHeaders, withParams, me, listAgents (+56) |
| `dashboard/app/platform/_components/WorkflowBuilderWorkspace.tsx` | canvasWorldWidth, clamp, cubicPoint, defaultNodePositions, safeOption (+46) |
| `dashboard/app/platform/_components/KnowledgeBasesWorkspace.tsx` | emptyKbForm, scopeLabel, chunkingStrategyLabel, usesFixedSizeControls, displayVersion (+41) |
| `dashboard/app/platform/_components/RecordListWorkspace.tsx` | numberValue, objectValue, stringArrayValue, riskTypes, decisionTone (+40) |
| `dashboard/app/platform/_components/SelectedAgentModal.tsx` | loadAssignments, loadCertification, refreshAssignments, refreshCertification, runAction (+26) |
| `dashboard/app/platform/_components/utils.ts` | joinParts, formatTimestamp, formatCount, readText, agentProfileForm (+20) |
| `dashboard/app/platform/_components/ToolRegistryWorkspace.tsx` | certificationStatus, toolStatusLabel, statusClasses, shortHash, isRecord (+13) |
| `dashboard/app/platform/_components/OverviewWorkspace.tsx` | restrictedTools, resolvedReviews, averageRisk, certificationStatus, certifiedCount (+5) |
| `dashboard/app/platform/_components/EvaluationCenterWorkspace.tsx` | CoverageRow, certificationStatus, countByStatus, coverage, certifiedCount (+4) |
| `dashboard/app/platform/_components/MonitoringWorkspace.tsx` | DecisionBar, decisionCounts, riskCounts, averageRisk, certificationStatus (+2) |

## Entry Points

Start here when exploring this area:

- **`request`** (Function) — `dashboard/lib/api.ts:150`
- **`authHeaders`** (Function) — `dashboard/lib/api.ts:178`
- **`withParams`** (Function) — `dashboard/lib/api.ts:184`
- **`me`** (Function) — `dashboard/lib/api.ts:220`
- **`listAgents`** (Function) — `dashboard/lib/api.ts:226`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `request` | Function | `dashboard/lib/api.ts` | 150 |
| `authHeaders` | Function | `dashboard/lib/api.ts` | 178 |
| `withParams` | Function | `dashboard/lib/api.ts` | 184 |
| `me` | Function | `dashboard/lib/api.ts` | 220 |
| `listAgents` | Function | `dashboard/lib/api.ts` | 226 |
| `listWorkflows` | Function | `dashboard/lib/api.ts` | 232 |
| `getWorkflowDetail` | Function | `dashboard/lib/api.ts` | 238 |
| `listWorkflowDefinitions` | Function | `dashboard/lib/api.ts` | 244 |
| `listSessions` | Function | `dashboard/lib/api.ts` | 250 |
| `listReviewQueue` | Function | `dashboard/lib/api.ts` | 256 |
| `resolveReview` | Function | `dashboard/lib/api.ts` | 262 |
| `listAuditEvents` | Function | `dashboard/lib/api.ts` | 274 |
| `listGuardrailPolicies` | Function | `dashboard/lib/api.ts` | 280 |
| `listEvaluatorTemplates` | Function | `dashboard/lib/api.ts` | 286 |
| `listKnowledgeBases` | Function | `dashboard/lib/api.ts` | 292 |
| `getKnowledgeBaseDetail` | Function | `dashboard/lib/api.ts` | 298 |
| `listKnowledgeSources` | Function | `dashboard/lib/api.ts` | 304 |
| `listKnowledgeDocuments` | Function | `dashboard/lib/api.ts` | 310 |
| `listKnowledgeBaseVersions` | Function | `dashboard/lib/api.ts` | 316 |
| `createKnowledgeBaseVersion` | Function | `dashboard/lib/api.ts` | 322 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `WorkflowCanvas → IsRecord` | cross_community | 6 |
| `WorkflowCanvas → CanvasNodeIds` | cross_community | 6 |
| `OpenEditForm → IsRecord` | cross_community | 6 |
| `OpenDuplicateForm → IsRecord` | cross_community | 6 |
| `KnowledgeBasesWorkspace → IsRecord` | cross_community | 5 |
| `SelectedAgentModal → NormalizeScope` | cross_community | 5 |
| `SelectedAgentModal → ReadText` | cross_community | 5 |
| `SelectedAgentModal → AgentDomain` | cross_community | 5 |
| `SelectedAgentModal → ReadNestedText` | cross_community | 5 |
| `WorkflowTraceWorkspace → ReadText` | cross_community | 5 |

## How to Explore

1. `gitnexus_context({name: "request"})` — see callers and callees
2. `gitnexus_query({query: "_components"})` — find related execution flows
3. Read key files listed above for implementation details
