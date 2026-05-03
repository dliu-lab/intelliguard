"use client";

import type { ChangeEvent, FormEvent } from "react";
import { useEffect, useState } from "react";
import {
  CheckCircle2,
  FileJson,
  ListChecks,
  MoreHorizontal,
  PencilLine,
  PlayCircle,
  Search,
  ShieldAlert,
  UploadCloud,
  Wrench,
  X,
} from "lucide-react";
import {
  createTool,
  evaluateTool,
  getSession,
  listEvaluationCriteriaResults,
  updateTool,
  type ApiRecord,
  type CriterionResult,
  type EvaluationRun,
  type PlatformData,
} from "@/lib/api";
import { ComponentRow, JsonBuilder, PlatformSurface } from "./shared";
import {
  formatTimestamp,
  isErrorMessage,
  joinParts,
  readNestedText,
  readText,
  templateJson,
} from "./utils";

function certificationStatus(tool: ApiRecord) {
  return readNestedText(tool, ["certification", "status"]) || "DRAFT";
}

function toolStatusLabel(status: string) {
  if (status === "CERTIFIED") {
    return "READY";
  }
  if (status === "DRAFT") {
    return "UNEVALUATED";
  }
  if (status === "FAILED") {
    return "FAILED EVALUATION";
  }
  if (status === "NEEDS_REEVALUATION") {
    return "NEEDS EVALUATION";
  }
  return status;
}

function statusClasses(status: string) {
  if (status === "CERTIFIED") {
    return "border-emerald-300/40 bg-emerald-300/12 text-emerald-100";
  }
  if (status === "FAILED" || status === "FAIL") {
    return "border-rose-300/45 bg-rose-300/12 text-rose-100";
  }
  if (status === "NEEDS_REEVALUATION" || status === "REVIEW") {
    return "border-amber-300/45 bg-amber-300/12 text-amber-100";
  }
  if (status === "EVALUATING") {
    return "border-sky-300/45 bg-sky-300/12 text-sky-100";
  }
  if (status === "PASS") {
    return "border-emerald-300/40 bg-emerald-300/12 text-emerald-100";
  }
  return "border-line bg-white/[0.045] text-textSecondary";
}

function shortHash(value: string | undefined) {
  return value ? value.slice(0, 12) : "not set";
}

type ToolStatusView = "all" | "certified" | "uncertified" | "restricted";
type ToolSort = "updated_desc" | "name_asc" | "status_asc";
type ToolModalTab = "profile" | "schemas" | "permissions" | "evaluation";

const UNCERTIFIED_STATUSES = new Set(["DRAFT", "EVALUATING", "FAILED", "NEEDS_REEVALUATION"]);
const TOOL_PAGE_SIZE = 20;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function restrictionFlagEnabled(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return !["", "false", "none", "no", "off"].includes(value.trim().toLowerCase());
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (isRecord(value)) {
    if ("enabled" in value) {
      return restrictionFlagEnabled(value.enabled);
    }
    if ("active" in value) {
      return restrictionFlagEnabled(value.active);
    }
    if ("status" in value) {
      return restrictionFlagEnabled(value.status);
    }
    return Object.keys(value).length > 0;
  }
  return false;
}

function hasRestrictedUse(tool: ApiRecord) {
  const metadata = isRecord(tool.metadata) ? tool.metadata : {};
  const permissions = isRecord(tool.permissions) ? tool.permissions : {};
  const certification = isRecord(tool.certification) ? tool.certification : {};

  return [
    metadata.restricted,
    metadata.restricted_use,
    metadata.restriction,
    metadata.restrictions,
    metadata.certification_exception,
    metadata.certification_exceptions,
    permissions.restricted,
    permissions.restricted_use,
    permissions.restriction,
    permissions.restrictions,
    certification.exception,
    certification.exceptions,
    certification.restriction,
    certification.restrictions,
  ].some(restrictionFlagEnabled);
}

function toolDomain(tool: ApiRecord) {
  const metadata = isRecord(tool.metadata) ? tool.metadata : {};
  const domain =
    readText(tool, ["domain"]) ||
    readText(metadata, ["domain", "data_domain"]) ||
    readText(tool, ["category"]) ||
    "general";
  return domain.trim() || "general";
}

function toolUpdatedAt(tool: ApiRecord) {
  const value = readText(tool, ["updated_at", "created_at"]);
  return value ? Date.parse(value) || 0 : 0;
}

