import type { ApiRecord } from "@/lib/api";
import { controlTemplates, workflowDefinitionTemplate } from "./config";
import type { BackendComponentKey, ControlTemplateKey, WorkspaceView } from "./types";

export const AGENT_TYPE_VALUES = [
  "lead_agent",
  "gate_agent",
  "task_agent",
  "review_agent",
  "approval_agent",
  "terminal_agent",
] as const;

const KEBAB_CASE_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const SNAKE_CASE_RE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const LOWER_TOKEN_RE = /^[a-z][a-z0-9_-]*$/;
const SEMVERISH_RE = /^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/;

export function validateKebabCase(value: string, label: string) {
  if (!KEBAB_CASE_RE.test(value.trim())) {
    return `${label} must use kebab-case, for example banking-account-inquiry.`;
  }
  return undefined;
}

export function validateSnakeCase(value: string, label: string) {
  if (!SNAKE_CASE_RE.test(value.trim())) {
    return `${label} must use snake_case, for example banking_accounts.`;
  }
  return undefined;
}

export function validateLowerToken(value: string, label: string) {
  if (!LOWER_TOKEN_RE.test(value.trim())) {
    return `${label} must start with a lowercase letter and use only lowercase letters, numbers, hyphens, or underscores.`;
  }
  return undefined;
}

export function validateAgentType(value: string) {
  if (!AGENT_TYPE_VALUES.includes(value.trim() as typeof AGENT_TYPE_VALUES[number])) {
    return `Agent Type must be one of: ${AGENT_TYPE_VALUES.join(", ")}.`;
  }
  return undefined;
}

export function validateVersion(value: string) {
  if (!SEMVERISH_RE.test(value.trim())) {
    return "Agent Version must use semantic versioning, for example 1.0.0.";
  }
  return undefined;
}

export function readText(record: ApiRecord, keys: string[]) {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === "string" || typeof value === "number") {
      return String(value);
    }
  }

  return undefined;
}
export function joinParts(parts: Array<string | undefined>) {
  const value = parts.filter(Boolean).join(" / ");
  return value || undefined;
}

function padTimePart(value: number) {
  return String(value).padStart(2, "0");
}

