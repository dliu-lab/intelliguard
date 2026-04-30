"use client";

import type { ChangeEvent, FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { Bot, FileJson, MoreHorizontal, Search, UploadCloud, X } from "lucide-react";
import {
  createAgent,
  createEvaluatorTemplate,
  createGuardrailPolicy,
  createKnowledgeBase,
  createTool,
  deleteAgent as deleteAgentIdentity,
  getSession,
  type ApiRecord,
  type PlatformData,
} from "@/lib/api";
import { ComponentRow, JsonBuilder, ResourceGrid } from "./shared";
import { SelectedAgentModal } from "./SelectedAgentModal";
import type { BackendComponentKey } from "./types";
import {
  agentVersion,
  countUnique,
  formatCount,
  formatTimestamp,
  getAgentTools,
  isErrorMessage,
  joinParts,
  readText,
  sumAgentToolGrants,
  templateJson,
} from "./utils";

export function ControlPlaneWorkspace({
  activeComponent,
  data,
  dataStatus,
  onRefresh,
  onSelect,
}: {
  activeComponent: BackendComponentKey;
  data: PlatformData;
  dataStatus: "loading" | "ready" | "error";
  onRefresh: () => void;
  onSelect: (component: BackendComponentKey) => void;
}) {
  type ControlTab = "agents" | "tools" | "guardrails" | "evaluators" | "knowledge";
  type AgentModalTab = "profile" | "tools" | "guardrails" | "evaluators" | "knowledge";

  const initialTab: ControlTab =
    activeComponent === "tools" ||
    activeComponent === "guardrails" ||
    activeComponent === "evaluators" ||
    activeComponent === "knowledge"
      ? activeComponent
      : "agents";
  const [tab, setTab] = useState<ControlTab>(initialTab);
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [modalAgentId, setModalAgentId] = useState<string | null>(null);
  const [modalTab, setModalTab] = useState<AgentModalTab>("profile");
  const [agentSearch, setAgentSearch] = useState("");
  const [showAgentBuilder, setShowAgentBuilder] = useState(false);
  const [message, setMessage] = useState("");
  const [agentJson, setAgentJson] = useState(templateJson("agent"));
  const [toolJson, setToolJson] = useState(templateJson("tool"));
  const [guardrailJson, setGuardrailJson] = useState(templateJson("guardrail"));
  const [evaluatorJson, setEvaluatorJson] = useState(templateJson("evaluator"));
  const [knowledgeJson, setKnowledgeJson] = useState(templateJson("knowledge"));
  const agentImportInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!selectedAgentId && data.agents[0]) {
      setSelectedAgentId(String(data.agents[0].agent_id || ""));
    }
  }, [data.agents, selectedAgentId]);

  function selectTab(nextTab: ControlTab) {
    setTab(nextTab);
    onSelect(nextTab);
  }

  async function submitJson(
    event: FormEvent<HTMLFormElement>,
    label: string,
    json: string,
    create: (token: string, payload: ApiRecord) => Promise<ApiRecord>,
  ) {
    event.preventDefault();
    setMessage("");

    const session = getSession();
    if (!session?.token) {
      setMessage("Session expired. Login again before changing control plane resources.");
      return;
    }

    try {
      const payload = JSON.parse(json) as ApiRecord;
      const payloadAgentId = readText(payload, ["agent_id"]);
      if (label === "Agent" && payloadAgentId) {
        const existingAgent = data.agents.some((agent) => readText(agent, ["agent_id"]) === payloadAgentId);
        if (existingAgent) {
          throw new Error(`Agent ID "${payloadAgentId}" already exists. Use a unique agent_id before registering.`);
        }
      }
      await create(session.token, payload);
      setMessage(`${label} saved to backend.`);
      await onRefresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `Unable to save ${label.toLowerCase()}.`);
    }
  }

  async function importAgentJson(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      JSON.parse(text);
      setAgentJson(text);
      setShowAgentBuilder(true);
      setMessage("Agent JSON loaded.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to import agent JSON.");
    }
  }

  async function deleteAgentCard(agent: ApiRecord) {
    setMessage("");

    const session = getSession();
    if (!session?.token) {
      setMessage("Session expired. Login again before deleting an agent.");
      return;
    }

    const agentId = String(agent.agent_id || "");
    const agentName = readText(agent, ["display_name", "agent_id"]) || "this agent";
    const confirmed = window.confirm(
      `Delete ${agentName}? This removes the agent identity and its governance assignments.`,
    );

    if (!confirmed) {
      return;
    }

    try {
      await deleteAgentIdentity(session.token, agentId);
      if (selectedAgentId === agentId) {
        setSelectedAgentId("");
      }
      if (modalAgentId === agentId) {
        setModalAgentId(null);
      }
      setMessage(`${agentName} deleted.`);
      await onRefresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to delete agent.");
    }
  }

  const modalAgent = data.agents.find((agent) => String(agent.agent_id || "") === modalAgentId) || null;
  const filteredAgents = data.agents.filter((agent) => {
    const query = agentSearch.trim().toLowerCase();
    if (!query) {
      return true;
    }

                    return [
                      readText(agent, ["display_name", "agent_id"]),
                      readText(agent, ["purpose"]),
                      readText(agent, ["owner"]),
                      readText(agent, ["environment"]),
                      readText(agent, ["agent_type"]),
                      `${data.agentAssignmentCounts[String(agent.agent_id || "")]?.guardrails || 0} guardrails`,
                      `${data.agentAssignmentCounts[String(agent.agent_id || "")]?.evaluators || 0} evaluators`,
                      `${data.agentAssignmentCounts[String(agent.agent_id || "")]?.knowledge || 0} KBs`,
                      ...getAgentTools(agent),
                    ].some((item) => item?.toLowerCase().includes(query));
  });

  const controlTabs: Array<{ id: ControlTab; label: string; count?: number }> = [
    { id: "agents", label: "Agents", count: data.agents.length },
    { id: "tools", label: "Tools", count: data.tools.length },
    { id: "guardrails", label: "Guardrails", count: data.guardrailPolicies.length },
    { id: "evaluators", label: "Evaluators", count: data.evaluatorTemplates.length },
    { id: "knowledge", label: "Knowledge", count: data.knowledgeBases.length },
  ];

  return (
    <section className="grid gap-5" data-testid="control-plane-workspace">
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

      <div className="glass-card overflow-hidden rounded-3xl">
        <div className="border-b border-line px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-base font-semibold">Control Plane</h3>
            <div className="flex gap-2 overflow-x-auto pb-1">
            {controlTabs.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => selectTab(item.id)}
                className={`inline-flex shrink-0 items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-accent/40 ${
                  tab === item.id
                    ? "border-accent/45 bg-accent text-ink"
                    : "border-line bg-white/[0.04] text-textPrimary hover:border-accent/40 hover:bg-accent/10"
                }`}
              >
                {item.label}
                {typeof item.count === "number" ? (
                  <span className={tab === item.id ? "text-ink/70" : "text-textSecondary"}>{item.count}</span>
                ) : null}
              </button>
            ))}
            </div>
          </div>
        </div>

        <div className="p-5">
          {tab === "agents" ? (
            <div className="grid gap-5">
              <section>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <span className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
                      Agent onboarding
                    </span>
                    <p className="mt-2 text-sm leading-6 text-textSecondary">
                      Register governed agent identities from a template or a checked-in JSON contract.
                    </p>
                  </div>
                </div>

                <div className="mt-5 grid gap-3 lg:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => {
                      setAgentJson(templateJson("agent"));
                      setShowAgentBuilder(true);
                      }}
                    className={`rounded-2xl border p-4 text-left transition hover:border-accent/45 hover:bg-accent/10 ${
                      showAgentBuilder ? "border-accent/45 bg-accent/10" : "border-line bg-white/[0.035]"
                    }`}
                  >
                    <span className="inline-grid h-10 w-10 place-items-center rounded-xl border border-accent/25 bg-accent/10 text-accent">
                      <FileJson size={18} aria-hidden="true" />
                    </span>
                    <strong className="ml-3 align-middle">Register from Template</strong>
                  </button>

                  <button
                    type="button"
                    onClick={() => agentImportInputRef.current?.click()}
                    className="rounded-2xl border border-line bg-white/[0.035] p-4 text-left transition hover:border-accent/45 hover:bg-accent/10"
                  >
                    <span className="inline-grid h-10 w-10 place-items-center rounded-xl border border-accent/25 bg-accent/10 text-accent">
                      <UploadCloud size={18} aria-hidden="true" />
                    </span>
                    <strong className="ml-3 align-middle">Import JSON</strong>
                  </button>
                  <input
                    ref={agentImportInputRef}
                    className="sr-only"
                    type="file"
                    accept="application/json,.json"
                    onChange={importAgentJson}
                  />
                </div>

                {showAgentBuilder ? (
                  <div className="mt-5">
                    <JsonBuilder
                      endpoint="/v1/agents"
                      json={agentJson}
                      onChange={setAgentJson}
                      onCancel={() => {
                        setAgentJson(templateJson("agent"));
                        setShowAgentBuilder(false);
                      }}
                      onReset={() => setAgentJson(templateJson("agent"))}
                      onSubmit={(event) => submitJson(event, "Agent", agentJson, createAgent)}
                      submitLabel="Register Agent"
                      title="Agent registration"
                    />
                  </div>
                ) : null}
              </section>

              <section className="border-t border-line pt-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <span className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
                      Agent harness
                    </span>
                    <p className="mt-2 text-sm leading-6 text-textSecondary">
                      Select an identity, then govern tool access, guardrails, evaluators, and knowledge access.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-sm text-textSecondary">
                    <span className="rounded-xl border border-line bg-ink/60 px-3 py-2">
                      <strong className="text-textPrimary">{data.agents.length}</strong> agents
                    </span>
                    <span className="rounded-xl border border-line bg-ink/60 px-3 py-2">
                      <strong className="text-textPrimary">{countUnique(data.agents, "environment")}</strong>{" "}
                      environments
                    </span>
                    <span className="rounded-xl border border-line bg-ink/60 px-3 py-2">
                      <strong className="text-textPrimary">{sumAgentToolGrants(data.agents)}</strong> tool grants
                    </span>
                  </div>
                </div>

                <label className="mt-5 flex items-center gap-3 rounded-2xl border border-line bg-ink/65 px-4 py-3 text-sm text-textSecondary">
                  <Search size={17} aria-hidden="true" />
                  <input
                    className="w-full bg-transparent text-textPrimary outline-none placeholder:text-textSecondary"
                    placeholder="Search agents..."
                    value={agentSearch}
                    onChange={(event) => setAgentSearch(event.target.value)}
                  />
                </label>

                <div className="mt-4 grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
                  {filteredAgents.map((agent) => {
                    const agentId = String(agent.agent_id || "");
                    const toolCount = getAgentTools(agent).length;
                    const createdAt = formatTimestamp(readText(agent, ["created_at"]));
                    const assignmentCounts = data.agentAssignmentCounts[agentId] || {
                      guardrails: 0,
                      evaluators: 0,
                      knowledge: 0,
                    };
                    const countPills = [
                      { label: formatCount(toolCount, "tool"), tone: "agent-count-tool", visible: toolCount > 0 },
                      {
                        label: formatCount(assignmentCounts.guardrails, "guardrail"),
                        tone: "agent-count-guardrail",
                        visible: assignmentCounts.guardrails > 0,
                      },
                      {
                        label: formatCount(assignmentCounts.evaluators, "evaluator"),
                        tone: "agent-count-evaluator",
                        visible: assignmentCounts.evaluators > 0,
                      },
                      {
                        label: formatCount(assignmentCounts.knowledge, "KB"),
                        tone: "agent-count-knowledge",
                        visible: assignmentCounts.knowledge > 0,
                      },
                    ];

                    return (
                      <article
                        key={agentId}
                        className={`rounded-2xl border bg-white/[0.035] p-4 transition ${
                          selectedAgentId === agentId
                            ? "border-accent/55 bg-accent/10"
                            : "border-line hover:border-accent/35"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <button
                            type="button"
                            className="min-w-0 flex-1 text-left"
                            aria-label={`Open ${readText(agent, ["display_name", "agent_id"]) || "agent"} profile`}
                            onClick={() => {
                              setSelectedAgentId(agentId);
                              setModalAgentId(agentId);
                              setModalTab("profile");
                            }}
                          >
                            <div className="flex items-start gap-3">
                              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-accent/25 bg-accent/10 text-accent">
                                <Bot size={17} aria-hidden="true" />
                              </span>
                              <span className="min-w-0">
                                <strong className="block truncate text-textPrimary">
                                  {readText(agent, ["display_name", "agent_id"])}
                                </strong>
                                <span className="block truncate text-xs text-textSecondary">
                                  {readText(agent, ["agent_id"])}
                                </span>
                              </span>
                            </div>
                            <p className="mt-4 line-clamp-2 text-sm leading-6 text-textSecondary">
                              {readText(agent, ["purpose"]) || "Governed agent identity."}
                            </p>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedAgentId(agentId);
                              setModalAgentId(agentId);
                              setModalTab("profile");
                            }}
                            className="grid h-8 w-8 place-items-center rounded-xl border border-line bg-ink/60 text-textSecondary transition hover:border-accent/45 hover:text-textPrimary"
                            aria-label={`Open ${readText(agent, ["display_name", "agent_id"]) || "agent"}`}
                          >
                            <MoreHorizontal size={17} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteAgentCard(agent)}
                            className="grid h-8 w-8 place-items-center rounded-xl border border-rose-300/35 bg-rose-300/10 text-textPrimary transition hover:border-rose-300/60 hover:bg-rose-300/15"
                            aria-label={`Delete ${readText(agent, ["display_name", "agent_id"]) || "agent"}`}
                            title="Delete agent"
                          >
                            <X size={16} aria-hidden="true" />
                          </button>
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2 text-xs text-textSecondary">
                          <span className="rounded-full border border-line bg-ink/60 px-2.5 py-1 text-textPrimary">
                            v{agentVersion(agent)}
                          </span>
                          {createdAt ? (
                            <span className="rounded-full border border-line bg-ink/60 px-2.5 py-1 text-textPrimary">
                              {createdAt}
                            </span>
                          ) : null}
                          {readText(agent, ["owner"]) ? (
                            <span className="rounded-full border border-line bg-ink/60 px-2.5 py-1">
                              {readText(agent, ["owner"])}
                            </span>
                          ) : null}
                          {readText(agent, ["environment"]) ? (
                            <span className="rounded-full border border-line bg-ink/60 px-2.5 py-1">
                              {readText(agent, ["environment"])}
                            </span>
                          ) : null}
                          {readText(agent, ["agent_type"]) ? (
                            <span className="rounded-full border border-line bg-ink/60 px-2.5 py-1">
                              {readText(agent, ["agent_type"])}
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {countPills.filter((pill) => pill.visible).map((pill) => (
                            <span
                              key={pill.label}
                              className={`agent-count-tag ${pill.tone}`}
                            >
                              {pill.label}
                            </span>
                          ))}
                        </div>
                      </article>
                    );
                  })}
                  {!filteredAgents.length ? (
                    <ComponentRow title="No agents found" detail="Adjust the search or register a new agent." />
                  ) : null}
                </div>
              </section>
            </div>
          ) : null}

          {tab === "tools" ? (
            <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
              <JsonBuilder
                endpoint="/v1/tool-marketplace"
                json={toolJson}
                onChange={setToolJson}
                onReset={() => setToolJson(templateJson("tool"))}
                onSubmit={(event) => submitJson(event, "Tool", toolJson, createTool)}
                submitLabel="Register Tool"
                title="Tool contract"
              />
              <ResourceGrid
                emptyText="No tools registered."
                rows={data.tools.map((tool) => ({
                  title: readText(tool, ["display_name", "tool_name", "name"]) || "Unnamed tool",
                  detail: readText(tool, ["description", "category"]) || "Tool marketplace record.",
                  meta: joinParts([readText(tool, ["category"]), readText(tool, ["environment"])]),
                }))}
              />
            </div>
          ) : null}

          {tab === "guardrails" ? (
            <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
              <JsonBuilder
                endpoint="/v1/guardrail-policies"
                json={guardrailJson}
                onChange={setGuardrailJson}
                onReset={() => setGuardrailJson(templateJson("guardrail"))}
                onSubmit={(event) => submitJson(event, "Guardrail", guardrailJson, createGuardrailPolicy)}
                submitLabel="Register Guardrail"
                title="Guardrail contract"
              />
              <ResourceGrid
                emptyText="No guardrails registered."
                rows={data.guardrailPolicies.map((policy) => ({
                  title: readText(policy, ["display_name", "policy_id", "name"]) || "Unnamed guardrail",
                  detail: readText(policy, ["description", "mode"]) || "Guardrail policy from backend.",
                  meta: readText(policy, ["environment"]),
                }))}
              />
            </div>
          ) : null}

          {tab === "evaluators" ? (
            <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
              <JsonBuilder
                endpoint="/v1/evaluator-templates"
                json={evaluatorJson}
                onChange={setEvaluatorJson}
                onReset={() => setEvaluatorJson(templateJson("evaluator"))}
                onSubmit={(event) => submitJson(event, "Evaluator", evaluatorJson, createEvaluatorTemplate)}
                submitLabel="Register Evaluator"
                title="Evaluator template"
              />
              <ResourceGrid
                emptyText="No evaluators registered."
                rows={data.evaluatorTemplates.map((evaluator) => ({
                  title: readText(evaluator, ["display_name", "evaluator_id"]) || "Unnamed evaluator",
                  detail: readText(evaluator, ["description", "evaluator_type"]) || "Evaluator template from backend.",
                  meta: joinParts([readText(evaluator, ["scope"]), readText(evaluator, ["evaluator_type"])]),
                }))}
              />
            </div>
          ) : null}

          {tab === "knowledge" ? (
            <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
              <JsonBuilder
                endpoint="/v1/knowledge-bases"
                json={knowledgeJson}
                onChange={setKnowledgeJson}
                onReset={() => setKnowledgeJson(templateJson("knowledge"))}
                onSubmit={(event) => submitJson(event, "Knowledge base", knowledgeJson, createKnowledgeBase)}
                submitLabel="Onboard KB"
                title="Knowledge base"
              />
              <ResourceGrid
                emptyText="No knowledge bases registered."
                rows={data.knowledgeBases.map((kb) => ({
                  title: readText(kb, ["display_name", "kb_id"]) || "Unnamed knowledge base",
                  detail: readText(kb, ["description", "source_type"]) || "Knowledge base from backend.",
                  meta: joinParts([readText(kb, ["environment"]), readText(kb, ["source_type"])]),
                }))}
              />
            </div>
          ) : null}
        </div>
      </div>

      {modalAgent ? (
        <SelectedAgentModal
          agent={modalAgent}
          guardrailPolicies={data.guardrailPolicies}
          knowledgeBases={data.knowledgeBases}
          evaluatorTemplates={data.evaluatorTemplates}
          modalTab={modalTab}
          onClose={() => setModalAgentId(null)}
          onRefresh={onRefresh}
          onTabChange={setModalTab}
          tools={data.tools}
        />
      ) : null}
    </section>
  );
}
