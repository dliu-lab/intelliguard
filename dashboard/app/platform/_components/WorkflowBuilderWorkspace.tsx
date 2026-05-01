"use client";

import type { CSSProperties, ChangeEvent, FormEvent, KeyboardEvent, PointerEvent, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, GitBranch, ListTree, Plus, Play, Search, UploadCloud, X, ZoomIn, ZoomOut } from "lucide-react";
import { createWorkflowDefinition, getSession, runMultiAgentWorkflow, type ApiRecord, type PlatformData } from "@/lib/api";
import { ComponentRow } from "./shared";
import { formatCount, formatTimestamp, isErrorMessage, joinParts, readText, workflowTemplateJson } from "./utils";

type WorkflowStepDraft = {
  step_id: string;
  label: string;
  role?: string;
  agent_id: string;
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
  lead_agent_id: string;
  trigger_type?: string;
  steps: WorkflowStepDraft[];
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

const LEAD_NODE_ID = "lead";
const CANVAS_HEIGHT = 720;
const NODE_WIDTH = 236;
const NODE_HEIGHT = 96;

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
): ApiRecord {
  const visualConnections = sanitizeConnections(draft, connections);
  const leadDelegations = visualConnections
    .filter((connection) => connection.from === LEAD_NODE_ID)
    .map((connection) => connection.to);

  return {
    ...draft,
    workflow_definition_id: draft.workflow_definition_id || uniqueWorkflowId("workflow"),
    metadata: {
      ...(draft.metadata || {}),
      execution_mode: leadDelegations.length > 1 ? "multi_agent_fan_out" : "multi_agent_graph",
      lead_delegations: leadDelegations,
      visual_connections: visualConnections,
      node_positions: nodePositions,
    },
    steps: draft.steps.map(({ tool_args_json: toolArgsJson, ...step }) => ({
      ...step,
      tool_args: toolArgsJson ? JSON.parse(toolArgsJson) : step.tool_args || {},
    })),
  };
}

function workflowId(workflow: ApiRecord) {
  return readText(workflow, ["workflow_id", "id", "session_id"]) || "";
}

function safeOption(value: string | undefined, fallback: string) {
  return value && value.trim() ? value : fallback;
}