function toolSearchText(tool: ApiRecord) {
  return [
    readText(tool, ["display_name", "tool_name"]),
    readText(tool, ["tool_name"]),
    readText(tool, ["tool_id"]),
    readText(tool, ["description"]),
    readText(tool, ["category"]),
    toolDomain(tool),
    readText(tool, ["environment"]),
    readText(tool, ["owner"]),
    readText(tool, ["side_effect_level"]),
    certificationStatus(tool),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function toEditableToolJson(tool: ApiRecord) {
  const metadata = isRecord(tool.metadata) ? tool.metadata : {};
  return JSON.stringify(
    {
      tool_name: readText(tool, ["tool_name"]) || "",
      display_name: readText(tool, ["display_name"]) || "",
      domain: toolDomain(tool),
      category: readText(tool, ["category"]) || "custom",
      description: readText(tool, ["description"]) || "",
      side_effect_level: readText(tool, ["side_effect_level"]) || "read_only",
      environment: readText(tool, ["environment"]) || "demo",
      owner: readText(tool, ["owner"]) || "Unassigned",
      input_schema: isRecord(tool.input_schema) ? tool.input_schema : {},
      output_schema: isRecord(tool.output_schema) ? tool.output_schema : {},
      permissions: isRecord(tool.permissions) ? tool.permissions : {},
      allowed_actions: Array.isArray(tool.allowed_actions) ? tool.allowed_actions : [],
      artifact_digest: readText(tool, ["artifact_digest"]) || null,
      metadata,
    },
    null,
    2,
  );
}

interface ToolRegistryWorkspaceProps {
  data: PlatformData;
  onRefresh: () => void | Promise<void>;
}

export function ToolRegistryWorkspace({ data, onRefresh }: ToolRegistryWorkspaceProps) {
  const [toolJson, setToolJson] = useState(templateJson("tool"));
  const [message, setMessage] = useState("");
  const [showToolBuilder, setShowToolBuilder] = useState(false);
  const [statusView, setStatusView] = useState<ToolStatusView>("all");
  const [selectedDomain, setSelectedDomain] = useState("all");
  const [toolSearch, setToolSearch] = useState("");
  const [toolSort, setToolSort] = useState<ToolSort>("updated_desc");
  const [page, setPage] = useState(1);
  const [modalToolId, setModalToolId] = useState<string | null>(null);
  const [modalInitialTab, setModalInitialTab] = useState<ToolModalTab>("profile");
  const [actionMenuToolId, setActionMenuToolId] = useState<string | null>(null);
  const readyCount = data.tools.filter((tool) => certificationStatus(tool) === "CERTIFIED").length;
  const needsEvaluationCount = data.tools.filter((tool) => UNCERTIFIED_STATUSES.has(certificationStatus(tool))).length;
  const restrictedCount = data.tools.filter(hasRestrictedUse).length;
  const domainFilters = Array.from(
    data.tools.reduce<Map<string, number>>((domains, tool) => {
      const domain = toolDomain(tool);
      domains.set(domain, (domains.get(domain) || 0) + 1);
      return domains;
    }, new Map()),
    ([domain, count]) => ({ domain, count }),
  ).sort((a, b) => a.domain.localeCompare(b.domain));
  const filteredTools = data.tools
    .filter((tool) => {
      const status = certificationStatus(tool);
      const matchesStatus =
        statusView === "all" ||
        (statusView === "certified" && status === "CERTIFIED") ||
        (statusView === "uncertified" && UNCERTIFIED_STATUSES.has(status)) ||
        (statusView === "restricted" && hasRestrictedUse(tool));
      const matchesDomain = selectedDomain === "all" || toolDomain(tool) === selectedDomain;
      const query = toolSearch.trim().toLowerCase();

      return matchesStatus && matchesDomain && (!query || toolSearchText(tool).includes(query));
    })
    .sort((left, right) => {
      if (toolSort === "name_asc") {
        return (readText(left, ["display_name", "tool_name"]) || "").localeCompare(
          readText(right, ["display_name", "tool_name"]) || "",
        );
      }
      if (toolSort === "status_asc") {
        return certificationStatus(left).localeCompare(certificationStatus(right));
      }
      return toolUpdatedAt(right) - toolUpdatedAt(left);
    });
  const totalPages = Math.max(1, Math.ceil(filteredTools.length / TOOL_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedTools = filteredTools.slice(
    (currentPage - 1) * TOOL_PAGE_SIZE,
    currentPage * TOOL_PAGE_SIZE,
  );
  const modalTool = data.tools.find((tool) => readText(tool, ["tool_id"]) === modalToolId) || null;
  const modalEvaluationRuns = modalToolId
    ? data.evaluationRuns.filter((run) => run.target_type === "tool" && run.target_id === modalToolId)
    : [];

  useEffect(() => {
    setPage(1);
    setActionMenuToolId(null);
  }, [statusView, selectedDomain, toolSearch, toolSort]);

  function openToolModal(toolId: string, tab: ToolModalTab) {
    setModalInitialTab(tab);
    setModalToolId(toolId);
    setActionMenuToolId(null);
  }

  async function submitTool(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    const session = getSession();
    if (!session?.token) {
      setMessage("Session expired. Login again before registering tools.");
      return;
    }

    try {
      const payload = JSON.parse(toolJson) as ApiRecord;
      const toolName = readText(payload, ["tool_name"]);
      if (toolName) {
        const existingTool = data.tools.some((tool) => readText(tool, ["tool_name"]) === toolName);
        if (existingTool) {
          throw new Error(`Tool name "${toolName}" already exists. Use a unique tool_name before registering.`);
        }
      }
      await createTool(session.token, payload);
      setMessage("Tool registered. Run evaluation before production attachment.");
      await Promise.resolve(onRefresh());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to register tool.");
    }
  }

  async function importToolJson(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      JSON.parse(text);
      setToolJson(text);
      setShowToolBuilder(true);
      setMessage("Tool JSON loaded.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to import tool JSON.");
    }
  }

  async function runEvaluation(tool: ApiRecord) {
    const session = getSession();
    if (!session?.token) {
      setMessage("Session expired. Login again before evaluating tools.");
      return;
    }

    const toolId = readText(tool, ["tool_id"]) || "";
    if (!toolId) {
      setMessage("Tool record is missing tool_id.");
      return;
    }

    setMessage("");
    try {
      await evaluateTool(session.token, toolId);
      setMessage(`Evaluation completed for ${readText(tool, ["display_name", "tool_name"]) || toolId}.`);
      await Promise.resolve(onRefresh());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to evaluate tool.");
    }
  }

  return (
    <section className="grid gap-5">
      {message ? (
        <div
          className={`rounded-2xl border p-4 text-sm ${
            isErrorMessage(message)
              ? "border-red-400/45 bg-red-500/10 text-red-200"
              : "border-line bg-white/[0.04] text-textSecondary"
          }`}
        >
          {message}
        </div>
      ) : null}

      <PlatformSurface tone="cyan">
        <div className="grid gap-5 xl:grid-cols-[minmax(0,0.8fr)_minmax(360px,1.2fr)] xl:items-end">
          <div>
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
              Tool onboarding
            </span>
            <h4 className="mt-2 text-xl font-semibold tracking-[-0.02em] text-textPrimary">
              Register governed tool contracts
            </h4>
            <p className="mt-2 text-sm leading-6 text-textSecondary">
              Start from the tool template or import a checked-in JSON contract. Tool schema, permissions, side-effect level, and artifact evidence become the source of truth before agent attachment.
            </p>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <button
              type="button"
              onClick={() => {
                setToolJson(templateJson("tool"));
                setShowToolBuilder(true);
              }}
              className={`rounded-2xl border p-4 text-left transition hover:border-accent/45 hover:bg-accent/10 ${
                showToolBuilder ? "border-accent/45 bg-accent/10" : "border-line bg-ink/45"
              }`}
            >
              <span className="inline-grid h-10 w-10 place-items-center rounded-xl border border-accent/25 bg-accent/10 text-accent">
                <FileJson size={18} aria-hidden="true" />
              </span>
              <strong className="ml-3 align-middle">Register from Template</strong>
            </button>

            <label className="cursor-pointer rounded-2xl border border-line bg-ink/45 p-4 text-left transition hover:border-accent/45 hover:bg-accent/10">
              <span className="inline-grid h-10 w-10 place-items-center rounded-xl border border-accent/25 bg-accent/10 text-accent">
                <UploadCloud size={18} aria-hidden="true" />
              </span>
              <strong className="ml-3 align-middle">Import JSON</strong>
              <input
                className="sr-only"
                type="file"
                accept="application/json,.json"
                onChange={importToolJson}
              />
            </label>
          </div>
        </div>
      </PlatformSurface>

      {showToolBuilder ? (
        <JsonBuilder
          endpoint="/v1/tools"
          json={toolJson}
          onCancel={() => {
            setToolJson(templateJson("tool"));
            setShowToolBuilder(false);
          }}
          onChange={setToolJson}
          onReset={() => setToolJson(templateJson("tool"))}
          onSubmit={submitTool}
          submitLabel="Register Tool"
          title="Tool registration"
        />
      ) : null}

      <section className="grid gap-5 xl:grid-cols-[minmax(290px,0.34fr)_minmax(0,1fr)]">
        <PlatformSurface tone="cyan">
          <div>
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
              Tool harness
            </span>
            <h4 className="mt-2 text-xl font-semibold tracking-[-0.02em] text-textPrimary">
              Govern registered tools
            </h4>
            <p className="mt-2 text-sm leading-6 text-textSecondary">
              Review registered tool contracts by status and domain before attaching them to agents.
            </p>
          </div>
          <div className="mt-5 grid gap-3 text-sm text-textSecondary">
            <button
              type="button"
              onClick={() => setStatusView("all")}
              className={`rounded-2xl border p-4 text-left transition hover:border-accent/45 hover:bg-accent/10 ${
                statusView === "all" ? "border-accent/45 bg-accent/10" : "border-line bg-ink/45"
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-indigo-300/30 bg-indigo-300/10 text-indigo-100">
                  <Wrench size={18} aria-hidden="true" />
                </span>
                <div>
                  <strong className="text-2xl text-textPrimary">{data.tools.length}</strong>
                  <p className="mt-1">registered contracts</p>
                </div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setStatusView("certified")}
              className={`rounded-2xl border p-4 text-left transition hover:border-accent/45 hover:bg-accent/10 ${
                statusView === "certified" ? "border-accent/45 bg-accent/10" : "border-line bg-ink/45"
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-emerald-300/30 bg-emerald-300/10 text-emerald-100">
                  <CheckCircle2 size={18} aria-hidden="true" />
                </span>
                <div>
                  <strong className="text-2xl text-textPrimary">{readyCount}</strong>
                  <p className="mt-1">ready tools</p>
                </div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setStatusView("uncertified")}
              className={`rounded-2xl border p-4 text-left transition hover:border-accent/45 hover:bg-accent/10 ${
                statusView === "uncertified" ? "border-accent/45 bg-accent/10" : "border-line bg-ink/45"
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-amber-300/30 bg-amber-300/10 text-amber-100">
                  <ShieldAlert size={18} aria-hidden="true" />
                </span>
                <div>
                  <strong className="text-2xl text-textPrimary">{needsEvaluationCount}</strong>
                  <p className="mt-1">need evaluation</p>
                </div>
              </div>
            </button>
            {restrictedCount ? (
              <button
                type="button"
                onClick={() => setStatusView("restricted")}
                className={`rounded-2xl border p-4 text-left transition hover:border-accent/45 hover:bg-accent/10 ${
                  statusView === "restricted" ? "border-accent/45 bg-accent/10" : "border-line bg-ink/45"
                }`}
              >
                <strong className="text-2xl text-textPrimary">{restrictedCount}</strong>
                <p className="mt-1">restricted exceptions</p>
              </button>
            ) : null}
          </div>
          <div className="mt-6 border-t border-line pt-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-textSecondary">
              Domain
            </p>
            <div className="mt-3 grid gap-2">
              <button
                type="button"
                onClick={() => setSelectedDomain("all")}
                className={`flex items-center justify-between rounded-xl border px-3 py-2 text-left text-sm font-semibold transition hover:border-accent/45 hover:bg-accent/10 ${
                  selectedDomain === "all" ? "border-accent/45 bg-accent/10 text-textPrimary" : "border-line bg-ink/45 text-textSecondary"
                }`}
              >
                <span>All domains</span>
                <span>{data.tools.length}</span>
              </button>
              {domainFilters.map((item) => (
                <button
                  key={item.domain}
                  type="button"
                  onClick={() => setSelectedDomain(item.domain)}
                  className={`flex items-center justify-between rounded-xl border px-3 py-2 text-left text-sm font-semibold transition hover:border-accent/45 hover:bg-accent/10 ${
                    selectedDomain === item.domain
                      ? "border-accent/45 bg-accent/10 text-textPrimary"
                      : "border-line bg-ink/45 text-textSecondary"
                  }`}
                >
                  <span className="truncate">{item.domain}</span>
                  <span>{item.count}</span>
                </button>
              ))}
            </div>
          </div>
        </PlatformSurface>

        <section className="rounded-3xl border border-line bg-white/[0.035] p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
                Evaluation status
              </span>
              <h3 className="mt-2 text-xl font-semibold text-textPrimary">Registered tools</h3>
            </div>
            <span className="rounded-full border border-line bg-ink/55 px-3 py-1 text-xs font-semibold text-textSecondary">
              config_hash + artifact_digest
            </span>
          </div>

          <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
            <label className="flex items-center gap-3 rounded-2xl border border-line bg-ink/65 px-4 py-3 text-sm text-textSecondary">
              <Search size={17} aria-hidden="true" />
              <input
                className="w-full bg-transparent text-textPrimary outline-none placeholder:text-textSecondary"
                placeholder="Search tools by name, owner, category, side effect, or status..."
                value={toolSearch}
                onChange={(event) => setToolSearch(event.target.value)}
              />
            </label>
            <label className="rounded-2xl border border-line bg-ink/65 px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-textSecondary">
              Sort
              <select
                value={toolSort}
                onChange={(event) => setToolSort(event.target.value as ToolSort)}
                className="mt-1 block w-full bg-transparent text-sm normal-case tracking-normal text-textPrimary outline-none [&>option]:bg-ink"
              >
                <option value="updated_desc">Recently updated</option>
                <option value="name_asc">Name A-Z</option>
                <option value="status_asc">Status</option>
              </select>
            </label>
          </div>

          <div className="mt-4 grid gap-3">
            {pagedTools.length ? (
              pagedTools.map((tool) => {
                const toolId = readText(tool, ["tool_id"]) || "";
                const status = certificationStatus(tool);
                const readyAt = formatTimestamp(readNestedText(tool, ["certification", "certified_at"]));
                const failureReason = readNestedText(tool, ["certification", "failure_reason"]);
                const restricted = hasRestrictedUse(tool);

                return (
                  <article key={toolId || readText(tool, ["tool_name"])} className="rounded-2xl border border-line bg-white/[0.035] p-4">
                    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
                      <button
                        type="button"
                        onClick={() => openToolModal(toolId, "evaluation")}
                        className="min-w-0 text-left"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="truncate text-lg font-semibold text-textPrimary">
                            {readText(tool, ["display_name", "tool_name"]) || "Unnamed tool"}
                          </h4>
                          <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusClasses(status)}`}>
                            {toolStatusLabel(status)}
                          </span>
                          {restricted ? (
                            <span className="rounded-full border border-amber-300/45 bg-amber-300/12 px-2.5 py-1 text-[11px] font-semibold text-amber-100">
                              RESTRICTED
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 line-clamp-1 text-sm leading-6 text-textSecondary">
                          {readText(tool, ["description"]) || "Tool contract registered in IntelliGuard."}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2 text-xs text-textSecondary">
                          <span className="rounded-full border border-line bg-ink/55 px-2.5 py-1">
                            {toolDomain(tool)}
                          </span>
                          <span className="rounded-full border border-line bg-ink/55 px-2.5 py-1">
                            {readText(tool, ["side_effect_level"]) || "unknown"}
                          </span>
                          <span className="rounded-full border border-line bg-ink/55 px-2.5 py-1">
                            {readText(tool, ["owner"]) || "Unassigned"}
                          </span>
                          <span className="rounded-full border border-line bg-ink/55 px-2.5 py-1">
                            config {shortHash(readText(tool, ["config_hash"]))}
                          </span>
                          {readText(tool, ["artifact_digest"]) ? (
                            <span className="rounded-full border border-line bg-ink/55 px-2.5 py-1">
                              artifact {shortHash(readText(tool, ["artifact_digest"]))}
                            </span>
                          ) : null}
                          {readyAt ? (
                            <span className="rounded-full border border-line bg-ink/55 px-2.5 py-1">
                              ready {readyAt}
                            </span>
                          ) : null}
                          {failureReason ? (
                            <span className="rounded-full border border-rose-300/35 bg-rose-300/10 px-2.5 py-1 text-rose-100">
                              {failureReason}
                            </span>
                          ) : null}
                        </div>
                      </button>
                      <div className="relative flex justify-end">
                        <button
                          type="button"
                          disabled={!toolId}
                          onClick={() => setActionMenuToolId((value) => (value === toolId ? null : toolId))}
                          className="grid h-10 w-10 place-items-center rounded-xl border border-line bg-white/[0.04] text-textPrimary transition hover:border-accent/45 hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-45"
                          aria-expanded={actionMenuToolId === toolId}
                          aria-haspopup="menu"
                          aria-label={`Tool actions for ${readText(tool, ["display_name", "tool_name"]) || "tool"}`}
                          title="Tool actions"
                        >
                          <MoreHorizontal size={16} aria-hidden="true" />
                        </button>
                        {actionMenuToolId === toolId ? (
                          <div
                            className="absolute right-0 top-12 z-20 w-44 overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl"
                            role="menu"
                          >
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => openToolModal(toolId, "evaluation")}
                              className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-semibold text-textPrimary transition hover:bg-accent/10"
                            >
                              <ListChecks size={15} aria-hidden="true" />
                              Evaluation
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => openToolModal(toolId, "profile")}
                              className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-semibold text-textPrimary transition hover:bg-accent/10"
                            >
                              <PencilLine size={15} aria-hidden="true" />
                              Edit
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </article>
                );
              })
            ) : (
              <ComponentRow
                title={data.tools.length ? "No matching tools" : "No tools registered"}
                detail={data.tools.length ? "Adjust the search or status filter." : "Register a tool contract before attaching it to agents."}
              />
            )}
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4 text-sm text-textSecondary">
            <span>
              Showing {filteredTools.length ? (currentPage - 1) * TOOL_PAGE_SIZE + 1 : 0}-
              {Math.min(currentPage * TOOL_PAGE_SIZE, filteredTools.length)} of {filteredTools.length}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
                className="rounded-full border border-line bg-white/[0.04] px-4 py-2 font-semibold text-textPrimary transition hover:border-accent/45 hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-45"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={currentPage >= totalPages}
                onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
                className="rounded-full border border-line bg-white/[0.04] px-4 py-2 font-semibold text-textPrimary transition hover:border-accent/45 hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-45"
              >
                Next
              </button>
            </div>
          </div>
        </section>
      </section>

      {modalTool ? (
        <SelectedToolModal
          evaluationRuns={modalEvaluationRuns}
          onClose={() => setModalToolId(null)}
          onEvaluate={runEvaluation}
          onRefresh={onRefresh}
          initialTab={modalInitialTab}
          tool={modalTool}
        />
      ) : null}
    </section>
  );
}

function ToolFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-ink/50 px-3 py-2">
      <p className="font-semibold uppercase tracking-[0.12em] text-textSecondary">{label}</p>
      <p className="mt-1 truncate text-textPrimary">{value}</p>
    </div>
  );
}

