import type { ApiRecord, PlatformData } from "@/lib/api";
import type { ControlTemplateKey, WorkspaceViewDefinition } from "./types";

export const workspaceViews: WorkspaceViewDefinition[] = [
  {
    id: "overview",
    label: "Overview",
    title: "Overview",
    description: "Workflow health, runtime decisions, and risk signals.",
  },
  {
    id: "control",
    label: "Control Plane",
    title: "Control Plane",
    description: "Onboard agents, tools, guardrails, evaluators, and knowledge bases into governed runtime control.",
  },
  {
    id: "workflows",
    label: "Agentic Workflows",
    title: "Agentic Workflows",
    description: "Build, run, and monitor multi-agent workflows.",
  },
  {
    id: "trace",
    label: "Workflow Trace",
    title: "Workflow Trace",
    description: "Inspect workflow runs, sessions, tool calls, and policy events.",
  },
  {
    id: "policies",
    label: "Runtime Policies",
    title: "Runtime Policies",
    description: "Review active rules and enforcement outcomes.",
  },
  {
    id: "reviews",
    label: "Review Queue",
    title: "Review Queue",
    description: "Resolve human review items.",
  },
  {
    id: "audit",
    label: "Audit Events",
    title: "Audit Events",
    description: "Search governed actions and decisions.",
  },
];

export const emptyPlatformData: PlatformData = {
  agents: [],
  agentAssignmentCounts: {},
  workflowDefinitions: [],
  workflows: [],
  workflowDetails: [],
  sessions: [],
  reviewQueue: [],
  auditEvents: [],
  guardrailPolicies: [],
  evaluatorTemplates: [],
  knowledgeBases: [],
  tools: [],
  environments: [],
};

export const controlTemplates: Record<ControlTemplateKey, ApiRecord> = {
  agent: {
    agent_id: "claims-review-agent",
    display_name: "Claims Review Agent",
    agent_type: "specialist_agent",
    owner: "Support Operations",
    environment: "demo",
    purpose: "Reviews customer claims using explicitly granted tools and records governed decisions.",
    permissions: {
      tools: ["get_customer_profile"],
      actions: ["read_customer_profile", "summarize_claim_context"],
      scopes: {
        customer_access: "customer_id",
        pii_exposure: "summaries_only",
      },
    },
    metadata: {
      framework: "custom-agent",
      data_domain: "customer_support",
      llm: {
        gateway_endpoint: "unified",
        model: "ollama/qwen3.5:9b"
      },
    },
  },
  tool: {
    tool_name: "summarize_support_case",
    display_name: "Summarize Support Case",
    category: "support_operations",
    description: "Creates a governed summary of a support case for an approved agent.",
    access_model: "grant_required",
    environment: "demo",
    input_schema: {
      type: "object",
      properties: {
        case_id: { type: "string" },
      },
      required: ["case_id"],
    },
    output_schema: {
      type: "object",
      properties: {
        summary: { type: "string" },
      },
    },
    metadata: {
      side_effects: "none",
      data_classification: "customer_sensitive",
    },
  },
  guardrail: {
    policy_id: "pol_custom_001",
    display_name: "Custom Policy",
    description: "Policy for governed runtime actions.",
    environment: "demo",
    config: {
      allowed_tools: [],
      blocked_tools: [],
      max_records_returned: 100,
      block_pii_in_response: true,
      redact_pii_in_response: false,
      blocked_patterns: [],
      review_required_for: [],
      decision_thresholds: { review: 50, block: 80 },
    },
  },
  evaluator: {
    evaluator_id: "response-safety-check",
    display_name: "Response Safety Check",
    evaluator_type: "llm_judge",
    scope: "agent",
    description: "Scores responses for safety, grounding, and policy fit.",
    default_config: { pass_threshold: 80 },
    llm_enabled: true,
  },
  knowledge: {
    kb_id: "policy-docs",
    display_name: "Policy Documents",
    description: "Governance policy and operating procedure knowledge base.",
    source_type: "vector_store",
    source_config: {},
    environment: "demo",
  },
};

export const workflowDefinitionTemplate: ApiRecord = {
  workflow_definition_id: "customer-support-investigation",
  name: "Customer Support Investigation",
  description: "Verify customer context, review recent transactions, and record a governed response recommendation.",
  owner: "Support Operations",
  environment: "demo",
  lead_agent_id: "customer-support-lead-agent",
  trigger_type: "manual",
  steps: [
    {
      step_id: "identity",
      label: "Verify customer profile",
      role: "sub_agent:identity",
      agent_id: "identity-verification-agent",
      task: "Verify customer profile for {{customer_id}}.",
      tool_name: "get_customer_profile",
      tool_args: { customer_id: "{{customer_id}}" },
    },
    {
      step_id: "transactions",
      label: "Retrieve recent transactions",
      role: "sub_agent:transactions",
      agent_id: "transaction-analyst-agent",
      task: "Retrieve recent transactions for {{customer_id}}.",
      tool_name: "get_customer_transactions",
      tool_args: { customer_id: "{{customer_id}}" },
    },
    {
      step_id: "risk_review",
      label: "Review workflow outputs",
      role: "sub_agent:risk_review",
      agent_id: "risk-review-agent",
      task: "Review outputs for safe response composition.",
    },
  ],
  metadata: {
    domain: "customer_support",
    risk_controls: ["policy_check", "audit_trail", "human_review_when_required"],
  },
};