export function formatIsoTimestamp(value: string | number | Date | undefined = new Date()) {
  if (!value) {
    return undefined;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  const timezoneOffset = -date.getTimezoneOffset();
  const offsetSign = timezoneOffset >= 0 ? "+" : "-";
  const absoluteOffset = Math.abs(timezoneOffset);
  const offsetHours = padTimePart(Math.floor(absoluteOffset / 60));
  const offsetMinutes = padTimePart(absoluteOffset % 60);

  return [
    date.getFullYear(),
    "-",
    padTimePart(date.getMonth() + 1),
    "-",
    padTimePart(date.getDate()),
    "T",
    padTimePart(date.getHours()),
    ":",
    padTimePart(date.getMinutes()),
    ":",
    padTimePart(date.getSeconds()),
    offsetSign,
    offsetHours,
    ":",
    offsetMinutes,
  ].join("");
}

export function formatTimestamp(value: string | undefined) {
  return formatIsoTimestamp(value);
}
export function isErrorMessage(message: string) {
  const normalized = message.toLowerCase();

  return [
    "already exists",
    "error",
    "expired",
    "expected",
    "failed",
    "invalid",
    "must be valid",
    "select ",
    "syntax",
    "unable",
    "unexpected",
  ].some((phrase) => normalized.includes(phrase));
}
export function templateJson(kind: ControlTemplateKey) {
  return JSON.stringify(controlTemplates[kind], null, 2);
}
export function workflowTemplateJson(environment: string) {
  return JSON.stringify(
    {
      ...workflowDefinitionTemplate,
      environment: environment === "all" ? workflowDefinitionTemplate.environment : environment,
    },
    null,
    2,
  );
}
export function agentProfileForm(agent: ApiRecord) {
  const metadata = agent.metadata && typeof agent.metadata === "object" && !Array.isArray(agent.metadata)
    ? (agent.metadata as Record<string, unknown>)
    : {};
  const llm = metadata.llm && typeof metadata.llm === "object" && !Array.isArray(metadata.llm)
    ? (metadata.llm as Record<string, unknown>)
    : {};
  const vault = llm.hashicorp_vault && typeof llm.hashicorp_vault === "object" && !Array.isArray(llm.hashicorp_vault)
    ? (llm.hashicorp_vault as Record<string, unknown>)
    : llm.vault && typeof llm.vault === "object" && !Array.isArray(llm.vault)
      ? (llm.vault as Record<string, unknown>)
      : metadata.hashicorp_vault && typeof metadata.hashicorp_vault === "object" && !Array.isArray(metadata.hashicorp_vault)
        ? (metadata.hashicorp_vault as Record<string, unknown>)
        : {};

  return {
    agent_id: readText(agent, ["agent_id"]) || "",
    display_name: readText(agent, ["display_name"]) || "",
    owner: readText(agent, ["owner"]) || "",
    environment: readText(agent, ["environment"]) || "",
    domain: String(metadata.domain || metadata.data_domain || ""),
    agent_type: readText(agent, ["agent_type"]) || "",
    purpose: readText(agent, ["purpose"]) || "",
    version: String(metadata.version || metadata.agent_version || "1.0.0"),
    llm_gateway_endpoint: String(llm.gateway_endpoint || llm.gatewayEndpoint || llm.endpoint || "/llm/v1"),
    llm_model: String(llm.model || "local/default-9b"),
    vault_username: String(vault.username || vault.user_name || ""),
    vault_api_key: String(vault.api_key || vault.apiKey || ""),
    metadata: JSON.stringify(metadata, null, 2),
  };
}
export function agentDomain(agent: ApiRecord) {
  const metadata = agent.metadata && typeof agent.metadata === "object" && !Array.isArray(agent.metadata)
    ? (agent.metadata as Record<string, unknown>)
    : {};
  return String(metadata.domain || metadata.data_domain || "");
}
export function getAgentTools(agent: ApiRecord) {
  const permissions = agent.permissions;

  if (!permissions || typeof permissions !== "object" || Array.isArray(permissions)) {
    return [];
  }

  const tools = (permissions as Record<string, unknown>).tools;
  return Array.isArray(tools) ? tools.map(String) : [];
}
export function agentVersion(agent: ApiRecord) {
  const metadata = agent.metadata && typeof agent.metadata === "object" && !Array.isArray(agent.metadata)
    ? (agent.metadata as Record<string, unknown>)
    : {};
  return String(metadata.version || metadata.agent_version || "1.0.0");
}
export function sumAgentToolGrants(agents: ApiRecord[]) {
  return agents.reduce((total, agent) => total + getAgentTools(agent).length, 0);
}
export function countUnique(records: ApiRecord[], key: string) {
  return new Set(records.map((record) => readText(record, [key])).filter(Boolean)).size;
}
export function readNestedText(record: ApiRecord, path: string[]) {
  let current: unknown = record;

  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }

    current = (current as Record<string, unknown>)[key];
  }

  if (typeof current === "string" || typeof current === "number" || typeof current === "boolean") {
    return String(current);
  }

  return undefined;
}
export function isBackendComponentKey(value: string | null): value is BackendComponentKey {
  return (
    value === "agents" ||
    value === "tools" ||
    value === "workflows" ||
    value === "guardrails" ||
    value === "evaluators" ||
    value === "knowledge" ||
    value === "reviews" ||
    value === "audit" ||
    value === "monitoring" ||
    value === "environments"
  );
}
function isWorkspaceView(value: string | null): value is WorkspaceView {
  return (
    value === "overview" ||
    value === "tool-registry" ||
    value === "agent-registry" ||
    value === "workflow-designer" ||
    value === "knowledge-bases" ||
    value === "guardrail-policies" ||
    value === "evaluation-center" ||
    value === "agentic-workflows" ||
    value === "reviews" ||
    value === "audit" ||
    value === "monitoring"
  );
}
export function workspaceViewFromUrl(): WorkspaceView {
  const params = new URLSearchParams(window.location.search);
  const view = params.get("view");
  if (isWorkspaceView(view)) {
    return view;
  }

  const hash = window.location.hash.replace("#", "");
  if (isWorkspaceView(hash)) {
    return hash;
  }

  return "overview";
}
export function workspaceViewForComponent(component: BackendComponentKey): WorkspaceView {
  if (component === "tools") {
    return "tool-registry";
  }

  if (component === "agents") {
    return "agent-registry";
  }

  if (component === "workflows") {
    return "workflow-designer";
  }

  if (component === "guardrails") {
    return "guardrail-policies";
  }

  if (component === "evaluators") {
    return "evaluation-center";
  }

  if (component === "knowledge") {
    return "knowledge-bases";
  }

  if (component === "reviews") {
    return "reviews";
  }

  if (component === "audit") {
    return "audit";
  }

  if (component === "monitoring") {
    return "monitoring";
  }

  return "overview";
}
export function formatCount(value: number, label: string) {
  return `${value} ${label}${value === 1 ? "" : "s"}`;
}
