# IntelliGuard Evaluator Architecture And Implementation Plan

Sources:

- Anthropic: "Demystifying evals for AI agents"
  https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents
- LangChain: "How to Calibrate LLM-as-a-Judge"
  https://www.langchain.com/articles/llm-as-a-judge#running-llm-as-a-judge-in-production

## 1. Core Design Decision

Evaluators should not be treated as one generic feature. IntelliGuard should model
evaluation as a platform-level governance lifecycle across:

```text
Tool Registry
Agent Registry
Workflow Designer
Agentic Workflows
Review Queue
Judge Calibration
```

Only the tool-specific part belongs under Tool Registry:

```text
Tool Registry
  -> Tool Evaluators
  -> Tool Certification
```

The broader evaluator system should live under a cross-platform Evaluation Center
because agent evaluators, workflow evaluators, runtime evaluations,
human corrections, and judge calibration apply across multiple platform objects.

## 2. Target Governance Lifecycle

```text
1. Tool Registry
   -> register tool
   -> evaluate schema, permissions, scope, side effects, output, auditability
   -> certify tool

2. Agent Registry
   -> register agent with domain, agent_type/node_type, model, prompt, tools, KB, guardrails
   -> attach tools according to environment-specific certification enforcement
   -> attach agent evaluators
   -> certify agent

3. Workflow Designer
   -> load domain-specific certified agents
   -> show attached tools, KB, guardrails, evaluators
   -> validate graph edges, node types, handoffs, approval gates
   -> attach workflow evaluators
   -> certify workflow

4. Runtime Evaluation
   -> run sampled evaluations against real traces
   -> evaluate final output and full trajectory
   -> route failed/high-risk evals to review

5. Human Corrections
   -> reviewers correct evaluator decisions
   -> corrections become calibration data

6. Judge Calibration
   -> improve LLM judge prompts with few-shot examples
   -> track judge-human agreement over time
```

## 3. Evaluator Scopes

Introduce four evaluator scopes:

```text
tool_evaluator
agent_evaluator
workflow_evaluator
judge_alignment_evaluator
```

### Tool Evaluator

Runs before a tool can be certified for agent attachment in production-like
environments. Lower environments may attach draft tools according to environment
policy, but those attachments remain visibly uncertified.

Mostly deterministic checks:

```text
input schema validation
required argument validation
session/entity scope binding
permission model validation
side-effect classification
output schema validation
PII/sensitive-field leakage
audit event completeness
latency/error-rate thresholds
rate-limit behavior
```

Tool certification lifecycle:

```text
DRAFT
EVALUATING
CERTIFIED
FAILED
NEEDS_REEVALUATION
```

RESTRICTED is intentionally not part of the certification lifecycle.
Certification status should answer one question only: has this target passed the
required evaluation gate for its intended environment?

Known safe-but-limited usage belongs in guardrail policies, not certification
status. For example, a certified side-effecting tool can still be constrained by
agent, environment, amount limit, session binding, or human approval rules.

### Guardrail Policy Role

Guardrail Policies are the runtime enforcement layer. Certification answers
whether a tool, agent, or workflow has passed the required evaluation gate.
Guardrail policies answer what that certified object is allowed to do at runtime
under the current environment, session, user, and risk context.

Certification is not a replacement for guardrails. A tool can be CERTIFIED and
still require runtime constraints. For example, a certified
`update_contact_info` tool can still be limited to authenticated customer scope,
specific environments, and human approval before execution.

Guardrail policies should cover runtime controls such as:

```text
block or redact PII in final responses
require human review for high-risk actions
limit records returned by a tool
enforce customer_id / account_id session binding
block risky tool argument patterns
require review before side-effecting tools
set review and block thresholds
constrain certified tools to specific agents or environments
```

Guardrails remain attached to agents. Agent evaluation should fail or require
review when an agent has no applicable guardrail policy. Runtime execution paths
must call the guardrail enforcement layer on every governed action, even when
the tool, agent, and workflow are already certified.

If a genuine exception is needed, it must be modeled as a separate time-bound
certification exception with approver, reason, compensating controls, and expiry.
It must not become a permanent status alongside CERTIFIED.

