import type { ApiRecord } from "@/lib/api";
import { controlTemplates, workflowDefinitionTemplate } from "./config";
import type { BackendComponentKey, ControlTemplateKey, WorkspaceView } from "./types";

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
    value === "environments"
  );
}
export function isWorkspaceView(value: string | null): value is WorkspaceView {
  return (
    value === "overview" ||
    value === "workflows" ||
    value === "trace" ||
    value === "control" ||
    value === "policies" ||
    value === "reviews" ||
    value === "audit"
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
  if (component === "workflows") {
    return "workflows";
  }

  if (component === "guardrails") {
    return "policies";
  }

  if (component === "evaluators" || component === "knowledge") {
    return "control";
  }

  if (component === "reviews") {
    return "reviews";
  }

  if (component === "audit") {
    return "audit";
  }

  return "control";
}
export function formatCount(value: number, label: string) {
  return `${value} ${label}${value === 1 ? "" : "s"}`;
}
