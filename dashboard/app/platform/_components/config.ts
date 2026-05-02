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
  agentAssignments: {},
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
    agent_type: "task_agent",
    owner: "Claims Operations",
    environment: "demo",
    purpose: "Reviews claims using explicitly granted tools and records governed runtime decisions.",
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
      domain: "claims",
      data_domain: "claims",
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
      tool_argument_rules: {
        get_customer_transactions: {
          required: ["customer_id"],
          customer_id_must_match_query: true,
          max_limit: 25,
        },
      },
      tool_side_effect_controls: {
        update_contact_info: {
          level: "write_update",
          requires_review: true,
          review_score: 72,
          reason: "Contact updates change customer records and require reviewer approval before execution.",
        },
      },
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
  workflow_definition_id: "banking-account-inquiry",
  name: "Banking Account Inquiry",
  description: "Authenticate account scope, route account inquiry work, and review sensitive financial summaries before release.",
  owner: "Banking Operations",
  environment: "demo",
  domain: "banking",
  lead_agent_id: "banking-lead-agent",
  trigger_type: "manual",
  steps: [
    {
      step_id: "auth_gate",
      label: "Authenticate account scope",
      role: "gate_agent:auth_gate",
      agent_id: "banking-auth-gate-agent",
      node_type: "gate_agent",
      activation_policy: "always",
      activation_stage: "pre_route",
      task: "Confirm the request is bound to the authenticated account scope.",
      tool_args: {},
    },
    {
      step_id: "account_inquiry",
      label: "Prepare account inquiry",
      role: "task_agent:account_inquiry",
      agent_id: "banking-account-inquiry-agent",
      node_type: "task_agent",
      activation_policy: "conditional",
      activation_stage: "routed",
      task: "Prepare a scoped banking account inquiry response.",
      tool_args: {},
    },
    {
      step_id: "compliance_review",
      label: "Review sensitive summary",
      role: "review_agent:compliance_review",
      agent_id: "banking-compliance-review-agent",
      node_type: "review_agent",
      activation_policy: "on_risk",
      activation_stage: "final_review",
      task: "Review sensitive financial information before release.",
      tool_args: {},
    },
  ],
  edges: [
    { edge_id: "lead->auth_gate", from_node_id: "lead", to_node_id: "auth_gate", conditions: { required: true } },
    { edge_id: "auth_gate->account_inquiry", from_node_id: "auth_gate", to_node_id: "account_inquiry", conditions: { when: "authenticated" } },
    { edge_id: "account_inquiry->compliance_review", from_node_id: "account_inquiry", to_node_id: "compliance_review", conditions: { when: "sensitive_financial_summary" } },
  ],
  metadata: {
    domain: "banking",
    risk_controls: ["policy_check", "audit_trail", "human_review_when_required"],
  },
};