In production-like environments, only CERTIFIED tools can be attached to agents.
In lower environments, environment policy can allow DRAFT or EVALUATING tools
for development and testing, but those agents cannot be promoted to production
until tool certification passes.

### Agent Evaluator

Runs after agent registration and whenever agent configuration changes:

```text
prompt
model
tools
KB
guardrails
evaluator config
domain
agent_type
```

Evaluator types:

```text
policy_compliance
tool_use_correctness
task_completion
response_quality
groundedness
risk_handling
trajectory_efficiency
```

Use deterministic checks for policy, tool, and audit behavior. Use LLM-as-judge
for subjective quality such as helpfulness, completeness, tone, and task success.

### Workflow Evaluator

Runs at graph/workflow level.

Checks:

```text
lead-agent routing decision
activated nodes vs registered graph
skipped nodes
handoff edge validity
approval gates
review routing
final outcome
total risk exposure
looping or failed trajectories
```

This is important because final-answer scoring can miss bad agent paths.

### Judge Alignment Evaluator

Tracks whether LLM judges agree with human experts.

Each LLM judge should be versioned:

```text
judge_id
scope
model
prompt_version
rubric
input_mapping
few_shot_examples
agreement_score
last_calibrated_at
status
```

Judge lifecycle:

```text
DRAFT
CALIBRATING
ACTIVE
NEEDS_RECALIBRATION
RETIRED
```

## 4. Evaluation Methods

Use a hybrid stack.

```text
Deterministic rules:
  Fast, cheap, reliable for exact checks.

Reference-based evaluation:
  Compare against source docs, KB records, expected outputs, policy text.

LLM-as-judge:
  Use for subjective quality and complex semantic judgment.

Human evaluation:
  Use for high-stakes cases, calibration, and disagreement resolution.
```

Scoring should avoid false precision. Prefer:

```text
PASS / FAIL
SAFE / REVIEW / BLOCK
1 / 2 / 3
```

Avoid relying on fine-grained 87/100 style scores unless calibrated with human
agreement data.

## 5. Build Time And Runtime Evaluation

### Build Time Evaluation

Runs during tool registration, agent configuration, and workflow design —
before anything goes to production. Powers the certification lifecycle.

```text
run curated eval dataset
run regression suite
compare against previous version
block certification on critical failures
```

### Runtime Evaluation

Runs against real traces, sampled by risk level and version freshness.
Powers the quality dashboard and failed-eval review routing.

```text
high_risk: 100%
review_queue_items: 100%
new_agent_version: 50%
new_tool_version: 50%
normal_low_risk: 5%
internal_test: 1%
```

Runtime evaluation attaches to live traces and audit events.

### Environment-Specific Certification Control

Certification enforcement is environment-aware.

```text
local / sandbox:
  draft tools and draft agents can be connected for development
  production-ready status cannot be granted

demo / staging:
  configurable policy; default requires certified tools for certified agents
  draft objects can be tested but remain visibly uncertified

production:
  hard enforcement
  tools must be CERTIFIED before attachment
  agents must be CERTIFIED before production use
  workflows must be CERTIFIED before production execution
```

This preserves fast iteration in lower environments while keeping production
governance strict.

## 6. UI Architecture

The platform has three top-level navigation areas. Platform Overview sits
outside the build-time and runtime planes. The evaluator system adds Evaluation
Center to the Control Plane only. Review Queue, Audit Events, and Monitoring
are separate Runtime Plane sections and are not duplicated there.

Platform Overview:

```text
Platform Overview        → cross-platform health, registry coverage, runtime decisions, risk signals
```

Control Plane (build time — register, configure, evaluate, certify):

```text
Tool Registry
Agent Registry
Workflow Designer        ← moved from Agentic Workflows
Knowledge Bases
Guardrail Policies
Evaluation Center        ← new
```

The certification chain flows left to right through the Control Plane:

```text
Tool Registry → certified tools
Agent Registry → certified agents using certified tools
Workflow Designer → certified workflows using certified agents
Evaluation Center → cross-cutting evaluation and certification visibility
```