interface SelectedToolModalProps {
  evaluationRuns: EvaluationRun[];
  initialTab: ToolModalTab;
  onClose: () => void;
  onEvaluate: (tool: ApiRecord) => Promise<void>;
  onRefresh: () => void | Promise<void>;
  tool: ApiRecord;
}

function SelectedToolModal({
  evaluationRuns,
  initialTab,
  onClose,
  onEvaluate,
  onRefresh,
  tool,
}: SelectedToolModalProps) {
  const [tab, setTab] = useState<ToolModalTab>(initialTab);
  const [editJson, setEditJson] = useState(() => toEditableToolJson(tool));
  const [message, setMessage] = useState("");
  const [criteriaByRunId, setCriteriaByRunId] = useState<Record<string, CriterionResult[]>>({});
  const [criteriaMessage, setCriteriaMessage] = useState("");
  const [loadingCriteria, setLoadingCriteria] = useState(false);
  const [saving, setSaving] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const toolId = readText(tool, ["tool_id"]) || "";
  const status = certificationStatus(tool);
  const evaluationRunIdKey = evaluationRuns.map((run) => run.run_id).join("|");
  const tabs = [
    { id: "profile", label: "Profile" },
    { id: "schemas", label: "Schemas" },
    { id: "permissions", label: "Permissions" },
    { id: "evaluation", label: "Evaluation" },
  ] as const;

  useEffect(() => {
    setTab(initialTab);
    setEditJson(toEditableToolJson(tool));
    setMessage("");
  }, [initialTab, tool]);

  useEffect(() => {
    if (tab !== "evaluation") {
      return;
    }

    const runIds = evaluationRuns.map((run) => run.run_id);
    if (!runIds.length) {
      setCriteriaByRunId({});
      setCriteriaMessage("");
      setLoadingCriteria(false);
      return;
    }

    const session = getSession();
    if (!session?.token) {
      setCriteriaMessage("Session expired. Login again to load evaluation details.");
      setLoadingCriteria(false);
      return;
    }
    const token = session.token;

    let cancelled = false;

    async function loadCriteria() {
      setLoadingCriteria(true);
      setCriteriaMessage("");
      try {
        const entries = await Promise.all(
          runIds.map(async (runId) => {
            const criteria = await listEvaluationCriteriaResults(token, runId);
            return [runId, criteria] as const;
          }),
        );
        if (!cancelled) {
          setCriteriaByRunId(Object.fromEntries(entries));
        }
      } catch (error) {
        if (!cancelled) {
          setCriteriaMessage(error instanceof Error ? error.message : "Unable to load evaluation details.");
        }
      } finally {
        if (!cancelled) {
          setLoadingCriteria(false);
        }
      }
    }

    void loadCriteria();

    return () => {
      cancelled = true;
    };
  }, [evaluationRunIdKey, evaluationRuns, tab]);

  async function saveTool(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    const session = getSession();
    if (!session?.token) {
      setMessage("Session expired. Login again before editing tools.");
      return;
    }
    if (!toolId) {
      setMessage("Tool record is missing tool_id.");
      return;
    }

    try {
      setSaving(true);
      const payload = JSON.parse(editJson) as ApiRecord;
      await updateTool(session.token, toolId, payload);
      setMessage("Tool saved. Ready tools move to needs evaluation when the contract changes.");
      await Promise.resolve(onRefresh());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save tool.");
    } finally {
      setSaving(false);
    }
  }

  async function evaluateSelectedTool() {
    setMessage("");
    try {
      setEvaluating(true);
      await onEvaluate(tool);
      await Promise.resolve(onRefresh());
      setMessage("Evaluation completed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to evaluate tool.");
    } finally {
      setEvaluating(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-black/60 p-4 backdrop-blur-md" role="dialog" aria-modal="true">
      <div className="max-h-[92vh] w-full max-w-6xl overflow-hidden rounded-3xl border border-line bg-panel shadow-2xl">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line bg-white/[0.04] p-5">
          <div className="min-w-0">
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">Tool Registry</span>
            <h3 className="mt-2 truncate text-2xl font-semibold text-textPrimary">
              {readText(tool, ["display_name", "tool_name"]) || "Registered tool"}
            </h3>
            <p className="mt-1 text-sm text-textSecondary">
              {joinParts([readText(tool, ["tool_name"]), toolDomain(tool), readText(tool, ["environment"])])}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusClasses(status)}`}>
              {toolStatusLabel(status)}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="grid h-10 w-10 place-items-center rounded-xl border border-line bg-ink/55 text-textSecondary transition hover:border-accent/45 hover:text-textPrimary"
              aria-label="Close tool details"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="max-h-[calc(92vh-94px)] overflow-y-auto p-5">
          {message ? (
            <div
              className={`mb-4 rounded-2xl border p-4 text-sm ${
                isErrorMessage(message)
                  ? "border-red-400/45 bg-red-500/10 text-red-200"
                  : "border-line bg-white/[0.04] text-textSecondary"
              }`}
            >
              {message}
            </div>
          ) : null}

          <div className="flex gap-2 overflow-x-auto pb-2">
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`inline-flex min-h-10 shrink-0 items-center rounded-2xl border px-4 text-sm font-semibold transition ${
                  tab === item.id
                    ? "border-accent/45 bg-accent text-ink"
                    : "border-line bg-white/[0.04] text-textPrimary hover:border-accent/40 hover:bg-accent/10"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          {tab === "profile" ? (
            <form className="mt-4 grid gap-4" onSubmit={saveTool}>
              <textarea
                className="min-h-[460px] w-full resize-y rounded-2xl border border-line bg-ink/80 p-4 font-mono text-xs leading-6 text-textPrimary outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/20"
                spellCheck={false}
                value={editJson}
                onChange={(event) => setEditJson(event.target.value)}
              />
              <div className="flex flex-wrap gap-3">
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-full bg-accent px-5 py-3 text-sm font-semibold text-ink transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving ? "Saving" : "Save Tool"}
                </button>
                <button
                  type="button"
                  onClick={() => setEditJson(toEditableToolJson(tool))}
                  className="rounded-full border border-line bg-white/[0.04] px-5 py-3 text-sm font-semibold text-textPrimary transition hover:border-accent/40 hover:bg-accent/10"
                >
                  Reset
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-full border border-line bg-white/[0.04] px-5 py-3 text-sm font-semibold text-textPrimary transition hover:border-accent/40 hover:bg-accent/10"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : null}

          {tab === "schemas" ? (
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <JsonPreview title="Input Schema" value={tool.input_schema} />
              <JsonPreview title="Output Schema" value={tool.output_schema} />
            </div>
          ) : null}

          {tab === "permissions" ? (
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <JsonPreview title="Permissions" value={tool.permissions} />
              <JsonPreview title="Allowed Actions" value={tool.allowed_actions} />
              <ToolFact label="Side effect" value={readText(tool, ["side_effect_level"]) || "unknown"} />
              <ToolFact label="Owner" value={readText(tool, ["owner"]) || "Unassigned"} />
            </div>
          ) : null}

          {tab === "evaluation" ? (
            <div className="mt-4 grid gap-4">
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
                <div className="grid gap-3 md:grid-cols-2">
                  <ToolFact label="Use status" value={toolStatusLabel(status)} />
                  <ToolFact label="Config" value={shortHash(readText(tool, ["config_hash"]))} />
                  <ToolFact label="Artifact" value={shortHash(readText(tool, ["artifact_digest"]))} />
                  <ToolFact
                    label="Last evaluation"
                    value={readNestedText(tool, ["certification", "last_evaluation_run_id"]) || "not run"}
                  />
                </div>
                <button
                  type="button"
                  disabled={evaluating}
                  onClick={evaluateSelectedTool}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-full border border-accent/35 bg-accent/10 px-5 text-sm font-semibold text-textPrimary transition hover:border-accent/55 hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <PlayCircle size={16} aria-hidden="true" />
                  {evaluating ? "Evaluating" : "Run Evaluation"}
                </button>
              </div>

              {criteriaMessage ? (
                <div className="rounded-2xl border border-red-400/45 bg-red-500/10 p-4 text-sm text-red-200">
                  {criteriaMessage}
                </div>
              ) : null}
              {loadingCriteria ? (
                <ComponentRow title="Loading evaluation details" detail="Fetching criterion-level evidence for this tool." />
              ) : null}
              {evaluationRuns.length ? (
                evaluationRuns.map((run) => {
                  const criteria = criteriaByRunId[run.run_id] || [];

                  return (
                    <article key={run.run_id} className="rounded-2xl border border-line bg-white/[0.035] p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusClasses(run.overall_result || run.status)}`}>
                            {run.overall_result || run.status}
                          </span>
                          <h4 className="mt-3 truncate text-lg font-semibold text-textPrimary">
                            Evaluation run
                          </h4>
                          <p className="mt-1 truncate text-xs text-textSecondary">
                            {run.run_id}
                          </p>
                        </div>
                        <span className="rounded-full border border-line bg-ink/55 px-3 py-1 text-xs font-semibold text-textSecondary">
                          {formatTimestamp(run.completed_at || run.created_at)}
                        </span>
                      </div>

                      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <ToolFact label="Criteria" value={`${run.criteria_passed}/${run.criteria_total}`} />
                        <ToolFact label="Duration" value={run.duration_ms === null ? "n/a" : `${run.duration_ms}ms`} />
                        <ToolFact label="Triggered by" value={run.triggered_by || "unknown"} />
                        <ToolFact label="Config" value={shortHash(run.config_hash)} />
                      </div>
                      {run.artifact_digest ? (
                        <div className="mt-3">
                          <ToolFact label="Artifact" value={shortHash(run.artifact_digest)} />
                        </div>
                      ) : null}

                      <div className="mt-4 grid gap-3">
                        {criteria.length ? (
                          criteria.map((criterion) => (
                            <details
                              key={criterion.criterion_result_id}
                              className="rounded-2xl border border-line bg-ink/45 p-4"
                            >
                              <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-3 text-sm font-semibold text-textPrimary">
                                <span>{criterion.criterion_name}</span>
                                <span className="flex flex-wrap items-center gap-2">
                                  <span className={`rounded-full border px-2.5 py-1 text-[11px] ${statusClasses(criterion.status)}`}>
                                    {criterion.status}
                                  </span>
                                  <span className="rounded-full border border-line bg-white/[0.04] px-2.5 py-1 text-[11px] text-textSecondary">
                                    score {criterion.score ?? "n/a"}
                                  </span>
                                </span>
                              </summary>
                              <p className="mt-3 text-sm leading-6 text-textSecondary">
                                {criterion.evidence_sentence || "No evidence sentence recorded."}
                              </p>
                              <div className="mt-4 grid gap-3 lg:grid-cols-3">
                                <EvaluationJsonDetail title="Input" value={criterion.input_snapshot} />
                                <EvaluationJsonDetail title="Observed" value={criterion.observed_value} />
                                <EvaluationJsonDetail title="Expected" value={criterion.expected_value} />
                              </div>
                            </details>
                          ))
                        ) : !loadingCriteria ? (
                          <ComponentRow title="No criterion details" detail="This run has no saved criterion evidence." />
                        ) : null}
                      </div>
                    </article>
                  );
                })
              ) : (
                <ComponentRow title="No evaluation runs" detail="Run evaluation to create tool evidence." />
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function JsonPreview({ title, value }: { title: string; value: unknown }) {
  return (
    <div className="rounded-2xl border border-line bg-white/[0.035] p-4">
      <h4 className="font-semibold text-textPrimary">{title}</h4>
      <pre className="mt-3 max-h-[380px] overflow-auto rounded-xl border border-line bg-ink/70 p-4 text-xs leading-6 text-textSecondary">
        {JSON.stringify(value || {}, null, 2)}
      </pre>
    </div>
  );
}

function EvaluationJsonDetail({ title, value }: { title: string; value: unknown }) {
  return (
    <div className="rounded-xl border border-line bg-white/[0.035] p-3">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-textSecondary">{title}</p>
      <pre className="mt-2 max-h-52 overflow-auto rounded-lg bg-ink/70 p-3 text-[11px] leading-5 text-textSecondary">
        {JSON.stringify(value || {}, null, 2)}
      </pre>
    </div>
  );
}
