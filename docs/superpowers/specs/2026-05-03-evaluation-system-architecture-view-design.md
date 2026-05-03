# Evaluation System Architecture View Design

## Purpose

Add an architectural view to Evaluation Center that explains how IntelliGuard
evaluation works across the control plane and runtime plane.

The view should make three things clear:

1. Evaluation is a lifecycle, not a single tool-registry feature.
2. Different evaluator scopes exist for tools, agents, workflows, runtime traces,
   responses, and judge calibration.
3. Every evaluation produces evidence that flows into readiness state, audit
   events, review, human corrections, and calibration.

## Recommended Presentation

Use a three-layer architecture view:

```text
1. Lifecycle Map
2. Evaluator Scope Matrix
3. Evidence Flow
```

This should live in Evaluation Center as a first-class architecture section above
or beside the current coverage and latest-run content.

## 1. Lifecycle Map

The top section should show the full governance loop:

```text
Tool Registry
  -> Tool Evaluation
  -> Tool Readiness

Agent Registry
  -> Agent Evaluation
  -> Agent Readiness

Workflow Designer
  -> Workflow Evaluation
  -> Workflow Readiness

Agentic Workflows
  -> Runtime Evaluation
  -> Review Queue
  -> Human Corrections
  -> Judge Calibration
  -> Evaluator Templates
```

The visual should separate:

```text
Control Plane:
  Tool Registry
  Agent Registry
  Workflow Designer
  Evaluation Center

Runtime Plane:
  Agentic Workflows
  Audit Events
  Review Queue
  Monitoring
```

Runtime findings and human corrections must visibly loop back into evaluator
templates and judge calibration.

## 2. Evaluator Scope Matrix

The second section should show what each evaluator scope covers.

```text
Scope       Build-time checks                    Runtime checks
Tool        schema, permission, side effects     tool use, scope, side effects
Agent       prompt, model, tools, KB, policy     behavior, policy compliance
Workflow    graph, nodes, edges, gates           trajectory, handoffs, reviews
Response    reference and rubric checks          safety, grounding, leakage
Judge       prompt, rubric, calibration set      drift, human agreement
```

Each row should include method badges:

```text
Deterministic
Reference-based
LLM-as-judge
Human review
```

This matrix is the clearest way to explain why IntelliGuard needs more than one
evaluator type.

## 3. Evidence Flow

The third section should show where evaluation evidence lands:

```text
Evaluator Run
  -> Criterion Results
  -> Readiness State
  -> Audit Events
  -> Review Queue
  -> Human Corrections
  -> Calibration Dataset
```

The view should connect these objects to existing screens:

```text
Evaluator Run          Evaluation Center
Criterion Results      Evaluation Center detail
Readiness State        Tool / Agent / Workflow registry cards
Audit Events           Audit Events
Review Queue           Review Queue
Human Corrections      Review Queue / future calibration view
Calibration Dataset    future Judge Calibration view
```

## UI Placement

Evaluation Center should have the following order:

```text
Architecture Overview
Coverage Metrics
Evaluator Templates
Latest Evaluation Runs
```

The architecture section should be collapsible once the product matures, but it
should be expanded by default during this redesign because the model is still new.

## Visual Rules

- Use two color bands: Control Plane and Runtime Plane.
- Use consistent method badges instead of long explanatory paragraphs.
- Keep the lifecycle map readable at a glance.
- Avoid a single linear pipeline that ends at production; the runtime feedback
  loop is the important product concept.
- Do not call DRAFT or FAILED objects certified. The UI should use readiness or
  evaluation language consistently.

## Implementation Notes

Start with static architecture content backed by the existing evaluator docs and
current platform data. Do not invent seed data.

The first implementation can derive counts from existing platform data:

```text
tools
agents
workflowDefinitions
evaluatorTemplates
evaluationRuns
reviewQueue
auditEvents
```

Later iterations can add drill-down links from lifecycle nodes to filtered
Evaluation Center runs, Audit Events, Review Queue items, and calibration records.