Runtime Plane (execute, review, audit, monitor):

```text
Agentic Workflows        ← run certified workflows
Review Queue
Audit Events
Monitoring
```

The platform is environment-agnostic. All runtime sections — including Monitoring
— are scoped by the user's environment access via RBAC. A Governance Lead sees
metrics across all environments. A Governance Reviewer sees their assigned
environment only. The monitoring surface shows the same data model regardless of
which environment is selected.

### Monitoring Architecture

Metric computation must be separated from metric presentation. Metrics are
computed in a dedicated backend module and exposed via a clean API so both the
internal dashboard and future external tools consume the same data source.

Now (internal dashboard only):

```text
agent_governance/monitoring.py
  → aggregation queries over audit_events, review_queue, evaluation_results
  → GET /v1/monitoring/metrics  → JSON metrics consumed by the platform dashboard
```

Future (Grafana integration, no redesign required):

```text
GET /v1/monitoring/metrics  → JSON metrics for the platform dashboard and external SaaS/API consumers
GET /metrics                → Prometheus/OpenMetrics text format for scraping by Prometheus/Grafana
```

Use standard metric naming conventions from day one so Prometheus/Grafana can
consume them without transformation:

```text
intelliguard_decisions_total{decision, environment, agent_id}
intelliguard_risk_score_avg{environment, risk_type}
intelliguard_review_queue_pending{environment}
intelliguard_review_sla_breached_total{environment}
intelliguard_eval_pass_rate{scope, environment}
intelliguard_certification_coverage{target_type, environment}
```

The internal dashboard renders JSON metrics as charts and tables. Prometheus and
Grafana use `/metrics`. Both endpoints are backed by the same monitoring module
so metric computation is not duplicated.

### Monitoring Dashboard Content

```text
Decision Rate Trends      → allow / review / block counts over time
Risk Type Distribution    → which risk types fire most, trending direction
Agent Leaderboard         → by event count, avg risk score, block rate
Tool Leaderboard          → by usage, block rate, certification status
Evaluation Quality        → runtime eval pass rates by agent and workflow
Review Queue Health       → pending count, avg resolution time, SLA breach count
Certification Coverage    → % of tools / agents / workflows certified vs. failed
```

All metrics are derived from existing tables (audit_events, review_queue,
sessions) and Phase 4 additions (evaluation_results, certifications).

### Visibility Architecture

Use a hybrid model: inline evaluation panels on each registry object, plus the
Evaluation Center as a fleet-wide governance hub.

Rationale: a developer registering a tool or configuring an agent needs to see
evaluation evidence in context, without navigating away. A governance lead needs
a cross-cutting view to answer "which tools are uncertified?" or "which agents
have failing evaluators?" Both surfaces serve real workflows; neither replaces
the other.

Evaluator logic is made visible at three layers:

```text
Template layer      → show evaluation criteria as a readable checklist
                      not just a template name

Result layer        → show per-criterion PASS/FAIL with an evidence sentence
                      not just a rollup score

Certification layer → show status badge plus a summary of which criteria failed
                      not just CERTIFIED or FAILED
```

#### Inline Evaluation Panel

Appears on every tool, agent, and workflow detail page as a dedicated tab.

Tool Registry — Evaluators tab:

```text
Assigned evaluator templates (criteria checklist per template)
Last evaluation run date and triggered by
Per-criterion result: PASS / FAIL / REVIEW + evidence sentence
Overall certification status badge
Link to full evaluation run in Evaluation Center
Run evaluation button
```

Tool Registry — Certification tab:

```text
Certification status: DRAFT | EVALUATING | CERTIFIED | FAILED | NEEDS_REEVALUATION
Config hash of evaluated registration fields
Artifact digest of evaluated implementation, when available
Last evaluation run link
Certified by and certified at
Expiry if applicable
Failure reason if FAILED
History of certification status changes
```

Agent Registry — Evaluators tab:

```text
Assigned evaluator templates with scope and method (deterministic / LLM-as-judge)
Last evaluation run
Per-evaluator result summary: PASS / FAIL / REVIEW
Criteria checklist per evaluator
Link to full run in Evaluation Center
Run evaluation button
```

