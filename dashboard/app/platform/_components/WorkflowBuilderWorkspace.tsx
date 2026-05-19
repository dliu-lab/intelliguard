"use client";

import type { CSSProperties, ChangeEvent, FormEvent, KeyboardEvent, PointerEvent, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { FileJson, GitBranch, ListTree, PencilLine, Plus, Route, UploadCloud, X, ZoomIn, ZoomOut } from "lucide-react";
import { createWorkflowDefinition, getSession, runMultiAgentWorkflow, type ApiRecord, type PlatformData } from "@/lib/api";
import { ComponentRow } from "./shared";
import {
  formatCount,
  formatTimestamp,
  isErrorMessage,
  joinParts,
  readNestedText,
  readText,
  validateKebabCase,
  validateLowerToken,
  validateSnakeCase,
  workflowTemplateJson,
} from "./utils";
import { WorkflowDeploymentPanel } from "./WorkflowDeploymentPanel";

type WorkflowStepDraft = {
  step_id: string;
  label: string;
  role?: string;
  agent_id: string;
  node_type?: string;
  activation_policy?: string;
  activation_stage?: string;
  capabilities?: string[];
  allowed_tools?: string[];
  data_scope?: Record<string, unknown>;
  side_effect_level?: string;
  tool_name?: string;
  task?: string;
  tool_args?: unknown;
  tool_args_json?: string;
};

type WorkflowDraft = {
  workflow_definition_id: string;
  name: string;
  description?: string;
  owner?: string;
  environment: string;
  domain?: string;
  lead_agent_id: string;
  trigger_type?: string;
  steps: WorkflowStepDraft[];
  edges?: ApiRecord[];
  metadata?: Record<string, unknown>;
};

type CanvasNodePosition = {
  x: number;
  y: number;
};

type WorkflowConnection = {
  id: string;
  from: string;
  to: string;
};

type PortSide = "in" | "out";
type LinkActionResult = "cancelled" | "created" | "duplicate" | "invalid" | "linking";
type SavedWorkflowRow = {
  definition: ApiRecord;
  definitionId: string;
  domain: string;
  edges: ApiRecord[];
  environment: string;
  isLatestVersion: boolean;
  linkedRun?: ApiRecord;
  linkedRunDetail?: ApiRecord;
  linkedRunId: string;
  nodes: ApiRecord[];
  status: string;
  version: string;
  versionNumber: number;
  versionRootId: string;
};

const LEAD_NODE_ID = "lead";
const CANVAS_HEIGHT = 720;
const NODE_WIDTH = 236;
const NODE_HEIGHT = 96;
const ACTIVATION_POLICIES = ["always", "conditional", "on_risk", "human_required"];
const ACTIVATION_STAGES = ["pre_route", "routed", "pre_tool", "post_tool", "final_review"];

function canvasWorldWidth(draft: WorkflowDraft) {
  return Math.max(1240, 420 + draft.steps.length * 220);
}

function canvasNodeIds(draft: WorkflowDraft) {
  return [LEAD_NODE_ID, ...draft.steps.map((step) => step.step_id)];
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function cubicPoint(
  start: CanvasNodePosition,
  controlStart: CanvasNodePosition,
  controlEnd: CanvasNodePosition,
  end: CanvasNodePosition,
  t: number,
) {
  const remaining = 1 - t;

  return {
    x:
      remaining ** 3 * start.x +
      3 * remaining ** 2 * t * controlStart.x +
      3 * remaining * t ** 2 * controlEnd.x +
      t ** 3 * end.x,
    y:
      remaining ** 3 * start.y +
      3 * remaining ** 2 * t * controlStart.y +
      3 * remaining * t ** 2 * controlEnd.y +
      t ** 3 * end.y,
  };
}

function connectionId(from: string, to: string) {
  return `${from}->${to}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecords(value: unknown): ApiRecord[] {
  return Array.isArray(value) ? (value.filter((item) => isRecord(item)) as ApiRecord[]) : [];
}

function objectValue(record: ApiRecord | undefined, key: string): ApiRecord {
  const value = record?.[key];
  return isRecord(value) ? (value as ApiRecord) : {};
}

function compactJson(value: unknown) {
  if (!value || (typeof value === "object" && !Array.isArray(value) && !Object.keys(value).length)) {
    return "No captured detail.";
  }
  return JSON.stringify(value, null, 2);
}

function workflowMetadata(draft: WorkflowDraft) {
  return isRecord(draft.metadata) ? draft.metadata : {};
}

function sanitizeConnections(draft: WorkflowDraft, connections: unknown) {
  if (!Array.isArray(connections)) {
    return [];
  }

  const validIds = new Set(canvasNodeIds(draft));
  const seen = new Set<string>();

  return connections.reduce<WorkflowConnection[]>((next, connection) => {
    if (!isRecord(connection)) {
      return next;
    }

    const from = typeof connection.from === "string" ? connection.from : "";
    const to = typeof connection.to === "string" ? connection.to : "";

    if (!from || !to || from === to || to === LEAD_NODE_ID || !validIds.has(from) || !validIds.has(to)) {
      return next;
    }

    const id = connectionId(from, to);
    if (seen.has(id)) {
      return next;
    }

    seen.add(id);
    next.push({ id, from, to });
    return next;
  }, []);
}

function fanOutConnections(draft: WorkflowDraft) {
  return draft.steps.map((step) => ({
    id: connectionId(LEAD_NODE_ID, step.step_id),
    from: LEAD_NODE_ID,
    to: step.step_id,
  }));
}

function defaultConnections(draft: WorkflowDraft, current: WorkflowConnection[] = []) {
  const filtered = sanitizeConnections(draft, current);

  if (filtered.length) {
    return filtered;
  }

  const metadata = workflowMetadata(draft);
  if ("visual_connections" in metadata) {
    return sanitizeConnections(draft, metadata.visual_connections);
  }
  if (Array.isArray(draft.edges) && draft.edges.length) {
    return sanitizeConnections(
      draft,
      draft.edges.map((edge) => ({
        id: readText(edge, ["edge_id"]) || "",
        from: readText(edge, ["from_node_id", "from"]) || "",
        to: readText(edge, ["to_node_id", "to"]) || "",
      })),
    );
  }

  return fanOutConnections(draft);
}

function sanitizeNodePositions(draft: WorkflowDraft, positions: unknown) {
  if (!isRecord(positions)) {
    return {};
  }

  const validIds = new Set(canvasNodeIds(draft));
  return Object.entries(positions).reduce<Record<string, CanvasNodePosition>>((next, [nodeId, position]) => {
    if (!validIds.has(nodeId) || !isRecord(position)) {
      return next;
    }

    const x = Number(position.x);
    const y = Number(position.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return next;
    }

    next[nodeId] = { x, y };
    return next;
  }, {});
}

function defaultNodePositions(draft: WorkflowDraft, current: Record<string, CanvasNodePosition> = {}) {
  const worldWidth = canvasWorldWidth(draft);
  const next: Record<string, CanvasNodePosition> = {};
  const metadataPositions = sanitizeNodePositions(draft, workflowMetadata(draft).node_positions);

  next[LEAD_NODE_ID] = current[LEAD_NODE_ID] || metadataPositions[LEAD_NODE_ID] || { x: 190, y: 360 };
  draft.steps.forEach((step, index) => {
    next[step.step_id] =
      current[step.step_id] ||
      metadataPositions[step.step_id] || {
        x: clamp(430 + index * 220, 160, worldWidth - 160),
        y: index % 2 === 0 ? 250 : 430,
      };
  });

  return next;
}

function uniqueWorkflowId(baseId: string) {
  return `${baseId}-${Date.now().toString(36)}`;
}

function toWorkflowDraft(environment: string): WorkflowDraft {
  const template = JSON.parse(workflowTemplateJson(environment)) as WorkflowDraft;
  const baseEnvironment = environment === "all" ? template.environment : environment;

  return {
    ...template,
    workflow_definition_id: uniqueWorkflowId(template.workflow_definition_id),
    name: `${template.name} Copy`,
    environment: baseEnvironment,
    steps: template.steps.map((step) => ({
      ...step,
      tool_args_json: JSON.stringify(step.tool_args || {}, null, 2),
    })),
  };
}

function cleanWorkflowDraft(
  draft: WorkflowDraft,
  nodePositions: Record<string, CanvasNodePosition>,
  connections: WorkflowConnection[],
  agentTypesById: Record<string, string>,
): ApiRecord {
  const visualConnections = sanitizeConnections(draft, connections);
  const metadata = workflowMetadata(draft);
  const versionNumber = metadataVersionNumber(metadata);
  const leadDelegations = visualConnections
    .filter((connection) => connection.from === LEAD_NODE_ID)
    .map((connection) => connection.to);
  const nodes = [
    {
      node_id: LEAD_NODE_ID,
      agent_id: draft.lead_agent_id,
      node_type: "lead_agent",
      activation_policy: "always",
      activation_stage: "pre_route",
      capabilities: ["route_request", "coordinate_workflow"],
      allowed_tools: [],
      data_scope: {},
      side_effect_level: "none",
    },
    ...draft.steps.map((step) => ({
      node_id: step.step_id,
      agent_id: step.agent_id,
      node_type: agentTypesById[step.agent_id] || normalizeAgentType(step.node_type) || "task_agent",
      activation_policy: step.activation_policy || "conditional",
      activation_stage: step.activation_stage || "routed",
      capabilities: step.capabilities || [step.task || step.label],
      allowed_tools: step.tool_name ? [step.tool_name] : [],
      data_scope: step.data_scope || {},
      side_effect_level: step.side_effect_level || "read_only",
      label: step.label,
      task: step.task,
      tool_name: step.tool_name,
      tool_args: step.tool_args_json ? JSON.parse(step.tool_args_json) : step.tool_args || {},
    })),
  ];
  const edges = visualConnections.map((connection) => ({
    edge_id: connection.id,
    from_node_id: connection.from,
    to_node_id: connection.to,
    conditions: {},
  }));

  return {
    ...draft,
    workflow_definition_id: draft.workflow_definition_id || uniqueWorkflowId("workflow"),
    nodes,
    edges,
    metadata: {
      ...metadata,
      domain: draft.domain || metadata.domain || "general",
      execution_mode: leadDelegations.length > 1 ? "multi_agent_fan_out" : "multi_agent_graph",
      lead_delegations: leadDelegations,
      visual_connections: visualConnections,
      node_positions: nodePositions,
      workflow_root_id: readText(metadata, ["workflow_root_id", "root_workflow_definition_id"]) || draft.workflow_definition_id,
      workflow_version: readText(metadata, ["workflow_version", "version"]) || `v${versionNumber}`,
      workflow_version_number: versionNumber,
    },
    steps: draft.steps.map(({ tool_args_json: toolArgsJson, ...step }) => ({
      ...step,
      node_type: agentTypesById[step.agent_id] || normalizeAgentType(step.node_type) || "task_agent",
      tool_args: toolArgsJson ? JSON.parse(toolArgsJson) : step.tool_args || {},
    })),
  };
}

function safeOption(value: string | undefined, fallback: string) {
  return value && value.trim() ? value : fallback;
}

function normalizeAgentType(value: string | undefined) {
  const legacyMap: Record<string, string> = {
    cli_agent: "task_agent",
    custom_agent: "task_agent",
    lead_orchestrator: "lead_agent",
    specialist_agent: "task_agent",
    sub_agent: "task_agent",
    support_assistant: "task_agent",
  };
  return legacyMap[value || ""] || value || "";
}

function getAgentTools(agent: ApiRecord | undefined) {
  const permissions = agent?.permissions;
  if (!permissions || typeof permissions !== "object" || Array.isArray(permissions)) {
    return [];
  }

  const tools = (permissions as Record<string, unknown>).tools;
  return Array.isArray(tools) ? tools.map(String).filter(Boolean) : [];
}

function certificationStatus(record: ApiRecord | undefined) {
  const certification = record?.certification;
  if (!certification || typeof certification !== "object" || Array.isArray(certification)) {
    return "DRAFT";
  }

  return readText(certification as ApiRecord, ["status"]) || "DRAFT";
}

function workflowDefinitionStatus(definition: ApiRecord) {
  return readText(definition, ["certification_status"]) || certificationStatus(definition);
}

function workflowDefinitionIdForRecord(definition: ApiRecord) {
  return readText(definition, ["workflow_definition_id", "id"]) || "";
}

function workflowDefinitionDomain(definition: ApiRecord) {
  return readText(definition, ["domain"]) || readNestedText(definition, ["metadata", "domain"]) || "general";
}

function metadataVersionNumber(metadata: ApiRecord) {
  const explicitVersion = Number(metadata.workflow_version_number || metadata.version_number);
  if (Number.isFinite(explicitVersion) && explicitVersion > 0) {
    return Math.floor(explicitVersion);
  }

  const label = readText(metadata, ["workflow_version", "version"]) || "";
  const match = label.match(/\d+/);
  const parsedVersion = match ? Number(match[0]) : 1;
  return Number.isFinite(parsedVersion) && parsedVersion > 0 ? Math.floor(parsedVersion) : 1;
}

function workflowVersionNumber(definition: ApiRecord) {
  return metadataVersionNumber(objectValue(definition, "metadata"));
}

function workflowVersionLabel(definition: ApiRecord) {
  const metadata = objectValue(definition, "metadata");
  return readText(metadata, ["workflow_version", "version"]) || `v${workflowVersionNumber(definition)}`;
}

function workflowVersionRootId(definition: ApiRecord) {
  const metadata = objectValue(definition, "metadata");
  return (
    readText(metadata, ["workflow_root_id", "root_workflow_definition_id"])
    || workflowDefinitionIdForRecord(definition)
  );
}

function workflowDefinitionNodes(definition: ApiRecord) {
  const nodes = asRecords(definition.nodes);
  if (nodes.length) {
    return nodes;
  }

  const steps = asRecords(definition.steps);
  if (!steps.length) {
    return [];
  }

  return [
    {
      agent_id: readText(definition, ["lead_agent_id"]) || "",
      node_id: LEAD_NODE_ID,
      node_type: "lead_agent",
    },
    ...steps.map((step) => ({
      ...step,
      node_id: readText(step, ["step_id", "node_id"]) || "",
    })),
  ];
}

function workflowDefinitionEdges(definition: ApiRecord) {
  return asRecords(definition.edges);
}

function isLeadWorkflowNode(node: ApiRecord) {
  return readText(node, ["node_id", "step_id"]) === LEAD_NODE_ID || readText(node, ["node_type"]) === "lead_agent";
}

function arrayStrings(value: unknown) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : undefined;
}

function workflowStepDraftFromRecord(record: ApiRecord, index: number): WorkflowStepDraft {
  const stepId = readText(record, ["step_id", "node_id"]) || `step_${index + 1}`;
  const toolArgs = record.tool_args === undefined ? {} : record.tool_args;
  const allowedTools = arrayStrings(record.allowed_tools);
  const toolName = readText(record, ["tool_name"]) || allowedTools?.[0] || undefined;

  return {
    step_id: stepId,
    label: readText(record, ["label", "name", "task"]) || stepId,
    role: readText(record, ["role"]) || `task_agent:${stepId}`,
    agent_id: readText(record, ["agent_id"]) || "",
    node_type: normalizeAgentType(readText(record, ["node_type"])) || undefined,
    activation_policy: readText(record, ["activation_policy"]) || "conditional",
    activation_stage: readText(record, ["activation_stage"]) || "routed",
    capabilities: arrayStrings(record.capabilities),
    allowed_tools: allowedTools,
    data_scope: isRecord(record.data_scope) ? (record.data_scope as Record<string, unknown>) : undefined,
    side_effect_level: readText(record, ["side_effect_level"]) || undefined,
    tool_name: toolName,
    task: readText(record, ["task", "description"]) || undefined,
    tool_args: toolArgs,
    tool_args_json: JSON.stringify(toolArgs, null, 2),
  };
}

function workflowDraftFromDefinition(definition: ApiRecord, selectedEnvironment: string): WorkflowDraft {
  const template = toWorkflowDraft(selectedEnvironment);
  const nodes = workflowDefinitionNodes(definition);
  const steps = asRecords(definition.steps);
  const stepSources = steps.length ? steps : nodes.filter((node) => !isLeadWorkflowNode(node));
  const leadNode = nodes.find(isLeadWorkflowNode);
  const definitionId = workflowDefinitionIdForRecord(definition) || uniqueWorkflowId("workflow");
  const environment =
    readText(definition, ["environment"])
    || (selectedEnvironment === "all" ? template.environment : selectedEnvironment)
    || "demo";

  return {
    workflow_definition_id: definitionId,
    name: readText(definition, ["name", "display_name"]) || definitionId,
    description: readText(definition, ["description"]) || "",
    owner: readText(definition, ["owner"]) || "Unassigned",
    environment,
    domain: workflowDefinitionDomain(definition),
    lead_agent_id: readText(definition, ["lead_agent_id"]) || readText(leadNode || {}, ["agent_id"]) || template.lead_agent_id,
    trigger_type: readText(definition, ["trigger_type"]) || "manual",
    steps: stepSources.map(workflowStepDraftFromRecord),
    edges: workflowDefinitionEdges(definition),
    metadata: objectValue(definition, "metadata"),
  };
}

function nextWorkflowVersionForRow(row: SavedWorkflowRow, rows: SavedWorkflowRow[]) {
  const existingIds = new Set(rows.map((item) => item.definitionId).filter(Boolean));
  const relatedRows = rows.filter(
    (item) => item.versionRootId === row.versionRootId || item.definitionId === row.versionRootId,
  );
  let nextVersionNumber = Math.max(row.versionNumber, 1, ...relatedRows.map((item) => item.versionNumber)) + 1;
  let nextDefinitionId = `${row.versionRootId}-v${nextVersionNumber}`;

  while (existingIds.has(nextDefinitionId)) {
    nextVersionNumber += 1;
    nextDefinitionId = `${row.versionRootId}-v${nextVersionNumber}`;
  }

  return { nextDefinitionId, nextVersionNumber };
}

function workflowDraftForNewVersion(row: SavedWorkflowRow, rows: SavedWorkflowRow[], selectedEnvironment: string) {
  const draft = workflowDraftFromDefinition(row.definition, selectedEnvironment);
  const { nextDefinitionId, nextVersionNumber } = nextWorkflowVersionForRow(row, rows);

  return {
    ...draft,
    workflow_definition_id: nextDefinitionId,
    metadata: {
      ...(draft.metadata || {}),
      previous_workflow_definition_id: row.definitionId,
      source_workflow_definition_id: row.definitionId,
      workflow_root_id: row.versionRootId,
      workflow_version: `v${nextVersionNumber}`,
      workflow_version_number: nextVersionNumber,
    },
  };
}

function defaultWorkflowRunQuery(draft: WorkflowDraft) {
  return (
    draft.description?.trim()
    || draft.name?.trim()
    || `Run workflow ${draft.workflow_definition_id}.`
  );
}

function workflowRunId(workflow: ApiRecord | undefined) {
  return workflow ? readText(workflow, ["workflow_id", "id", "session_id"]) || "" : "";
}

function workflowRunDefinitionId(workflow: ApiRecord | undefined, detail?: ApiRecord) {
  return workflow
    ? readText(workflow, ["workflow_definition_id"])
      || readNestedText(workflow, ["metadata", "workflow_definition_id"])
      || readText(detail || {}, ["workflow_definition_id"])
      || readNestedText(detail || {}, ["metadata", "workflow_definition_id"])
      || ""
    : "";
}

function workflowRunTimestamp(workflow: ApiRecord | undefined, detail?: ApiRecord) {
  const value = workflow
    ? readText(workflow, ["updated_at", "created_at"])
      || readText(detail || {}, ["updated_at", "created_at"])
    : undefined;
  const timestamp = value ? new Date(value).getTime() : 0;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function workflowStatusTone(status: string) {
  const value = status.toUpperCase();
  if (value.includes("CERTIFIED") || value.includes("COMPLETE") || value.includes("ALLOW") || value.includes("APPROVED")) {
    return "border-accent/35 bg-accent/10 text-accent";
  }
  if (value.includes("REVIEW") || value.includes("PENDING")) {
    return "border-amber-300/45 bg-amber-300/15 text-textPrimary";
  }
  if (value.includes("FAIL") || value.includes("BLOCK") || value.includes("DENIED")) {
    return "border-rose-300/45 bg-rose-300/15 text-textPrimary";
  }
  return "border-line bg-white/[0.04] text-textSecondary";
}

function lookupDisplayName(records: ApiRecord[], idKey: string, id: string | undefined) {
  if (!id) {
    return undefined;
  }
  const record = records.find((item) => readText(item, [idKey]) === id);
  return readText(record || {}, ["display_name", "name", idKey]) || id;
}

function domainSearchTokens(domain: string | undefined) {
  return String(domain || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2);
}

function agentMetadata(agent: ApiRecord) {
  return agent.metadata && typeof agent.metadata === "object" && !Array.isArray(agent.metadata)
    ? (agent.metadata as Record<string, unknown>)
    : {};
}

function agentMatchesWorkflowDomain(agent: ApiRecord, domain: string | undefined) {
  const normalizedDomain = String(domain || "").toLowerCase();
  if (!normalizedDomain || normalizedDomain === "general") {
    return true;
  }

  const metadata = agentMetadata(agent);
  const workflowDomains = metadata.workflow_domains;
  if (Array.isArray(workflowDomains) && workflowDomains.map(String).includes(normalizedDomain)) {
    return true;
  }

  const dataDomain = String(metadata.domain || metadata.data_domain || "").toLowerCase();
  const owner = readText(agent, ["owner"])?.toLowerCase() || "";
  if (dataDomain === "governance" || dataDomain === "platform" || owner === "governance") {
    return true;
  }

  const haystack = [
    readText(agent, ["agent_id"]),
    readText(agent, ["display_name"]),
    readText(agent, ["owner"]),
    readText(agent, ["purpose"]),
    dataDomain,
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/[_-]+/g, " ")
    .toLowerCase();

  const tokens = domainSearchTokens(normalizedDomain);
  return haystack.includes(normalizedDomain.replace(/[_-]+/g, " ")) || tokens.some((token) => haystack.includes(token));
}

function assignmentSummary(
  assignments: ApiRecord[],
  idKey: string,
  registry: ApiRecord[],
  extraKeys: string[] = [],
) {
  return assignments.map((assignment) => {
    const id = readText(assignment, [idKey]);
    return joinParts([
      lookupDisplayName(registry, idKey, id),
      ...extraKeys.map((key) => readText(assignment, [key])),
    ]) || id || "Attached control";
  });
}

function validateWorkflowDraft(draft: WorkflowDraft) {
  const validationError =
    validateKebabCase(draft.workflow_definition_id, "Workflow ID")
    || validateLowerToken(draft.environment, "Environment")
    || validateSnakeCase(draft.domain || "", "Domain");
  if (validationError) {
    return validationError;
  }

  const duplicateStepIds = new Set<string>();
  const seenStepIds = new Set<string>();
  for (const step of draft.steps) {
    const stepIdError = validateSnakeCase(step.step_id, "Step ID");
    if (stepIdError) {
      return stepIdError;
    }
    if (seenStepIds.has(step.step_id)) {
      duplicateStepIds.add(step.step_id);
    }
    seenStepIds.add(step.step_id);
  }

  if (duplicateStepIds.size) {
    return `Step ID must be unique: ${Array.from(duplicateStepIds).join(", ")}.`;
  }

  return undefined;
}

export function WorkflowBuilderWorkspace({
  data,
  onRefresh,
  onWorkflowTraceSelect,
  selectedEnvironment,
}: {
  data: PlatformData;
  onRefresh: () => void;
  onWorkflowTraceSelect: (workflowIdOrSessionId: string) => void;
  selectedEnvironment: string;
}) {
  const [designerOpen, setDesignerOpen] = useState(false);
  const [selectedSavedWorkflowId, setSelectedSavedWorkflowId] = useState("");
  const [editingWorkflowSourceId, setEditingWorkflowSourceId] = useState("");
  const [draft, setDraft] = useState<WorkflowDraft>(() => toWorkflowDraft(selectedEnvironment));
  const [selectedStepId, setSelectedStepId] = useState(() => draft.steps[0]?.step_id || "");
  const [nodePositions, setNodePositions] = useState<Record<string, CanvasNodePosition>>({});
  const [connections, setConnections] = useState<WorkflowConnection[]>([]);
  const [connectionsTouched, setConnectionsTouched] = useState(false);
  const [linkingNodeId, setLinkingNodeId] = useState("");
  const [canvasZoom, setCanvasZoom] = useState(1);
  const [runAfterSaveQuery, setRunAfterSaveQuery] = useState(() => defaultWorkflowRunQuery(draft));
  const [savingAction, setSavingAction] = useState<"" | "save" | "save_run">("");
  const [message, setMessage] = useState("");

  const agentOptions = useMemo(
    () =>
      data.agents.map((agent) => ({
        id: readText(agent, ["agent_id"]) || "",
        label: joinParts([
          readText(agent, ["display_name", "agent_id"]) || "Agent",
          certificationStatus(agent),
        ]) || "Agent",
        agentType: normalizeAgentType(readText(agent, ["agent_type"])),
        certificationStatus: certificationStatus(agent),
        record: agent,
      })),
    [data.agents],
  );
  const agentTypesById = useMemo(
    () => Object.fromEntries(agentOptions.map((agent) => [agent.id, agent.agentType]).filter(([agentId]) => agentId)),
    [agentOptions],
  );
  const agentCertificationById = useMemo(
    () => Object.fromEntries(agentOptions.map((agent) => [agent.id, agent.certificationStatus]).filter(([agentId]) => agentId)),
    [agentOptions],
  );

  const environmentOptions = useMemo(() => {
    const values = [
      selectedEnvironment === "all" ? "demo" : selectedEnvironment,
      ...data.environments.filter((environment) => environment !== "all"),
    ];
    return Array.from(new Set(values.filter(Boolean)));
  }, [data.environments, selectedEnvironment]);

  const selectedStep = draft.steps.find((step) => step.step_id === selectedStepId) || draft.steps[0];
  const selectedDomain = draft.domain || String(draft.metadata?.domain || "");
  const visibleAgentOptions = useMemo(() => {
    const referencedAgentIds = new Set([
      draft.lead_agent_id,
      ...draft.steps.map((step) => step.agent_id),
    ]);
    return agentOptions.filter(
      (agent) => referencedAgentIds.has(agent.id) || agentMatchesWorkflowDomain(agent.record, selectedDomain),
    );
  }, [agentOptions, draft.lead_agent_id, draft.steps, selectedDomain]);
  const leadAgentOptions = visibleAgentOptions.filter(
    (agent) => agent.id === draft.lead_agent_id || agent.agentType === "lead_agent",
  );
  const stepAgentOptions = visibleAgentOptions.filter(
    (agent) => agent.id === selectedStep?.agent_id || agent.agentType !== "lead_agent",
  );
  const selectedAgentType =
    (selectedStep ? agentTypesById[selectedStep.agent_id] : undefined)
    || normalizeAgentType(selectedStep?.node_type)
    || "task_agent";
  const selectedAgent = data.agents.find((agent) => readText(agent, ["agent_id"]) === selectedStep?.agent_id);
  const selectedAgentAssignments = selectedStep
    ? data.agentAssignments[selectedStep.agent_id] || { guardrails: [], evaluators: [], knowledge: [] }
    : { guardrails: [], evaluators: [], knowledge: [] };
  const selectedAgentToolNames = getAgentTools(selectedAgent);
  const selectedAgentToolLabels = selectedAgentToolNames.map((toolName) => {
    const tool = data.tools.find((record) => readText(record, ["tool_name"]) === toolName);
    return joinParts([lookupDisplayName(data.tools, "tool_name", toolName) || toolName, certificationStatus(tool)]) || toolName;
  });
  const selectedStepToolLabel = selectedStep?.tool_name
    ? lookupDisplayName(data.tools, "tool_name", selectedStep.tool_name) || selectedStep.tool_name
    : "No tool request";
  const selectedStepToolIsGranted = !selectedStep?.tool_name || selectedAgentToolNames.includes(selectedStep.tool_name);
  const selectedAgentGuardrails = assignmentSummary(
    selectedAgentAssignments.guardrails,
    "policy_id",
    data.guardrailPolicies,
    ["mode", "environment"],
  );
  const selectedAgentEvaluators = assignmentSummary(
    selectedAgentAssignments.evaluators,
    "evaluator_id",
    data.evaluatorTemplates,
    ["trigger", "environment"],
  );
  const selectedAgentKnowledge = assignmentSummary(
    selectedAgentAssignments.knowledge,
    "kb_id",
    data.knowledgeBases,
    ["access_mode"],
  );
  const leadAgentLabel =
    agentOptions.find((agent) => agent.id === draft.lead_agent_id)?.label || draft.lead_agent_id || "Lead agent";
  const savedWorkflowRows = useMemo<SavedWorkflowRow[]>(() => {
    const rows = data.workflowDefinitions.map((definition) => {
      const definitionId = workflowDefinitionIdForRecord(definition);
      const linkedRuns = data.workflows
        .map((workflow) => {
          const workflowId = workflowRunId(workflow);
          const detail = data.workflowDetails.find((item) => readText(item, ["workflow_id"]) === workflowId);
          return {
            detail,
            workflow,
          };
        })
        .filter(({ detail, workflow }) => Boolean(definitionId && workflowRunDefinitionId(workflow, detail) === definitionId))
        .sort((left, right) => workflowRunTimestamp(right.workflow, right.detail) - workflowRunTimestamp(left.workflow, left.detail));
      const linkedRun = linkedRuns[0]?.workflow;
      const linkedRunDetail = linkedRuns[0]?.detail;

      return {
        definition,
        definitionId,
        domain: workflowDefinitionDomain(definition),
        edges: workflowDefinitionEdges(definition),
        environment: readText(definition, ["environment"]) || selectedEnvironment,
        isLatestVersion: false,
        linkedRun,
        linkedRunDetail,
        linkedRunId: workflowRunId(linkedRun),
        nodes: workflowDefinitionNodes(definition),
        status: workflowDefinitionStatus(definition),
        version: workflowVersionLabel(definition),
        versionNumber: workflowVersionNumber(definition),
        versionRootId: workflowVersionRootId(definition),
      };
    });

    const latestVersionByRoot = rows.reduce<Record<string, number>>((next, row) => {
      next[row.versionRootId] = Math.max(next[row.versionRootId] || 0, row.versionNumber);
      return next;
    }, {});

    return rows.map((row) => ({
      ...row,
      isLatestVersion: row.versionNumber === latestVersionByRoot[row.versionRootId],
    }));
  }, [data.workflowDefinitions, data.workflowDetails, data.workflows, selectedEnvironment]);
  const selectedSavedWorkflow = savedWorkflowRows.find((row) => row.definitionId === selectedSavedWorkflowId);

  useEffect(() => {
    if (selectedSavedWorkflowId && !selectedSavedWorkflow) {
      setSelectedSavedWorkflowId("");
    }
  }, [selectedSavedWorkflow, selectedSavedWorkflowId]);

  useEffect(() => {
    if (designerOpen) {
      setMessage("");
    }
  }, [designerOpen]);

  useEffect(() => {
    setNodePositions((current) => defaultNodePositions(draft, current));
    setConnections((current) => (connectionsTouched ? sanitizeConnections(draft, current) : defaultConnections(draft, current)));
    setLinkingNodeId((current) => (canvasNodeIds(draft).includes(current) ? current : ""));
  }, [connectionsTouched, draft]);

  function resetTemplate(clearMessage = true) {
    const nextDraft = toWorkflowDraft(selectedEnvironment);
    setEditingWorkflowSourceId("");
    setConnectionsTouched(false);
    setDraft(nextDraft);
    setNodePositions(defaultNodePositions(nextDraft));
    setConnections(defaultConnections(nextDraft));
    setLinkingNodeId("");
    setSelectedStepId(nextDraft.steps[0]?.step_id || "");
    setCanvasZoom(1);
    setRunAfterSaveQuery(defaultWorkflowRunQuery(nextDraft));
    if (clearMessage) {
      setMessage("");
    }
  }

  function updateDraft<K extends keyof WorkflowDraft>(key: K, value: WorkflowDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function updateStep<K extends keyof WorkflowStepDraft>(key: K, value: WorkflowStepDraft[K]) {
    const previousStepId = selectedStep?.step_id || "";

    setDraft((current) => ({
      ...current,
      steps: current.steps.map((step) => (step.step_id === previousStepId ? { ...step, [key]: value } : step)),
    }));

    if (key === "step_id" && typeof value === "string") {
      setNodePositions((current) => {
        if (!previousStepId || previousStepId === value || !current[previousStepId]) {
          return current;
        }

        const { [previousStepId]: previousPosition, ...remaining } = current;
        return {
          ...remaining,
          [value]: previousPosition,
        };
      });
      setConnections((current) =>
        current.map((connection) => {
          const from = connection.from === previousStepId ? value : connection.from;
          const to = connection.to === previousStepId ? value : connection.to;
          return { id: connectionId(from, to), from, to };
        }),
      );
      setSelectedStepId(value);
    }
  }

  function firstGrantedToolForAgent(agentId: string) {
    const agent = data.agents.find((item) => readText(item, ["agent_id"]) === agentId);
    return getAgentTools(agent)[0] || "";
  }

  function updateSelectedStepAgent(agentId: string) {
    const previousStepId = selectedStep?.step_id || "";
    const nextToolName = firstGrantedToolForAgent(agentId);

    setDraft((current) => ({
      ...current,
      steps: current.steps.map((step) =>
        step.step_id === previousStepId
          ? {
              ...step,
              agent_id: agentId,
              node_type: agentTypesById[agentId] || normalizeAgentType(step.node_type) || "task_agent",
              tool_name: nextToolName || undefined,
            }
          : step,
      ),
    }));
  }

  function addStep() {
    const nextIndex = draft.steps.length + 1;
    const agentId = safeOption(stepAgentOptions[0]?.id, "specialist-agent");
    const toolName = firstGrantedToolForAgent(agentId);
    const nextStep: WorkflowStepDraft = {
      step_id: `step_${nextIndex}`,
      label: `Workflow step ${nextIndex}`,
      role: `task_agent:step_${nextIndex}`,
      agent_id: agentId,
      node_type: agentTypesById[agentId] || "task_agent",
      activation_policy: "conditional",
      activation_stage: "routed",
      tool_name: toolName || undefined,
      task: "Complete the assigned workflow task.",
      tool_args: {},
      tool_args_json: "{}",
    };

    setDraft((current) => ({ ...current, steps: [...current.steps, nextStep] }));
    setNodePositions((current) => ({
      ...current,
      [nextStep.step_id]: {
        x: clamp(430 + (nextIndex - 1) * 220, 160, canvasWorldWidth(draft) - 160),
        y: nextIndex % 2 ? 250 : 430,
      },
    }));
    setConnections((current) => {
      const from = LEAD_NODE_ID;
      const nextConnection = { id: connectionId(from, nextStep.step_id), from, to: nextStep.step_id };
      return current.some((connection) => connection.id === nextConnection.id) ? current : [...current, nextConnection];
    });
    setConnectionsTouched(true);
    setSelectedStepId(nextStep.step_id);
  }

  function removeSelectedStep() {
    if (!selectedStep) {
      return;
    }

    setDraft((current) => {
      const nextSteps = current.steps.filter((step) => step.step_id !== selectedStep.step_id);
      setSelectedStepId(nextSteps[0]?.step_id || "");
      return { ...current, steps: nextSteps };
    });
    setNodePositions((current) => {
      const next = { ...current };
      delete next[selectedStep.step_id];
      return next;
    });
    setConnections((current) =>
      current.filter((connection) => connection.from !== selectedStep.step_id && connection.to !== selectedStep.step_id),
    );
    setConnectionsTouched(true);
  }

  async function uploadWorkflowJson(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    try {
      const parsed = JSON.parse(await file.text()) as WorkflowDraft;
      const steps = Array.isArray(parsed.steps) ? parsed.steps : [];
      const nextDraft: WorkflowDraft = {
        ...toWorkflowDraft(selectedEnvironment),
        ...parsed,
        workflow_definition_id: parsed.workflow_definition_id || uniqueWorkflowId("workflow"),
        steps: steps.map((step) => ({
          ...step,
          tool_args_json: JSON.stringify(step.tool_args || {}, null, 2),
        })),
      };

      setEditingWorkflowSourceId("");
      setDraft(nextDraft);
      setNodePositions(defaultNodePositions(nextDraft));
      setConnections(defaultConnections(nextDraft));
      setConnectionsTouched(false);
      setLinkingNodeId("");
      setSelectedStepId(nextDraft.steps[0]?.step_id || "");
      setCanvasZoom(1);
      setRunAfterSaveQuery(defaultWorkflowRunQuery(nextDraft));
      setMessage("Workflow JSON loaded.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to read workflow JSON.");
    }
  }

  function moveNode(nodeId: string, position: CanvasNodePosition) {
    setNodePositions((current) => ({
      ...current,
      [nodeId]: position,
    }));
  }

  function createConnection(from: string, to: string): LinkActionResult {
    if (!from || !to || from === to || to === LEAD_NODE_ID) {
      return "invalid";
    }

    const nextConnection = { id: connectionId(from, to), from, to };
    if (connections.some((connection) => connection.id === nextConnection.id)) {
      return "duplicate";
    }

    setConnections((current) => [...current, nextConnection]);
    setConnectionsTouched(true);
    return "created";
  }

  function linkNode(nodeId: string, side: PortSide): LinkActionResult {
    if (side === "out") {
      if (linkingNodeId === nodeId) {
        setLinkingNodeId("");
        return "cancelled";
      }

      setLinkingNodeId(nodeId);
      return "linking";
    }

    if (!linkingNodeId || linkingNodeId === nodeId) {
      setLinkingNodeId("");
      return "invalid";
    }

    const result = createConnection(linkingNodeId, nodeId);
    setLinkingNodeId("");
    return result;
  }

  function deleteConnection(connectionIdToDelete: string) {
    setConnections((current) => current.filter((connection) => connection.id !== connectionIdToDelete));
    setConnectionsTouched(true);
    setLinkingNodeId("");
  }

  function cancelLinking() {
    setLinkingNodeId("");
  }

  function editSavedWorkflow(row: SavedWorkflowRow) {
    const nextDraft = workflowDraftForNewVersion(row, savedWorkflowRows, selectedEnvironment);
    setEditingWorkflowSourceId(row.definitionId);
    setDraft(nextDraft);
    setNodePositions(defaultNodePositions(nextDraft));
    setConnections(defaultConnections(nextDraft));
    setConnectionsTouched(false);
    setLinkingNodeId("");
    setSelectedStepId(nextDraft.steps[0]?.step_id || "");
    setCanvasZoom(1);
    setRunAfterSaveQuery(defaultWorkflowRunQuery(nextDraft));
    setSelectedSavedWorkflowId("");
    setDesignerOpen(true);
    setMessage("");
  }

  function openSavedWorkflowTrace(row: SavedWorkflowRow) {
    if (row.linkedRunId) {
      onWorkflowTraceSelect(row.linkedRunId);
    }
  }

  async function submitWorkflowDefinition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const action = submitter?.value === "save_run" ? "save_run" : "save";
    setMessage("");

    const session = getSession();
    if (!session?.token) {
      setMessage("Session expired. Login again before saving workflow definitions.");
      return;
    }

    try {
      setSavingAction(action);
      const validationError = validateWorkflowDraft(draft);
      if (validationError) {
        setMessage(validationError);
        return;
      }
      if (savedWorkflowRows.some((row) => row.definitionId === draft.workflow_definition_id)) {
        setMessage("Workflow ID already exists. Edit an existing workflow from Details to save a new version.");
        return;
      }

      const leadAgentType = agentTypesById[draft.lead_agent_id];
      if (leadAgentType && leadAgentType !== "lead_agent") {
        setMessage(`Lead node requires a lead_agent, but ${draft.lead_agent_id} is registered as ${leadAgentType}.`);
        return;
      }

      const payload = cleanWorkflowDraft(draft, nodePositions, connections, agentTypesById);
      const savedDefinition = await createWorkflowDefinition(session.token, payload);

      if (action === "save_run") {
        try {
          const run = await runMultiAgentWorkflow(session.token, {
            query: runAfterSaveQuery.trim() || defaultWorkflowRunQuery(draft),
            workflow_definition_id: readText(savedDefinition, ["workflow_definition_id"]) || draft.workflow_definition_id,
          });
          const runId = workflowRunId(run) || readText(savedDefinition, ["workflow_definition_id"]) || draft.workflow_definition_id;
          setMessage("Workflow version saved and run started.");
          setDesignerOpen(false);
          resetTemplate(false);
          await onRefresh();
          onWorkflowTraceSelect(runId);
          return;
        } catch (error) {
          setMessage(
            `Workflow version saved, but the run failed: ${
              error instanceof Error ? error.message : "Unable to run workflow."
            }`,
          );
          await onRefresh();
          return;
        }
      }

      setMessage(editingWorkflowSourceId ? "Workflow version saved." : "Workflow definition saved.");
      setDesignerOpen(false);
      resetTemplate(false);
      await onRefresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save workflow definition.");
    } finally {
      setSavingAction("");
    }
  }

  return (
    <section className="grid gap-5" data-testid="workflow-builder-workspace">
      {message ? (
        <div
          className={`rounded-3xl border p-4 text-sm ${
            isErrorMessage(message)
              ? "border-red-400/45 bg-red-500/10 text-red-200"
              : "border-line bg-white/[0.04] text-textSecondary"
          }`}
        >
          {message}
        </div>
      ) : null}

      <section className="rounded-3xl border border-line bg-white/[0.035] p-5">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
          <div>
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">Created workflows</span>
            <h3 className="mt-2 text-2xl font-semibold tracking-[-0.02em] text-textPrimary">
              Saved workflow definitions
            </h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-textSecondary">
              These are the workflow designs already saved in the control plane. Open a definition for details or trace its latest agentic run.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              resetTemplate();
              setDesignerOpen(true);
              setMessage("");
            }}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-accent px-5 py-3 text-sm font-semibold text-ink transition hover:bg-accent/90 focus:outline-none focus:ring-2 focus:ring-accent/40"
          >
            <ListTree size={17} aria-hidden="true" />
            Workflow Designer
          </button>
        </div>

        <div className="mt-5 grid gap-3">
          {savedWorkflowRows.length ? (
            savedWorkflowRows.map((row) => {
              const linkedStatus = row.linkedRun
                ? readText(row.linkedRun, ["status", "decision"]) || readText(row.linkedRunDetail || {}, ["status", "decision"]) || "RECORDED"
                : "NOT RUN";
              return (
                <article
                  key={row.definitionId || String(row.definition.name || row.definition.workflow_definition_id || "workflow")}
                  className="rounded-2xl border border-line bg-ink/45 p-4"
                >
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] ${workflowStatusTone(row.status)}`}>
                          {row.status}
                        </span>
                        <span className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] ${workflowStatusTone(linkedStatus)}`}>
                          {linkedStatus}
                        </span>
                        <span className="rounded-full border border-line bg-white/[0.04] px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-textSecondary">
                          {row.version}
                        </span>
                        {row.isLatestVersion ? (
                          <span className="rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-accent">
                            latest
                          </span>
                        ) : null}
                      </div>
                      <h4 className="mt-3 truncate text-xl font-semibold text-textPrimary">
                        {readText(row.definition, ["name", "display_name", "workflow_definition_id"]) || "Workflow definition"}
                      </h4>
                      <p className="mt-2 text-sm leading-6 text-textSecondary">
                        {readText(row.definition, ["description"]) || "Saved workflow definition."}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-textSecondary">
                        <span className="rounded-full border border-line bg-white/[0.04] px-3 py-1">{row.definitionId || "workflow"}</span>
                        <span className="rounded-full border border-line bg-white/[0.04] px-3 py-1">root {row.versionRootId}</span>
                        <span className="rounded-full border border-line bg-white/[0.04] px-3 py-1">{row.environment}</span>
                        <span className="rounded-full border border-line bg-white/[0.04] px-3 py-1">{row.domain}</span>
                        <span className="rounded-full border border-line bg-white/[0.04] px-3 py-1">
                          {formatCount(row.nodes.length, "node")}
                        </span>
                        <span className="rounded-full border border-line bg-white/[0.04] px-3 py-1">
                          {formatCount(row.edges.length, "edge")}
                        </span>
                        {row.linkedRunId ? (
                          <span className="rounded-full border border-line bg-white/[0.04] px-3 py-1">
                            latest run {row.linkedRunId}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 lg:justify-end">
                      <button
                        type="button"
                        onClick={() => setSelectedSavedWorkflowId(row.definitionId)}
                        className="inline-flex min-h-10 items-center gap-2 rounded-full border border-line bg-white/[0.04] px-4 text-sm font-semibold text-textPrimary transition hover:border-accent/35 hover:bg-accent/10"
                      >
                        <FileJson size={16} aria-hidden="true" />
                        Details
                      </button>
                      <button
                        type="button"
                        disabled={!row.linkedRunId}
                        onClick={() => openSavedWorkflowTrace(row)}
                        className="inline-flex min-h-10 items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-4 text-sm font-semibold text-accent transition hover:border-accent/50 hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Route size={16} aria-hidden="true" />
                        Trace
                      </button>
                    </div>
                  </div>
                </article>
              );
            })
          ) : (
            <ComponentRow title="No saved workflows" detail="Create a workflow definition to save it into the control plane." />
          )}
        </div>
      </section>

      {selectedSavedWorkflow ? (
        <SavedWorkflowDetailModal
          onClose={() => setSelectedSavedWorkflowId("")}
          onEdit={() => editSavedWorkflow(selectedSavedWorkflow)}
          onRefresh={onRefresh}
          onRunStarted={onWorkflowTraceSelect}
          onTrace={() => openSavedWorkflowTrace(selectedSavedWorkflow)}
          row={selectedSavedWorkflow}
        />
      ) : null}

      {designerOpen ? (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-black/60 p-4 backdrop-blur-md" role="dialog" aria-modal="true">
          <form
            className="relative grid h-[88vh] w-[94vw] max-h-[96vh] max-w-[96vw] grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-3xl border border-line bg-panel text-textPrimary shadow-[0_30px_120px_rgba(0,0,0,0.45)] [resize:both]"
            onSubmit={submitWorkflowDefinition}
            style={{
              minHeight: "min(650px, calc(100vh - 2rem))",
              minWidth: "min(760px, calc(100vw - 2rem))",
            }}
          >
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line p-5">
              <div>
                <span className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">Workflow designer</span>
                <h3 className="mt-2 text-3xl font-semibold tracking-[-0.03em]">
                  {editingWorkflowSourceId ? "Edit workflow version" : "Agent workflow designer"}
                </h3>
                {editingWorkflowSourceId ? (
                  <p className="mt-2 text-sm text-textSecondary">
                    {editingWorkflowSourceId} -&gt; {draft.workflow_definition_id}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => resetTemplate()} className="designer-action">
                  Use Template
                </button>
                <button type="button" onClick={addStep} className="designer-action">
                  <Plus size={16} aria-hidden="true" />
                  Add Step
                </button>
                <label className="designer-action cursor-pointer">
                  <UploadCloud size={16} aria-hidden="true" />
                  Upload JSON
                  <input className="sr-only" type="file" accept="application/json,.json" onChange={uploadWorkflowJson} />
                </label>
                <button
                  type="submit"
                  name="workflow-action"
                  value="save"
                  disabled={Boolean(savingAction)}
                  className="rounded-full bg-accent px-5 py-2 text-sm font-semibold text-ink transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {savingAction === "save" ? "Saving" : "Save"}
                </button>
                <button
                  type="submit"
                  name="workflow-action"
                  value="save_run"
                  disabled={Boolean(savingAction)}
                  className="rounded-full border border-accent/35 bg-accent/10 px-5 py-2 text-sm font-semibold text-accent transition hover:border-accent/55 hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {savingAction === "save_run" ? "Saving & running" : "Save & Run"}
                </button>
                <button
                  type="button"
                  onClick={() => setDesignerOpen(false)}
                  className="grid h-10 w-10 place-items-center rounded-full border border-line bg-white/[0.04] transition hover:border-accent/40 hover:bg-accent/10"
                  aria-label="Close workflow designer"
                >
                  <X size={18} aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className="min-h-0 overflow-auto p-5">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[0.34fr_0.34fr_0.24fr_0.24fr_0.34fr]">
                <BuilderField label="ID">
                  <input
                    value={draft.workflow_definition_id}
                    onChange={(event) => updateDraft("workflow_definition_id", event.target.value)}
                    className="field-input"
                  />
                </BuilderField>
                <BuilderField label="Name">
                  <input value={draft.name} onChange={(event) => updateDraft("name", event.target.value)} className="field-input" />
                </BuilderField>
                <BuilderField label="Environment">
                  <select value={draft.environment} onChange={(event) => updateDraft("environment", event.target.value)} className="field-input">
                    {environmentOptions.map((environment) => (
                      <option key={environment} value={environment}>
                        {environment}
                      </option>
                    ))}
                  </select>
                </BuilderField>
                <BuilderField label="Domain">
                  <input value={draft.domain || ""} onChange={(event) => updateDraft("domain", event.target.value)} className="field-input" />
                </BuilderField>
                <BuilderField label="Lead Agent">
                  <select value={draft.lead_agent_id} onChange={(event) => updateDraft("lead_agent_id", event.target.value)} className="field-input">
                    <option value={draft.lead_agent_id}>{leadAgentLabel}</option>
                    {leadAgentOptions
                      .filter((agent) => agent.id && agent.id !== draft.lead_agent_id)
                      .map((agent) => (
                        <option key={agent.id} value={agent.id}>
                          {agent.label}
                        </option>
                      ))}
                  </select>
                </BuilderField>
              </div>

              <div className="mt-3">
                <BuilderField label="Save & Run Prompt">
                  <input
                    value={runAfterSaveQuery}
                    onChange={(event) => setRunAfterSaveQuery(event.target.value)}
                    className="field-input"
                  />
                </BuilderField>
              </div>

              <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_344px]">
                <WorkflowCanvas
                  agentTypesById={agentTypesById}
                  agentCertificationById={agentCertificationById}
                  connections={connections}
                  draft={draft}
                  linkingNodeId={linkingNodeId}
                  nodePositions={nodePositions}
                  onConnectionCreate={createConnection}
                  onConnectionDelete={deleteConnection}
                  onLinkCancel={cancelLinking}
                  onNodeMove={moveNode}
                  onPortClick={linkNode}
                  onStepSelect={setSelectedStepId}
                  onZoomChange={setCanvasZoom}
                  selectedStepId={selectedStepId}
                  zoom={canvasZoom}
                />

                <aside className="rounded-3xl border border-line bg-white/[0.035] p-4">
                  <h4 className="text-lg font-semibold">Step Detail</h4>
                  {selectedStep ? (
                    <div className="mt-4 grid gap-3">
                      <BuilderField label="Step ID">
                        <input value={selectedStep.step_id} onChange={(event) => updateStep("step_id", event.target.value)} className="field-input" />
                      </BuilderField>
                      <BuilderField label="Label">
                        <input value={selectedStep.label} onChange={(event) => updateStep("label", event.target.value)} className="field-input" />
                      </BuilderField>
                      <BuilderField label="Agent">
                        <select value={selectedStep.agent_id} onChange={(event) => updateSelectedStepAgent(event.target.value)} className="field-input">
                          <option value={selectedStep.agent_id}>{selectedStep.agent_id}</option>
                          {stepAgentOptions
                            .filter((agent) => agent.id && agent.id !== selectedStep.agent_id)
                            .map((agent) => (
                              <option key={agent.id} value={agent.id}>
                                {agent.label}
                              </option>
                            ))}
                        </select>
                      </BuilderField>
                      <div className="grid gap-3 sm:grid-cols-3">
                        <BuilderField label="Agent Type">
                          <div className="field-input flex items-center">
                            {selectedAgentType}
                          </div>
                        </BuilderField>
                        <BuilderField label="Activation">
                          <select value={selectedStep.activation_policy || "conditional"} onChange={(event) => updateStep("activation_policy", event.target.value)} className="field-input">
                            {ACTIVATION_POLICIES.map((policy) => (
                              <option key={policy} value={policy}>
                                {policy}
                              </option>
                            ))}
                          </select>
                        </BuilderField>
                        <BuilderField label="Stage">
                          <select value={selectedStep.activation_stage || "routed"} onChange={(event) => updateStep("activation_stage", event.target.value)} className="field-input">
                            {ACTIVATION_STAGES.map((stage) => (
                              <option key={stage} value={stage}>
                                {stage}
                              </option>
                            ))}
                          </select>
                        </BuilderField>
                      </div>
                      <BuilderField label="Tool request">
                        <div className="field-input flex items-center">
                          {selectedStepToolLabel}
                        </div>
                      </BuilderField>
                      {!selectedStepToolIsGranted ? (
                        <div className="rounded-2xl border border-amber-300/45 bg-amber-300/10 p-3 text-xs leading-5 text-textSecondary">
                          This workflow step references a tool that is not currently granted to the selected agent.
                        </div>
                      ) : null}
                      <BuilderField label="Task">
                        <textarea value={selectedStep.task || ""} onChange={(event) => updateStep("task", event.target.value)} className="field-input min-h-24 resize-y" />
                      </BuilderField>
                      <BuilderField label="Tool Args JSON">
                        <textarea
                          value={selectedStep.tool_args_json ?? JSON.stringify(selectedStep.tool_args || {}, null, 2)}
                          onChange={(event) => updateStep("tool_args_json", event.target.value)}
                          className="field-input min-h-24 resize-y font-mono text-xs"
                          spellCheck={false}
                        />
                      </BuilderField>
                      <AgentControlSnapshot
                        certificationStatus={certificationStatus(selectedAgent)}
                        evaluators={selectedAgentEvaluators}
                        guardrails={selectedAgentGuardrails}
                        knowledge={selectedAgentKnowledge}
                        tools={selectedAgentToolLabels}
                      />
                      <button
                        type="button"
                        onClick={removeSelectedStep}
                        className="rounded-2xl border border-rose-300/35 bg-rose-300/10 px-4 py-3 text-sm font-semibold text-textPrimary transition hover:border-rose-300/60 hover:bg-rose-300/15"
                      >
                        Remove Step
                      </button>
                    </div>
                  ) : (
                    <ComponentRow title="No step selected" detail="Add a step to edit workflow behavior." />
                  )}
                </aside>
              </div>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}

function BuilderField({ children, label }: { children: ReactNode; label: string }) {
  return (
    <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-textSecondary">
      {label}
      {children}
    </label>
  );
}

function SavedWorkflowDetailModal({
  onClose,
  onEdit,
  onRefresh,
  onRunStarted,
  onTrace,
  row,
}: {
  onClose: () => void;
  onEdit: () => void;
  onRefresh: () => void;
  onRunStarted: (runId: string) => void;
  onTrace: () => void;
  row: SavedWorkflowRow;
}) {
  const linkedStatus = row.linkedRun
    ? readText(row.linkedRun, ["status", "decision"]) || readText(row.linkedRunDetail || {}, ["status", "decision"]) || "RECORDED"
    : "NOT RUN";
  const metadata = objectValue(row.definition, "metadata");
  const createdAt = formatTimestamp(readText(row.definition, ["created_at"]));
  const updatedAt = formatTimestamp(readText(row.definition, ["updated_at"]));

  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-black/65 p-4 backdrop-blur-md" role="dialog" aria-modal="true">
      <section
        className="grid max-h-[90vh] grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-3xl border border-line bg-panel text-textPrimary shadow-[0_30px_120px_rgba(0,0,0,0.5)]"
        style={{
          maxWidth: "min(1180px, calc(100vw - 2rem))",
          minWidth: "min(680px, calc(100vw - 2rem))",
          width: "fit-content",
        }}
      >
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line p-5">
          <div className="min-w-0">
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">Saved workflow</span>
            <h3 className="mt-2 truncate text-3xl font-semibold tracking-[-0.03em]">
              {readText(row.definition, ["name", "display_name", "workflow_definition_id"]) || "Workflow definition"}
            </h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-textSecondary">
              {readText(row.definition, ["description"]) || "Workflow definition detail."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onEdit}
              className="inline-flex min-h-10 items-center gap-2 rounded-full border border-line bg-white/[0.04] px-4 text-sm font-semibold text-textPrimary transition hover:border-accent/35 hover:bg-accent/10"
            >
              <PencilLine size={16} aria-hidden="true" />
              Edit Graph
            </button>
            <button
              type="button"
              disabled={!row.linkedRunId}
              onClick={onTrace}
              className="inline-flex min-h-10 items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-4 text-sm font-semibold text-accent transition hover:border-accent/50 hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Route size={16} aria-hidden="true" />
              Trace
            </button>
            <button
              type="button"
              onClick={onClose}
              className="grid h-10 w-10 place-items-center rounded-full border border-line bg-white/[0.04] transition hover:border-accent/40 hover:bg-accent/10"
              aria-label="Close workflow details"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="min-h-0 overflow-auto p-5">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <WorkflowDefinitionDetailField label="Workflow ID" value={row.definitionId || "No ID"} />
            <WorkflowDefinitionDetailField label="Version" value={`${row.version}${row.isLatestVersion ? " latest" : ""}`} />
            <WorkflowDefinitionDetailField label="Root workflow" value={row.versionRootId || row.definitionId || "No root"} />
            <WorkflowDefinitionDetailField label="Previous version" value={readText(metadata, ["previous_workflow_definition_id"]) || "Initial version"} />
            <WorkflowDefinitionDetailField label="Environment" value={row.environment} />
            <WorkflowDefinitionDetailField label="Domain" value={row.domain} />
            <WorkflowDefinitionDetailField label="Lead agent" value={readText(row.definition, ["lead_agent_id"]) || "No lead agent"} />
            <WorkflowDefinitionDetailField label="Definition status" value={row.status} tone={workflowStatusTone(row.status)} />
            <WorkflowDefinitionDetailField label="Latest run" value={row.linkedRunId || "No linked runtime run"} />
            <WorkflowDefinitionDetailField label="Run status" value={linkedStatus} tone={workflowStatusTone(linkedStatus)} />
            <WorkflowDefinitionDetailField label="Updated" value={updatedAt || createdAt || "No timestamp"} />
          </div>

          <section className="mt-5 rounded-2xl border border-line bg-white/[0.035] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-textSecondary">
                <GitBranch size={15} className="text-accent" aria-hidden="true" />
                Workflow graph
              </div>
              <button
                type="button"
                onClick={onEdit}
                className="inline-flex items-center gap-2 rounded-full border border-line bg-ink/70 px-3 py-1 text-xs font-semibold text-textPrimary transition hover:border-accent/35 hover:bg-accent/10"
              >
                <PencilLine size={13} aria-hidden="true" />
                Edit Graph
              </button>
            </div>
            <WorkflowDefinitionGraphPreview row={row} />
          </section>

          <WorkflowDeploymentPanel
            graphHash={readText(row.definition, ["graph_version_hash"]) || ""}
            onRefresh={onRefresh}
            onRunStarted={onRunStarted}
            workflowDefinitionId={row.definitionId}
            workflowName={readText(row.definition, ["name", "display_name"]) || row.definitionId}
          />

          <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,0.45fr)_minmax(0,0.55fr)]">
            <section className="rounded-2xl border border-line bg-white/[0.035] p-4">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-textSecondary">
                <ListTree size={15} className="text-accent" aria-hidden="true" />
                Nodes
              </div>
              <div className="mt-4 grid gap-3">
                {row.nodes.length ? (
                  row.nodes.map((node, index) => {
                    const nodeId = readText(node, ["node_id", "step_id"]) || `node-${index + 1}`;
                    return (
                      <div key={nodeId} className="rounded-2xl border border-line bg-ink/60 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-semibold text-textPrimary">{nodeId}</p>
                          <span className="rounded-full border border-line bg-white/[0.04] px-2.5 py-1 text-xs text-textSecondary">
                            {readText(node, ["node_type"]) || "task_agent"}
                          </span>
                        </div>
                        <p className="mt-2 text-sm text-textSecondary">
                          {joinParts([readText(node, ["label"]), readText(node, ["agent_id"])]) || "No agent bound"}
                        </p>
                      </div>
                    );
                  })
                ) : (
                  <ComponentRow title="No graph nodes" detail="This definition does not expose nodes or steps." />
                )}
              </div>
            </section>

            <section className="grid gap-4">
              <div className="rounded-2xl border border-line bg-white/[0.035] p-4">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-textSecondary">
                  <Route size={15} className="text-accent" aria-hidden="true" />
                  Edges
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {row.edges.length ? (
                    row.edges.map((edge, index) => {
                      const from = readText(edge, ["from_node_id", "from"]) || "source";
                      const to = readText(edge, ["to_node_id", "to"]) || "target";
                      return (
                        <span key={`${from}-${to}-${index}`} className="rounded-full border border-line bg-ink/70 px-3 py-1 text-xs text-textSecondary">
                          {from} -&gt; {to}
                        </span>
                      );
                    })
                  ) : (
                    <span className="text-sm text-textSecondary">No explicit edges recorded.</span>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-line bg-white/[0.035] p-4">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-textSecondary">
                  <FileJson size={15} className="text-accent" aria-hidden="true" />
                  Definition metadata
                </div>
                <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-ink/70 p-3 font-mono text-xs leading-5 text-textPrimary">
                  {compactJson({
                    metadata,
                    policy_bindings: objectValue(row.definition, "policy_bindings"),
                    review_rules: row.definition.review_rules,
                    trigger_type: readText(row.definition, ["trigger_type"]),
                  })}
                </pre>
              </div>
            </section>
          </div>
        </div>
      </section>
    </div>
  );
}

function WorkflowDefinitionGraphPreview({ row }: { row: SavedWorkflowRow }) {
  const nodes = row.nodes.length ? row.nodes : workflowDefinitionNodes(row.definition);
  const edges = row.edges.length
    ? row.edges
    : nodes
        .filter((node) => !isLeadWorkflowNode(node))
        .map((node) => ({
          from_node_id: LEAD_NODE_ID,
          to_node_id: readText(node, ["node_id", "step_id"]) || "",
        }));

  if (!nodes.length) {
    return (
      <div className="mt-4">
        <ComponentRow title="No graph nodes" detail="This definition does not expose nodes or steps." />
      </div>
    );
  }

  const orderedNodes = [
    ...nodes.filter(isLeadWorkflowNode),
    ...nodes.filter((node) => !isLeadWorkflowNode(node)),
  ];
  const graphWidth = Math.max(780, 120 + orderedNodes.length * 220);
  const graphHeight = 260;
  const positions = new Map(
    orderedNodes.map((node, index) => {
      const nodeId = readText(node, ["node_id", "step_id"]) || `node-${index + 1}`;
      return [
        nodeId,
        {
          x: 95 + index * 220,
          y: index === 0 ? 112 : index % 2 === 0 ? 56 : 168,
        },
      ];
    }),
  );

  return (
    <div className="mt-4 overflow-x-auto rounded-2xl border border-line bg-ink/70 p-4 [background-image:linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] [background-size:28px_28px]">
      <div className="relative" style={{ height: graphHeight, width: graphWidth }}>
        <svg className="absolute inset-0 h-full w-full overflow-visible" viewBox={`0 0 ${graphWidth} ${graphHeight}`}>
          {edges.map((edge, index) => {
            const from = readText(edge, ["from_node_id", "from"]) || "";
            const to = readText(edge, ["to_node_id", "to"]) || "";
            const start = positions.get(from);
            const end = positions.get(to);
            if (!start || !end) {
              return null;
            }
            const startX = start.x + 84;
            const endX = end.x - 84;
            const curve = Math.max(80, Math.abs(endX - startX) * 0.35);
            return (
              <path
                key={`${from}-${to}-${index}`}
                d={`M ${startX} ${start.y} C ${startX + curve} ${start.y}, ${endX - curve} ${end.y}, ${endX} ${end.y}`}
                fill="none"
                stroke="rgba(100, 116, 139, 0.9)"
                strokeLinecap="round"
                strokeWidth="2.4"
              />
            );
          })}
        </svg>
        {orderedNodes.map((node, index) => {
          const nodeId = readText(node, ["node_id", "step_id"]) || `node-${index + 1}`;
          const position = positions.get(nodeId) || { x: 0, y: 0 };
          const label = readText(node, ["label", "name", "task"]) || nodeId;
          const nodeType = readText(node, ["node_type"]) || "task_agent";
          const isLead = isLeadWorkflowNode(node);
          return (
            <div
              key={nodeId}
              className={`absolute grid h-24 w-44 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-2xl border bg-panel/95 px-4 py-3 text-center shadow-xl ${
                isLead ? "border-accent/65 shadow-[inset_5px_0_0_rgb(var(--color-accent))]" : "border-line"
              }`}
              style={{ left: position.x, top: position.y }}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-textPrimary">{label}</p>
                <p className="mt-1 truncate text-xs text-textSecondary">{readText(node, ["agent_id"]) || nodeId}</p>
                <p className="mt-1 truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-accent">{nodeType}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WorkflowDefinitionDetailField({
  label,
  tone,
  value,
}: {
  label: string;
  tone?: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-line bg-white/[0.035] p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-textSecondary">{label}</p>
      <p className={`mt-2 break-words rounded-full border px-3 py-1 text-sm font-semibold ${tone || "border-transparent text-textPrimary"}`}>
        {value}
      </p>
    </div>
  );
}

function AgentControlSnapshot({
  certificationStatus,
  evaluators,
  guardrails,
  knowledge,
  tools,
}: {
  certificationStatus: string;
  evaluators: string[];
  guardrails: string[];
  knowledge: string[];
  tools: string[];
}) {
  return (
    <section className="rounded-3xl border border-line bg-white/[0.035] p-4">
      <div className="flex items-center justify-between gap-3">
        <h5 className="text-sm font-semibold text-textPrimary">Registered agent controls</h5>
        <span className="rounded-full border border-line bg-ink/70 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-textSecondary">
          {certificationStatus}
        </span>
      </div>
      <div className="mt-3 grid gap-3">
        <SnapshotList emptyText="No tool grants" items={tools} label="Tools" />
        <SnapshotList emptyText="No guardrail policy assigned" items={guardrails} label="Guardrails" />
        <SnapshotList emptyText="No evaluator assignments" items={evaluators} label="Evaluators" />
        <SnapshotList emptyText="No knowledge bases attached" items={knowledge} label="Knowledge Bases" />
      </div>
    </section>
  );
}

function SnapshotList({
  emptyText,
  items,
  label,
}: {
  emptyText: string;
  items: string[];
  label: string;
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-textSecondary">{label}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {items.length ? (
          items.map((item) => (
            <span key={item} className="rounded-full border border-line bg-ink/70 px-3 py-1 text-xs font-semibold text-textSecondary">
              {item}
            </span>
          ))
        ) : (
          <span className="text-xs text-textSecondary">{emptyText}</span>
        )}
      </div>
    </div>
  );
}

function WorkflowCanvas({
  agentCertificationById,
  agentTypesById,
  connections,
  draft,
  linkingNodeId,
  nodePositions,
  onConnectionCreate,
  onConnectionDelete,
  onLinkCancel,
  onNodeMove,
  onPortClick,
  onStepSelect,
  onZoomChange,
  selectedStepId,
  zoom,
}: {
  agentCertificationById: Record<string, string>;
  agentTypesById: Record<string, string>;
  connections: WorkflowConnection[];
  draft: WorkflowDraft;
  linkingNodeId: string;
  nodePositions: Record<string, CanvasNodePosition>;
  onConnectionCreate: (from: string, to: string) => LinkActionResult;
  onConnectionDelete: (connectionId: string) => void;
  onLinkCancel: () => void;
  onNodeMove: (nodeId: string, position: CanvasNodePosition) => void;
  onPortClick: (nodeId: string, side: PortSide) => LinkActionResult;
  onStepSelect: (stepId: string) => void;
  onZoomChange: (zoom: number) => void;
  selectedStepId: string;
  zoom: number;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const suppressNextPortClickRef = useRef(false);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [dragging, setDragging] = useState<{
    nodeId: string;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const [hoveredConnectionId, setHoveredConnectionId] = useState("");
  const [selectedConnectionId, setSelectedConnectionId] = useState("");
  const [linkDrag, setLinkDrag] = useState<{
    fromNodeId: string;
    pointer: CanvasNodePosition;
  } | null>(null);
  const [canvasNotice, setCanvasNotice] = useState("");
  const baseWorldWidth = canvasWorldWidth(draft);
  const visibleWorldWidth = viewportWidth ? Math.ceil(viewportWidth / zoom) : 0;
  const positionedWorldWidth = Math.max(
    0,
    ...Object.values(nodePositions).map((position) => position.x + NODE_WIDTH / 2 + 240),
  );
  const worldWidth = Math.max(baseWorldWidth, visibleWorldWidth, positionedWorldWidth);
  const nodes = [
    {
      id: LEAD_NODE_ID,
      label: "Lead",
      meta: draft.lead_agent_id || "lead-agent",
      nodeType: "lead_agent",
      certificationStatus: agentCertificationById[draft.lead_agent_id] || "DRAFT",
      isLead: true,
    },
    ...draft.steps.map((step) => ({
      id: step.step_id,
      label: step.label || step.step_id,
      meta: step.agent_id,
      nodeType: agentTypesById[step.agent_id] || normalizeAgentType(step.node_type) || "task_agent",
      certificationStatus: agentCertificationById[step.agent_id] || "DRAFT",
      isLead: false,
    })),
  ];
  const nodeIds = new Set(nodes.map((node) => node.id));
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const connectionIds = useMemo(() => new Set(connections.map((connection) => connection.id)), [connections]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return undefined;
    }

    function measureViewport() {
      setViewportWidth(viewport?.clientWidth || 0);
    }

    measureViewport();
    const observer = new ResizeObserver(measureViewport);
    observer.observe(viewport);
    window.addEventListener("resize", measureViewport);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measureViewport);
    };
  }, []);

  useEffect(() => {
    setHoveredConnectionId((current) => (current && connectionIds.has(current) ? current : ""));
    setSelectedConnectionId((current) => (current && connectionIds.has(current) ? current : ""));
  }, [connectionIds]);

  useEffect(() => {
    if (!canvasNotice) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => setCanvasNotice(""), 2200);
    return () => window.clearTimeout(timeoutId);
  }, [canvasNotice]);

  function nodePosition(nodeId: string) {
    return nodePositions[nodeId] || defaultNodePositions(draft)[nodeId] || { x: 240, y: 240 };
  }

  function portPoint(nodeId: string, side: PortSide) {
    const position = nodePosition(nodeId);
    return {
      x: position.x + (side === "out" ? NODE_WIDTH / 2 : -NODE_WIDTH / 2),
      y: position.y,
    };
  }

  function pointerWorldPosition(event: PointerEvent<HTMLElement>) {
    const viewport = viewportRef.current;
    if (!viewport) {
      return { x: 0, y: 0 };
    }

    const rect = viewport.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left + viewport.scrollLeft) / zoom,
      y: (event.clientY - rect.top + viewport.scrollTop) / zoom,
    };
  }

  function startDrag(event: PointerEvent<HTMLElement>, nodeId: string) {
    const pointer = pointerWorldPosition(event);
    const position = nodePosition(nodeId);
    setSelectedConnectionId("");
    setDragging({
      nodeId,
      offsetX: pointer.x - position.x,
      offsetY: pointer.y - position.y,
    });
    event.currentTarget.setPointerCapture(event.pointerId);

    if (nodeId !== LEAD_NODE_ID) {
      onStepSelect(nodeId);
    }
  }

  function dragNode(event: PointerEvent<HTMLDivElement>) {
    if (linkDrag) {
      setLinkDrag((current) => (current ? { ...current, pointer: pointerWorldPosition(event) } : current));
      return;
    }

    if (!dragging) {
      return;
    }

    const pointer = pointerWorldPosition(event);
    onNodeMove(dragging.nodeId, {
      x: clamp(pointer.x - dragging.offsetX, NODE_WIDTH / 2 + 24, worldWidth - NODE_WIDTH / 2 - 24),
      y: clamp(pointer.y - dragging.offsetY, NODE_HEIGHT / 2 + 24, CANVAS_HEIGHT - NODE_HEIGHT / 2 - 24),
    });
  }

  function changeZoom(nextZoom: number) {
    onZoomChange(Number(clamp(nextZoom, 0.6, 1.6).toFixed(2)));
  }

  function linkNotice(result: LinkActionResult, fromNodeId: string, toNodeId?: string) {
    const fromLabel = nodeMap.get(fromNodeId)?.label || fromNodeId;
    const toLabel = toNodeId ? nodeMap.get(toNodeId)?.label || toNodeId : "";

    if (result === "created") {
      return `Linked ${fromLabel} -> ${toLabel}`;
    }

    if (result === "duplicate") {
      return "Duplicate link ignored";
    }

    if (result === "invalid") {
      return fromNodeId === toNodeId ? "Cannot link a node to itself" : "Select an output first";
    }

    if (result === "cancelled") {
      return "Link cancelled";
    }

    return `Linking from ${fromLabel}`;
  }

  function handlePortClick(nodeId: string, side: PortSide) {
    if (suppressNextPortClickRef.current) {
      suppressNextPortClickRef.current = false;
      return;
    }

    setSelectedConnectionId("");
    setHoveredConnectionId("");
    const result = onPortClick(nodeId, side);
    setCanvasNotice(linkNotice(result, side === "out" ? nodeId : linkingNodeId, nodeId));
    viewportRef.current?.focus();
  }

  function startLinkDrag(event: PointerEvent<HTMLElement>, nodeId: string) {
    onLinkCancel();
    setDragging(null);
    setSelectedConnectionId("");
    setHoveredConnectionId("");
    setLinkDrag({ fromNodeId: nodeId, pointer: pointerWorldPosition(event) });
    setCanvasNotice(linkNotice("linking", nodeId));
    viewportRef.current?.focus();
  }

  function finishLinkDrag(nodeId: string) {
    if (!linkDrag) {
      return;
    }

    const result = onConnectionCreate(linkDrag.fromNodeId, nodeId);
    suppressNextPortClickRef.current = true;
    window.setTimeout(() => {
      suppressNextPortClickRef.current = false;
    }, 100);
    setCanvasNotice(linkNotice(result, linkDrag.fromNodeId, nodeId));
    setLinkDrag(null);
  }

  function finishCanvasPointer() {
    if (linkDrag) {
      setCanvasNotice("Link cancelled");
    }

    setDragging(null);
    setLinkDrag(null);
  }

  function selectConnection(connectionIdToSelect: string) {
    setSelectedConnectionId(connectionIdToSelect);
    onLinkCancel();
    viewportRef.current?.focus();
  }

  function removeConnection(connectionIdToDelete: string) {
    onConnectionDelete(connectionIdToDelete);
    setHoveredConnectionId("");
    setSelectedConnectionId("");
    setDragging(null);
    setLinkDrag(null);
    setCanvasNotice("Link deleted");
    viewportRef.current?.focus();
  }

  function handleCanvasKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if ((event.key === "Delete" || event.key === "Backspace") && selectedConnectionId) {
      event.preventDefault();
      removeConnection(selectedConnectionId);
      return;
    }

    if (event.key === "Escape") {
      setDragging(null);
      setLinkDrag(null);
      setHoveredConnectionId("");
      setSelectedConnectionId("");
      onLinkCancel();
      setCanvasNotice("Link cancelled");
    }
  }

  const renderedConnections = connections
    .filter((connection) => nodeIds.has(connection.from) && nodeIds.has(connection.to))
    .map((connection) => {
      const start = portPoint(connection.from, "out");
      const end = portPoint(connection.to, "in");
      const curve = Math.max(110, Math.abs(end.x - start.x) * 0.4);
      const controlStart = { x: start.x + curve, y: start.y };
      const controlEnd = { x: end.x - curve, y: end.y };
      const midpoint = cubicPoint(start, controlStart, controlEnd, end, 0.5);

      return {
        ...connection,
        fromLabel: nodeMap.get(connection.from)?.label || connection.from,
        isActive: hoveredConnectionId === connection.id || selectedConnectionId === connection.id,
        midpoint,
        path: `M ${start.x} ${start.y} C ${controlStart.x} ${controlStart.y}, ${controlEnd.x} ${controlEnd.y}, ${end.x} ${end.y}`,
        toLabel: nodeMap.get(connection.to)?.label || connection.to,
      };
    });
  const activeLinkSourceId = linkDrag?.fromNodeId || linkingNodeId;
  const dragConnection = linkDrag
    ? (() => {
        const start = portPoint(linkDrag.fromNodeId, "out");
        const end = linkDrag.pointer;
        const curve = Math.max(110, Math.abs(end.x - start.x) * 0.4);
        return {
          path: `M ${start.x} ${start.y} C ${start.x + curve} ${start.y}, ${end.x - curve} ${end.y}, ${end.x} ${end.y}`,
        };
      })()
    : null;
  const selectedConnection = renderedConnections.find((connection) => connection.id === selectedConnectionId);
  const selectedNode = selectedStepId ? nodeMap.get(selectedStepId) : undefined;
  const canvasStatus =
    canvasNotice ||
    (selectedConnection
      ? `${selectedConnection.fromLabel} -> ${selectedConnection.toLabel}`
      : activeLinkSourceId
        ? `Linking from ${nodeMap.get(activeLinkSourceId)?.label || activeLinkSourceId}`
        : selectedNode
          ? `Selected: ${selectedNode.label}`
          : "Select a node");

  return (
    <div
      ref={viewportRef}
      tabIndex={0}
      className="relative min-h-[560px] overflow-auto rounded-3xl border border-line bg-ink/70 outline-none focus:ring-2 focus:ring-accent/25 [background-image:linear-gradient(rgba(255,255,255,0.045)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.045)_1px,transparent_1px)] [background-size:28px_28px]"
      onKeyDown={handleCanvasKeyDown}
      onPointerCancel={finishCanvasPointer}
      onPointerMove={dragNode}
      onPointerUp={finishCanvasPointer}
    >
      <div className="sticky left-3 top-3 z-30 inline-flex rounded-2xl border border-line bg-panel/90 p-1 shadow-xl backdrop-blur">
        <button
          type="button"
          onClick={() => changeZoom(zoom - 0.1)}
          className="grid h-9 w-9 place-items-center rounded-xl text-textSecondary transition hover:bg-white/[0.06] hover:text-textPrimary"
          aria-label="Zoom out workflow canvas"
          title="Zoom out"
        >
          <ZoomOut size={16} aria-hidden="true" />
        </button>
        <span className="grid h-9 min-w-14 place-items-center px-2 text-xs font-semibold text-textSecondary">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          onClick={() => changeZoom(zoom + 0.1)}
          className="grid h-9 w-9 place-items-center rounded-xl text-textSecondary transition hover:bg-white/[0.06] hover:text-textPrimary"
          aria-label="Zoom in workflow canvas"
          title="Zoom in"
        >
          <ZoomIn size={16} aria-hidden="true" />
        </button>
      </div>

      <div className="relative" style={{ height: CANVAS_HEIGHT * zoom, width: worldWidth * zoom }}>
        <div
          className="absolute left-0 top-0"
          style={{
            height: CANVAS_HEIGHT,
            transform: `scale(${zoom})`,
            transformOrigin: "left top",
            width: worldWidth,
          }}
        >
          <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" viewBox={`0 0 ${worldWidth} ${CANVAS_HEIGHT}`}>
            {renderedConnections.map((connection) => (
              <g
                key={connection.id}
                role="button"
                tabIndex={0}
                className="pointer-events-auto outline-none"
                onBlur={() => setHoveredConnectionId("")}
                onClick={(event) => {
                  event.stopPropagation();
                  selectConnection(connection.id);
                }}
                onFocus={() => setHoveredConnectionId(connection.id)}
                onKeyDown={(event) => {
                  if (event.key === "Delete" || event.key === "Backspace") {
                    event.preventDefault();
                    removeConnection(connection.id);
                  }
                }}
                onMouseEnter={() => setHoveredConnectionId(connection.id)}
                onMouseLeave={() => setHoveredConnectionId("")}
                aria-label={`Select link from ${connection.fromLabel} to ${connection.toLabel}`}
              >
                <path
                  d={connection.path}
                  fill="none"
                  stroke="transparent"
                  strokeLinecap="round"
                  strokeWidth="18"
                  className="cursor-pointer"
                />
                <path
                  d={connection.path}
                  fill="none"
                  stroke={connection.isActive ? "rgb(var(--color-accent))" : "rgba(100, 116, 139, 0.82)"}
                  strokeLinecap="round"
                  strokeWidth={connection.isActive ? "3.2" : "2.2"}
                  style={{ pointerEvents: "none" }}
                />
                <foreignObject
                  x={connection.midpoint.x - 18}
                  y={connection.midpoint.y - 18}
                  width="36"
                  height="36"
                  className={`transition ${connection.isActive ? "opacity-100" : "opacity-0"}`}
                  style={{ overflow: "visible", pointerEvents: connection.isActive ? "auto" : "none" }}
                >
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      removeConnection(connection.id);
                    }}
                    onPointerDown={(event) => event.stopPropagation()}
                    className="grid h-8 w-8 place-items-center rounded-full border border-red-400/50 bg-red-600/90 text-white shadow-xl shadow-red-950/25 transition hover:border-red-200 hover:bg-red-500 focus:outline-none focus:ring-2 focus:ring-red-300/60"
                    aria-label={`Delete link from ${connection.fromLabel} to ${connection.toLabel}`}
                    title="Delete link"
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                </foreignObject>
              </g>
            ))}
            {dragConnection ? (
              <path
                d={dragConnection.path}
                fill="none"
                stroke="rgb(var(--color-accent))"
                strokeDasharray="8 8"
                strokeLinecap="round"
                strokeWidth="3"
              />
            ) : null}
          </svg>

          {nodes.map((node) => (
            <WorkflowNode
              key={node.id}
              isLead={node.isLead}
              isLinkInvalidTarget={Boolean(activeLinkSourceId && (activeLinkSourceId === node.id || node.id === LEAD_NODE_ID))}
              isLinking={activeLinkSourceId === node.id}
              isLinkTarget={Boolean(activeLinkSourceId && activeLinkSourceId !== node.id && node.id !== LEAD_NODE_ID)}
              isSelected={!node.isLead && node.id === selectedStepId}
              label={node.label}
              meta={node.meta}
              nodeType={node.nodeType}
              certificationStatus={node.certificationStatus}
              onPortClick={handlePortClick}
              onPortPointerDown={startLinkDrag}
              onPortPointerUp={finishLinkDrag}
              onSelect={() => {
                setSelectedConnectionId("");
                if (!node.isLead) {
                  onStepSelect(node.id);
                }
              }}
              onStartDrag={startDrag}
              position={nodePosition(node.id)}
              nodeId={node.id}
            />
          ))}
        </div>
      </div>

      <div className="absolute bottom-4 left-4 grid gap-1 rounded-2xl border border-line bg-ink/80 p-2 text-textSecondary">
        <GitBranch size={16} aria-hidden="true" />
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em]">{formatCount(draft.steps.length, "step")}</span>
        {canvasStatus ? (
          <span className="max-w-52 truncate text-[10px] font-semibold text-textPrimary">
            {canvasStatus}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function WorkflowNode({
  certificationStatus,
  isLead,
  isLinkInvalidTarget,
  isLinking,
  isLinkTarget,
  isSelected,
  label,
  meta,
  nodeType,
  nodeId,
  onPortClick,
  onPortPointerDown,
  onPortPointerUp,
  onSelect,
  onStartDrag,
  position,
}: {
  certificationStatus: string;
  isLead: boolean;
  isLinkInvalidTarget: boolean;
  isLinking: boolean;
  isLinkTarget: boolean;
  isSelected: boolean;
  label: string;
  meta: string;
  nodeType: string;
  nodeId: string;
  onPortClick: (nodeId: string, side: PortSide) => void;
  onPortPointerDown: (event: PointerEvent<HTMLElement>, nodeId: string) => void;
  onPortPointerUp: (nodeId: string) => void;
  onSelect: () => void;
  onStartDrag: (event: PointerEvent<HTMLElement>, nodeId: string) => void;
  position: CanvasNodePosition;
}) {
  const style: CSSProperties = {
    height: NODE_HEIGHT,
    left: position.x,
    top: position.y,
    width: NODE_WIDTH,
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      onPointerDown={(event) => onStartDrag(event, nodeId)}
      style={style}
      className={`absolute grid -translate-x-1/2 -translate-y-1/2 cursor-grab place-items-center rounded-2xl border bg-panel/95 px-5 py-4 text-center shadow-2xl outline-none transition hover:border-accent/45 active:cursor-grabbing ${
        isSelected || isLinking ? "border-accent/70 shadow-[inset_6px_0_0_rgb(var(--color-accent))]" : "border-line"
      }`}
    >
      {!isLead ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onPortClick(nodeId, "in");
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onPointerUp={(event) => {
            event.stopPropagation();
            onPortPointerUp(nodeId);
          }}
          className={`group absolute left-0 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border border-ink transition hover:scale-125 hover:bg-accent ${
            isLinkTarget
              ? "bg-accent shadow-[0_0_28px_rgb(var(--color-accent)/0.55)]"
              : isLinkInvalidTarget
                ? "bg-textSecondary opacity-45"
                : "bg-textPrimary"
          }`}
          aria-label={`Link into ${label}`}
          title={`Link to ${label}`}
        >
          <span className="pointer-events-none absolute right-5 top-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border border-line bg-panel/95 px-2 py-1 text-[10px] font-semibold text-textPrimary opacity-0 shadow-lg transition group-focus-visible:opacity-100 group-hover:opacity-100">
            Link to
          </span>
        </button>
      ) : null}
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onPortClick(nodeId, "out");
        }}
        onPointerDown={(event) => {
          event.stopPropagation();
          onPortPointerDown(event, nodeId);
        }}
        className={`group absolute right-0 top-1/2 h-4 w-4 -translate-y-1/2 translate-x-1/2 rounded-full border border-ink transition hover:scale-125 ${
          isLinking ? "bg-accent shadow-[0_0_28px_rgb(var(--color-accent)/0.55)]" : "bg-textPrimary hover:bg-accent"
        }`}
        aria-label={`Link from ${label}`}
        title={`Link from ${label}`}
      >
        <span className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border border-line bg-panel/95 px-2 py-1 text-[10px] font-semibold text-textPrimary opacity-0 shadow-lg transition group-focus-visible:opacity-100 group-hover:opacity-100">
          Link from
        </span>
      </button>
      <div className="min-w-0">
        <span className="block truncate text-sm font-semibold text-textPrimary">{label}</span>
        <span className="mt-1 block truncate text-xs text-textSecondary">{meta}</span>
        <span className="mt-1 block truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-accent">{nodeType}</span>
        <span className="mt-1 block truncate text-[10px] font-semibold uppercase tracking-[0.08em] text-textSecondary">
          {certificationStatus}
        </span>
        {isLead ? <span className="sr-only">Lead agent</span> : null}
      </div>
    </div>
  );
}