function workflowRunSearchText(workflow: ApiRecord) {
  return [
    readText(workflow, ["name", "workflow_id", "id", "session_id"]),
    readText(workflow, ["summary", "user_goal"]),
    readText(workflow, ["decision", "status"]),
    readText(workflow, ["created_at", "updated_at"]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function WorkflowBuilderWorkspace({
  data,
  onRefresh,
  onWorkflowTraceSelect,
  selectedEnvironment,
}: {
  data: PlatformData;
  onRefresh: () => void;
  onWorkflowTraceSelect: (workflowId: string) => void;
  selectedEnvironment: string;
}) {
  const [designerOpen, setDesignerOpen] = useState(false);
  const [draft, setDraft] = useState<WorkflowDraft>(() => toWorkflowDraft(selectedEnvironment));
  const [selectedStepId, setSelectedStepId] = useState(() => draft.steps[0]?.step_id || "");
  const [nodePositions, setNodePositions] = useState<Record<string, CanvasNodePosition>>({});
  const [connections, setConnections] = useState<WorkflowConnection[]>([]);
  const [connectionsTouched, setConnectionsTouched] = useState(false);
  const [linkingNodeId, setLinkingNodeId] = useState("");
  const [canvasZoom, setCanvasZoom] = useState(1);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState("");
  const [runQuery, setRunQuery] = useState("Investigate customer C123 and prepare a governed response.");
  const [message, setMessage] = useState("");
  const [workflowRunSearch, setWorkflowRunSearch] = useState("");
  const [workflowRunsExpanded, setWorkflowRunsExpanded] = useState(false);

  const agentOptions = useMemo(
    () =>
      data.agents.map((agent) => ({
        id: readText(agent, ["agent_id"]) || "",
        label: readText(agent, ["display_name", "agent_id"]) || "Agent",
      })),
    [data.agents],
  );

  const toolOptions = useMemo(
    () =>
      data.tools.map((tool) => ({
        id: readText(tool, ["tool_name", "name"]) || "",
        label: readText(tool, ["display_name", "tool_name", "name"]) || "Tool",
      })),
    [data.tools],
  );

  const environmentOptions = useMemo(() => {
    const values = [
      selectedEnvironment === "all" ? "demo" : selectedEnvironment,
      ...data.environments.filter((environment) => environment !== "all"),
    ];
    return Array.from(new Set(values.filter(Boolean)));
  }, [data.environments, selectedEnvironment]);

  const selectedStep = draft.steps.find((step) => step.step_id === selectedStepId) || draft.steps[0];
  const leadAgentLabel =
    agentOptions.find((agent) => agent.id === draft.lead_agent_id)?.label || draft.lead_agent_id || "Lead agent";
  const filteredWorkflowRuns = useMemo(() => {
    const query = workflowRunSearch.trim().toLowerCase();
    if (!query) {
      return data.workflows;
    }

    return data.workflows.filter((workflow) => workflowRunSearchText(workflow).includes(query));
  }, [data.workflows, workflowRunSearch]);

  useEffect(() => {
    if (!selectedWorkflowId && data.workflowDefinitions[0]) {
      setSelectedWorkflowId(String(data.workflowDefinitions[0].workflow_definition_id || ""));
    }
  }, [data.workflowDefinitions, selectedWorkflowId]);

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
    setConnectionsTouched(false);
    setDraft(nextDraft);
    setNodePositions(defaultNodePositions(nextDraft));
    setConnections(defaultConnections(nextDraft));
    setLinkingNodeId("");
    setSelectedStepId(nextDraft.steps[0]?.step_id || "");
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

  function addStep() {
    const nextIndex = draft.steps.length + 1;
    const agentId = safeOption(agentOptions[0]?.id, "specialist-agent");
    const toolName = safeOption(toolOptions[0]?.id, "get_customer_profile");
    const nextStep: WorkflowStepDraft = {
      step_id: `step_${nextIndex}`,
      label: `Workflow step ${nextIndex}`,
      role: `sub_agent:step_${nextIndex}`,
      agent_id: agentId,
      tool_name: toolName,
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

      setDraft(nextDraft);
      setNodePositions(defaultNodePositions(nextDraft));
      setConnections(defaultConnections(nextDraft));
      setConnectionsTouched(false);
      setLinkingNodeId("");
      setSelectedStepId(nextDraft.steps[0]?.step_id || "");
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

  async function submitWorkflowDefinition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    const session = getSession();
    if (!session?.token) {
      setMessage("Session expired. Login again before creating workflow definitions.");
      return;
    }

    try {
      const payload = cleanWorkflowDraft(draft, nodePositions, connections);
      await createWorkflowDefinition(session.token, payload);
      setSelectedWorkflowId(String(payload.workflow_definition_id || ""));
      setMessage("Workflow definition created.");
      setDesignerOpen(false);
      resetTemplate(false);
      await onRefresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to create workflow definition.");
    }
  }

  async function runWorkflow(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    const session = getSession();
    if (!session?.token) {
      setMessage("Session expired. Login again before running a workflow.");
      return;
    }

    try {
      await runMultiAgentWorkflow(session.token, {
        query: runQuery,
        workflow_definition_id: selectedWorkflowId || undefined,
      });
      setMessage("Workflow run started.");
      await onRefresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to run workflow.");
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

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => {
            setDesignerOpen(true);
            setMessage("");
          }}
          className="inline-flex items-center justify-center gap-2 rounded-full bg-accent px-5 py-3 text-sm font-semibold text-ink transition hover:bg-accent/90 focus:outline-none focus:ring-2 focus:ring-accent/40"
        >
          <ListTree size={17} aria-hidden="true" />
          Workflow Designer
        </button>
      </div>

      <section className="glass-card rounded-3xl p-5">
        <div className="grid gap-4 xl:grid-cols-[1fr_minmax(320px,0.65fr)] xl:items-start">
          <div>
            <h3 className="text-xl font-semibold">Traceable workflow runs</h3>
            <p className="mt-1 text-sm text-textSecondary">
              {workflowRunSearch
                ? `${filteredWorkflowRuns.length} of ${formatCount(data.workflows.length, "run")}`
                : formatCount(data.workflows.length, "run")}
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row xl:justify-end">
            <label className="flex min-h-11 flex-1 items-center gap-2 rounded-2xl border border-line bg-ink/55 px-3 text-sm text-textSecondary">
              <Search size={16} aria-hidden="true" />
              <input
                value={workflowRunSearch}
                onChange={(event) => {
                  setWorkflowRunSearch(event.target.value);
                  setWorkflowRunsExpanded(true);
                }}
                placeholder="Filter runs..."
                className="min-w-0 flex-1 bg-transparent text-textPrimary outline-none placeholder:text-textSecondary"
              />
            </label>
            <button
              type="button"
              onClick={() => setWorkflowRunsExpanded((current) => !current)}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-line bg-ink/55 px-4 text-sm font-semibold text-textPrimary transition hover:border-accent/40 hover:bg-accent/10"
              aria-expanded={workflowRunsExpanded}
            >
              <ChevronDown
                size={16}
                className={`transition ${workflowRunsExpanded ? "" : "-rotate-90"}`}
                aria-hidden="true"
              />
              {workflowRunsExpanded ? "Collapse" : "Expand"}
            </button>
          </div>
        </div>

        {workflowRunsExpanded ? (
          <div className="mt-5 grid max-h-[560px] gap-3 overflow-y-auto pr-1">
            {filteredWorkflowRuns.length ? (
              filteredWorkflowRuns.map((workflow) => {
                const id = workflowId(workflow);
                const createdAt = formatTimestamp(readText(workflow, ["created_at"]));
                const stepCount = Number(readText(workflow, ["session_count"]));
                return (
                  <div
                    key={id || String(workflow.session_id)}
                    className="grid gap-3 rounded-2xl border border-line bg-white/[0.035] p-4 lg:grid-cols-[1fr_auto] lg:items-center"
                  >
                    <div>
                      <p className="font-semibold text-textPrimary">
                        {readText(workflow, ["name", "workflow_id", "session_id"]) || "Workflow run"}
                      </p>
                      <p className="mt-1 text-sm leading-6 text-textSecondary">
                        {readText(workflow, ["summary", "user_goal"]) || "Traceable workflow execution."}
                      </p>
                      <p className="mt-2 text-xs text-textSecondary">
                        {joinParts([
                          id,
                          createdAt,
                          readText(workflow, ["decision", "status"]),
                          Number.isFinite(stepCount) ? formatCount(stepCount, "step") : undefined,
                        ])}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onWorkflowTraceSelect(id)}
                      className="rounded-full border border-accent/25 bg-accent/10 px-4 py-2 text-sm font-semibold text-accent transition hover:border-accent/45 hover:bg-accent/15"
                    >
                      Trace
                    </button>
                  </div>
                );
              })
            ) : (
              <ComponentRow
                title={data.workflows.length ? "No matching workflow runs" : "No workflow runs"}
                detail={data.workflows.length ? "Adjust the filter to find another run." : "Run a workflow and its trace will appear here."}
              />
            )}
          </div>
        ) : null}
      </section>

      <section className="glass-card rounded-3xl p-5">
        <div>
          <h3 className="text-xl font-semibold">Run workflow</h3>
        </div>

        <form className="mt-5 grid gap-3 lg:grid-cols-[minmax(220px,0.45fr)_minmax(0,1fr)_auto]" onSubmit={runWorkflow}>
          <BuilderField label="Definition">
            <select
              value={selectedWorkflowId}
              onChange={(event) => setSelectedWorkflowId(event.target.value)}
              className="field-input"
            >
              {data.workflowDefinitions.map((workflow) => (
                <option key={String(workflow.workflow_definition_id)} value={String(workflow.workflow_definition_id)}>
                  {readText(workflow, ["name", "workflow_definition_id"]) || "Workflow definition"}
                </option>
              ))}
              {!data.workflowDefinitions.length ? <option value="">Default customer support workflow</option> : null}
            </select>
          </BuilderField>

          <BuilderField label="Goal">
            <input value={runQuery} onChange={(event) => setRunQuery(event.target.value)} className="field-input" />
          </BuilderField>

          <button
            type="submit"
            className="inline-flex items-center justify-center gap-2 self-end rounded-full bg-accent px-5 py-3 text-sm font-semibold text-ink transition hover:bg-accent/90"
          >
            <Play size={16} aria-hidden="true" />
            Run
          </button>
        </form>
      </section>

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
                <h3 className="mt-2 text-3xl font-semibold tracking-[-0.03em]">Agent workflow designer</h3>
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
                <button type="submit" className="rounded-full bg-accent px-5 py-2 text-sm font-semibold text-ink transition hover:bg-accent/90">
                  Create Workflow
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
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[0.34fr_0.34fr_0.28fr_0.34fr]">
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
                <BuilderField label="Lead Agent">
                  <select value={draft.lead_agent_id} onChange={(event) => updateDraft("lead_agent_id", event.target.value)} className="field-input">
                    <option value={draft.lead_agent_id}>{leadAgentLabel}</option>
                    {agentOptions
                      .filter((agent) => agent.id && agent.id !== draft.lead_agent_id)
                      .map((agent) => (
                        <option key={agent.id} value={agent.id}>
                          {agent.label}
                        </option>
                      ))}
                  </select>
                </BuilderField>
              </div>

              <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_344px]">
                <WorkflowCanvas
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
                        <select value={selectedStep.agent_id} onChange={(event) => updateStep("agent_id", event.target.value)} className="field-input">
                          <option value={selectedStep.agent_id}>{selectedStep.agent_id}</option>
                          {agentOptions
                            .filter((agent) => agent.id && agent.id !== selectedStep.agent_id)
                            .map((agent) => (
                              <option key={agent.id} value={agent.id}>
                                {agent.label}
                              </option>
                            ))}
                        </select>
                      </BuilderField>
                      <BuilderField label="Tool">
                        <select value={selectedStep.tool_name || ""} onChange={(event) => updateStep("tool_name", event.target.value)} className="field-input">
                          <option value="">No tool</option>
                          {selectedStep.tool_name ? <option value={selectedStep.tool_name}>{selectedStep.tool_name}</option> : null}
                          {toolOptions
                            .filter((tool) => tool.id && tool.id !== selectedStep.tool_name)
                            .map((tool) => (
                              <option key={tool.id} value={tool.id}>
                                {tool.label}
                              </option>
                            ))}
                        </select>
                      </BuilderField>
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

function WorkflowCanvas({
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
      isLead: true,
    },
    ...draft.steps.map((step) => ({
      id: step.step_id,
      label: step.label || step.step_id,
      meta: step.agent_id,
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
  isLead,
  isLinkInvalidTarget,
  isLinking,
  isLinkTarget,
  isSelected,
  label,
  meta,
  nodeId,
  onPortClick,
  onPortPointerDown,
  onPortPointerUp,
  onSelect,
  onStartDrag,
  position,
}: {
  isLead: boolean;
  isLinkInvalidTarget: boolean;
  isLinking: boolean;
  isLinkTarget: boolean;
  isSelected: boolean;
  label: string;
  meta: string;
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
        {isLead ? <span className="sr-only">Lead agent</span> : null}
      </div>
    </div>
  );
}