Agent Registry — Certification tab:

```text
Certification status: DRAFT | EVALUATING | CERTIFIED | FAILED | NEEDS_REEVALUATION
Which configuration change triggered NEEDS_REEVALUATION (prompt / model / tools / KB / guardrails)
Last run link, certified by, certified at
Failed criteria summary
```

#### Evaluation Run Detail Page

Every evaluation run — whether triggered from an inline panel or the Evaluation
Center — links to a dedicated Evaluation Run detail page. This is the full trace.

The trace has two levels: the run level (which evaluators ran and what happened
overall) and the criterion level (what each individual check found).

```text
Header
  Run ID
  Target: name, type (tool / agent / workflow), config hash, artifact digest if present
  Triggered by and triggered at
  Duration
  Overall result: PASSED | FAILED  (N of M criteria failed)
  Certification outcome: CERTIFIED | FAILED | NEEDS_REEVALUATION

Evaluators (one card per evaluator template in the run)
  Template name
  Scope: tool | agent | workflow
  Method badge: deterministic | LLM-as-judge

  Per-criterion rows
    ✅ / ❌ / ⚠   criterion name      PASS / FAIL / REVIEW
                  evidence sentence
                  [expandable] full input snapshot that was evaluated

  LLM-as-judge section (collapsible, shown only when method is LLM-as-judge)
    Judge model
    Prompt version
    Agreement score (% judge-human agreement from calibration)
    [expand] Full prompt sent to judge
    [expand] Full judge response
    Extracted verdict and reasoning

Raw JSON (collapsible)
  Full evaluation_result and evaluation_criterion_result records for developers and auditors
```

Entry points to the Evaluation Run detail page:

```text
Inline panel (Tool / Agent / Workflow page)
  → "View full evaluation" link on each run summary row

Evaluation Center tabs (Tool / Agent / Workflow Evaluations)
  → click any row in the run list
```

#### Evaluation Center Hub

Fleet-wide control plane for governance leads. Not used for per-object decisions.

```text
Evaluator Templates    → browse and manage evaluation rubrics
Tool Evaluations       → all build time evaluation runs across all tools, filterable by status
Agent Evaluations      → all build time evaluation runs across all agents
Workflow Evaluations   → all build time evaluation runs across all workflows
Runtime Evaluations    → runtime trace evaluations with sampling policy view
Human Corrections      → corrections queue, correction history
Judge Calibration      → judge versions, agreement scores, calibration history
Eval Datasets          → curated test cases and regression suites
```

### Tool Registry Tabs

```text
Definition
Schema
Access Model
Side Effects
Data Scope
Evaluators
Certification
Usage
```

### Agent Registry Tabs

```text
Identity
Domain
Model / Prompt
Tools
Knowledge Bases
Guardrails
Evaluators
Certification
Runtime Usage
```

### Evaluation Center Tabs

```text
Evaluator Templates
Tool Evaluations
Agent Evaluations
Workflow Evaluations
Runtime Evaluations
Human Corrections
Judge Calibration
Eval Datasets
```

### Workflow Designer

Each node should show:

```text
agent certification status
agent_type / node_type match
attached tools
tool certification status
attached KB
guardrails
agent evaluators
workflow evaluator coverage
```

## 7. Data Model Additions

Recommended backend entities:

```text
evaluator_templates
evaluation_datasets
evaluation_cases
evaluation_runs
evaluation_results
evaluation_criterion_results
tool_certifications
agent_certifications
workflow_certifications
human_corrections
judge_versions
judge_alignment_metrics
```

Minimum fields for evaluation_results:

```text
result_id
run_id
scope
target_type        # tool | agent | workflow | judge
target_id
evaluator_id
evaluator_version
score
status            # PASS | FAIL | REVIEW
reason
trace_id
audit_event_ids
created_at
metadata
```

Minimum fields for evaluation_criterion_results:

```text
criterion_result_id
result_id
criterion_id
criterion_name
status            # PASS | FAIL | REVIEW
score
evidence_sentence
input_snapshot
observed_value
expected_value
created_at
metadata
```

Minimum fields for certification:

```text
certification_id
target_type
target_id
status
config_hash          # SHA-256 of registered config fields — computed by IntelliGuard
artifact_digest      # digest of deployed artifact — supplied by deploying system (optional now, required with containers)
last_evaluation_run_id
certified_by
certified_at
expires_at
failure_reason
```

Minimum fields for certification_exceptions:

```text
exception_id
target_type
target_id
environment
approved_by
reason
compensating_controls
expires_at
created_at
revoked_at
metadata
```

Review Queue items should distinguish why a human is being asked to review:

```text
review_type:
  approval_gate
  evaluation_failure
  judge_disagreement
  certification_exception
```

## 8. Backend Module Structure

The evaluator system lives as a focused sub-package inside the existing
`agent_governance/` codebase. This keeps enforcement tightly coupled to the
data models that need it while isolating evaluation concerns from the API
routing layer.

```text
agent_governance/
  evaluation/
    __init__.py
    engine.py              # orchestrates runs: selects evaluators, aggregates results
    tool_evaluators.py     # deterministic tool checks (schema, permissions, side effects, PII)
    agent_evaluators.py    # deterministic + LLM-as-judge agent checks
    workflow_evaluators.py # graph structure and trajectory checks
    judge.py               # LLM-as-judge runner — always async, never blocks API response
    certification.py       # state machine: status transitions, invalidation triggers
    datasets.py            # eval dataset and eval case management
    runtime.py             # trace sampling, runtime eval runner
    corrections.py         # human corrections intake and storage
    calibration.py         # judge calibration, agreement metric tracking
    enforcement.py         # synchronous certification checks used by API and runtime paths
  monitoring.py            # metric aggregation for dashboard and Prometheus/Grafana export
```

The existing `agent_governance/evaluators.py` is replaced by this package.
Deterministic evaluator logic moves into `tool_evaluators.py` and
`agent_evaluators.py`. The `EvaluatorEngine` class moves into `engine.py`.

LLM-as-judge calls in `judge.py` must never block a synchronous API response.
For MVP they can run through FastAPI `BackgroundTasks`. For production they must
run through a durable worker/queue so evaluator work survives process restarts
and can be retried.

## 9. Enforcement Rules

This is a clean redesign. All existing marketplace tools and agent records are
replaced. Hard enforcement applies from day one with no legacy grace period.
The old `/v1/tool-marketplace` API belongs to the previous design and is
removed. Tool Registry APIs use `/v1/tools` with stable tool IDs.

The API is the canonical integration surface because external tools and SaaS
products may need to query registration, certification, and evaluation status.
API handlers call a synchronous enforcement service. The same enforcement
service must also be used by workflow runners, workers, and any future execution
path so certification cannot be bypassed outside the API layer. Enforcement does
not live inside the evaluation module; evaluation remains composable and
testable in isolation.

Hard rules:

```text
Tool attachment to agent
  → API handler calls enforcement service
  → Production-like environments require CERTIFIED
  → Lower environments may allow DRAFT / EVALUATING according to environment policy
  → Hard block otherwise — no warning-only mode in production
  → Active certification exceptions are checked separately from certification status
  → Exceptions must be scoped, time-bound, and audited

Agent production-ready transition
  → All required agent evaluators must have status PASS in the latest run
  → Any FAIL blocks the transition

Workflow production-ready transition
  → All graph nodes must reference CERTIFIED agents
  → Graph validation evaluator must PASS

Certification exception
  → Does not change certification status
  → Does not make a FAILED or NEEDS_REEVALUATION target CERTIFIED
  → Allows narrowly scoped use only while the exception is active
  → Must expire automatically

Certification invalidation triggers
  → Tool: any change to config_hash or artifact_digest (see below)
  → Agent: prompt, model, tools list, KB list, guardrails list, domain, agent_type
  → Workflow: graph nodes, edges, approval gates, policy bindings
  → Invalidation sets status to NEEDS_REEVALUATION, does not delete the previous result

Tool certification uses two distinct hashes with different sources:

config_hash
  Source: SHA-256 of the tool's registered fields in IntelliGuard
          (input_schema, output_schema, side_effect_level, permissions, allowed_actions)
  Owner:  IntelliGuard computes this from its own database on every tool update
  Catches: changes to the tool's declared contract — what it claims to accept,
           return, and what permissions it requires

artifact_digest
  Source: the immutable digest of the deployed artifact — IntelliGuard does not
          compute this, it is supplied by the deploying system
  Now:    git commit SHA of the tool source (optional, manual)
  Container deployment: Docker image digest (sha256:...)
  Kubernetes: image digest from the pod spec — required for certification
  Catches: runtime behavior changes that do not touch the registered schema

Both hashes are stored on the certification record. artifact_digest is optional
until container deployment is introduced, at which point it becomes required.
A change to either hash sets tool certification to NEEDS_REEVALUATION.
```

## 10. Implementation Plan

### Phase 1: Tool Evaluation And Certification

Modules: `tool_evaluators.py`, `certification.py`, `engine.py`, `enforcement.py`

Build:

```text
tool_certifications DB table
tool evaluator templates (schema, permissions, side effects, PII, audit completeness)
POST /v1/tools/{id}/evaluate — runs tool evaluators, writes evaluation_results
GET  /v1/tools/{id}/certification — returns current certification record
POST /v1/agents/{id}/tool-grants — calls enforcement.py before attachment
Environment-aware blocking for uncertified tool attachment in agent tool-grant API handler
NEEDS_REEVALUATION trigger on any tool field change
Tool Registry: Evaluators tab (criteria checklist, last run, per-criterion result)
Tool Registry: Certification tab (status, config_hash, artifact_digest, failure reason, history)
```

This phase must come first. Agents depend on safe tools.

### Phase 2: Agent Evaluators

Modules: `agent_evaluators.py`, `judge.py` (async), `certification.py`

Build:

```text
agent_certifications DB table
Deterministic agent evaluators: policy_compliance, tool_use_correctness, risk_handling
POST /v1/agents/{id}/evaluate — deterministic checks run sync, LLM-as-judge runs async
GET  /v1/agents/{id}/certification
Agent Registry: Evaluators tab (per-evaluator result, criteria checklist, method badge)
Agent Registry: Certification tab
LLM-as-judge for response_quality and task_completion via durable worker
```

### Phase 3: Workflow Evaluators

Modules: `workflow_evaluators.py`, `certification.py`

Build:

```text
workflow_certifications DB table
Graph validation evaluator: node types, edge validity, required activation stages
Trajectory evaluator: activated nodes vs registered graph, skipped nodes, looping
POST /v1/workflows/{id}/evaluate
GET  /v1/workflows/{id}/certification
Workflow Designer: per-node certification badge and evaluator coverage panel
```

### Phase 4: Runtime Evaluation

Modules: `runtime.py`

Build:

```text
Sampling policy: high_risk 100%, review_queue 100%, new_version 50%, normal 5%
Runtime evaluation runner attached to live trace events
evaluation_runs, evaluation_results, and criterion results linked to trace_id and audit_event_ids
Failed eval routing to Review Queue with review_type=evaluation_failure
Evaluation Center: Runtime Evaluations tab showing sampled results
```

### Phase 5: Human Correction And Judge Calibration

Modules: `corrections.py`, `calibration.py`

Build:

```text
human_corrections DB table
Reviewer correction intake in Evaluation Center: Human Corrections tab
judge_versions and judge_alignment_metrics DB tables
Judge-human agreement score tracking per judge version
Few-shot calibration example management
Judge lifecycle: DRAFT → CALIBRATING → ACTIVE → NEEDS_RECALIBRATION → RETIRED
Evaluation Center: Judge Calibration tab with agreement trend chart
```

## 11. Key Product Principle

Tool evaluation is a prerequisite for agent registration.

Agent evaluation is a prerequisite for production agent use.

Workflow evaluation is a prerequisite for production workflow use.

LLM-as-judge is useful, but only trustworthy after calibration against human
corrections. Deterministic checks should be used whenever the platform can verify
behavior exactly.
