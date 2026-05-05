"use client";

import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { BadgeCheck, Bot, CheckCircle2, Database, Plus, ShieldCheck, Wrench, X } from "lucide-react";
import {
  assignAgentEvaluator,
  assignAgentGuardrail,
  assignAgentKnowledgeBase,
  createAgent,
  deleteAgentEvaluator,
  deleteAgentGuardrail,
  deleteAgentKnowledgeBase,
  evaluateAgent,
  getAgentCertification,
  getSession,
  grantAgentTool,
  listAgentEvaluationRuns,
  listAgentEvaluators,
  listAgentGuardrails,
  listAgentKnowledgeBases,
  listEvaluationCriteriaResults,
  revokeAgentTool,
  type AgentCertification,
  type ApiRecord,
  type CriterionResult,
  type EvaluationRun,
} from "@/lib/api";
import { AgentCertificationPanel } from "./AgentCertificationPanel";
import { ComponentRow } from "./shared";
import type { AgentModalTab } from "./types";
import {
  AGENT_TYPE_VALUES,
  agentDomain,
  agentProfileForm,
  getAgentTools,
  isErrorMessage,
  joinParts,
  readNestedText,
  readText,
  validateAgentType,
  validateLowerToken,
  validateSnakeCase,
  validateVersion,
} from "./utils";

type AssignmentItem = {
  id: string;
  label: string;
  detail?: string;
  meta?: string;
};

const DEFAULT_OLLAMA_JUDGE_MODEL = "qwen3.5:9b";

function toolName(tool: ApiRecord) {
  return readText(tool, ["tool_name", "name", "display_name"]) || "";
}

function displayTool(tool: ApiRecord) {
  return readText(tool, ["display_name", "tool_name", "name"]) || "Tool";
}

function recordId(record: ApiRecord, keys: string[]) {
  return readText(record, keys) || "";
}

const UNSCOPED_DOMAINS = new Set(["", "all", "general", "shared"]);

function asRecord(value: unknown): ApiRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as ApiRecord) : {};
}

function normalizeScope(value: string | undefined) {
  return String(value || "").trim();
}

function normalizeScopeKey(value: string | undefined) {
  return normalizeScope(value).toLowerCase();
}

function recordEnvironment(record: ApiRecord) {
  return normalizeScope(readText(record, ["environment"]));
}

function selectedAgentDomain(agent: ApiRecord) {
  return normalizeScope(agentDomain(agent) || readNestedText(agent, ["permissions", "scopes", "domain"]));
}

function resourceDomain(record: ApiRecord) {
  return normalizeScope(
    readText(record, ["domain"])
      || readNestedText(record, ["metadata", "domain"])
      || readNestedText(record, ["metadata", "data_domain"]),
  );
}

function toolDomain(tool: ApiRecord) {
  return resourceDomain(tool) || normalizeScope(readText(tool, ["category"])) || "general";
}

function domainsMatchAgent(agent: ApiRecord, resourceDomainValue: string) {
  const agentDomainValue = normalizeScopeKey(selectedAgentDomain(agent));
  const resourceDomainKey = normalizeScopeKey(resourceDomainValue);
  return UNSCOPED_DOMAINS.has(agentDomainValue) || UNSCOPED_DOMAINS.has(resourceDomainKey) || agentDomainValue === resourceDomainKey;
}

function environmentMatchesAgent(agent: ApiRecord, record: ApiRecord) {
  const agentEnvironment = recordEnvironment(agent);
  const resourceEnvironment = recordEnvironment(record);
  return !agentEnvironment || !resourceEnvironment || agentEnvironment === resourceEnvironment;
}

function toolMatchesAgent(tool: ApiRecord, agent: ApiRecord) {
  return environmentMatchesAgent(agent, tool) && domainsMatchAgent(agent, toolDomain(tool));
}

function activeKnowledgeVersion(kb: ApiRecord) {
  const publishedVersion = asRecord(kb.published_version);
  if (Object.keys(publishedVersion).length) {
    return publishedVersion;
  }
  const latestVersion = asRecord(kb.latest_version);
  return Object.keys(latestVersion).length ? latestVersion : {};
}

function knowledgeScope(kb: ApiRecord) {
  const sourceConfig = asRecord(kb.source_config);
  const version = activeKnowledgeVersion(kb);
  const scope =
    normalizeScope(readText(version, ["kb_scope"]))
    || normalizeScope(readText(sourceConfig, ["kb_scope"]))
    || (resourceDomain(kb) ? "domain" : "shared");
  const scopeRef =
    normalizeScope(readText(version, ["scope_ref"]))
    || normalizeScope(readText(sourceConfig, ["scope_ref", "linked_agent_id"]))
    || resourceDomain(kb);

  return { scope, scopeRef };
}

function knowledgeBaseMatchesAgent(kb: ApiRecord, agent: ApiRecord) {
  if (!environmentMatchesAgent(agent, kb)) {
    return false;
  }

  const { scope, scopeRef } = knowledgeScope(kb);
  const scopeKey = normalizeScopeKey(scope);
  if (scopeKey === "shared") {
    return true;
  }
  if (scopeKey === "agent") {
    return !scopeRef || scopeRef === readText(agent, ["agent_id"]);
  }
  return domainsMatchAgent(agent, scopeRef || resourceDomain(kb));
}

function evaluatorAssignmentMeta(assignment: ApiRecord) {
  const config = asRecord(assignment.config);
  const judgeConfig = asRecord(config.judge);
  const judgeModel = readText(judgeConfig, ["model"]);
  const judgeProvider = readText(judgeConfig, ["provider"]) || "judge";
  return joinParts([
    readText(assignment, ["environment"]),
    judgeModel ? `${judgeProvider} ${judgeModel}` : undefined,
  ]);
}

export function SelectedAgentModal({
  agent,
  evaluatorTemplates,
  guardrailPolicies,
  knowledgeBases,
  modalTab,
  onClose,
  onRefresh,
  onTabChange,
  tools,
}: {
  agent: ApiRecord;
  evaluatorTemplates: ApiRecord[];
  guardrailPolicies: ApiRecord[];
  knowledgeBases: ApiRecord[];
  modalTab: AgentModalTab;
  onClose: () => void;
  onRefresh: () => void | Promise<void>;
  onTabChange: (tab: AgentModalTab) => void;
  tools: ApiRecord[];
}) {
  const [form, setForm] = useState(() => agentProfileForm(agent));
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [showVaultFields, setShowVaultFields] = useState(false);
  const [toolGrants, setToolGrants] = useState<string[]>(() => getAgentTools(agent));
  const [guardrailAssignments, setGuardrailAssignments] = useState<ApiRecord[]>([]);
  const [evaluatorAssignments, setEvaluatorAssignments] = useState<ApiRecord[]>([]);
  const [knowledgeAssignments, setKnowledgeAssignments] = useState<ApiRecord[]>([]);
  const [certification, setCertification] = useState<AgentCertification | null>(null);
  const [certRuns, setCertRuns] = useState<EvaluationRun[]>([]);
  const [certCriteria, setCertCriteria] = useState<CriterionResult[]>([]);
  const [evaluating, setEvaluating] = useState(false);
  const [selectedTool, setSelectedTool] = useState("");
  const [selectedPolicyId, setSelectedPolicyId] = useState("");
  const [guardrailMode, setGuardrailMode] = useState("enforce");
  const [selectedEvaluatorId, setSelectedEvaluatorId] = useState("");
  const [evaluatorTrigger, setEvaluatorTrigger] = useState("after_run");
  const [evaluatorJudgeProvider, setEvaluatorJudgeProvider] = useState("ollama");
  const [evaluatorJudgeModel, setEvaluatorJudgeModel] = useState(DEFAULT_OLLAMA_JUDGE_MODEL);
  const [evaluatorJudgeBaseUrl, setEvaluatorJudgeBaseUrl] = useState("");
  const [selectedKbId, setSelectedKbId] = useState("");
  const [kbAccessMode, setKbAccessMode] = useState("read");
  const [kbRetrievalMode, setKbRetrievalMode] = useState("hybrid");
  const [kbTopK, setKbTopK] = useState(5);
  const [kbCitationRequired, setKbCitationRequired] = useState(true);
  const agentId = String(agent.agent_id || "");

  const toolOptions = useMemo(
    () =>
      tools
        .filter((tool) => toolMatchesAgent(tool, agent))
        .map((tool) => {
          const status = readNestedText(tool, ["certification", "status"]) || "DRAFT";
          return { id: toolName(tool), label: `${displayTool(tool)} (${status})` };
        })
        .filter((tool) => tool.id),
    [agent, tools],
  );
  const availableTools = toolOptions.filter((tool) => !toolGrants.includes(tool.id));
  const availablePolicies = guardrailPolicies.filter(
    (policy) => !guardrailAssignments.some((assignment) => readText(assignment, ["policy_id"]) === readText(policy, ["policy_id"])),
  );
  const availableEvaluators = evaluatorTemplates.filter(
    (template) =>
      !evaluatorAssignments.some((assignment) => readText(assignment, ["evaluator_id"]) === readText(template, ["evaluator_id"])),
  );
  const availableKnowledgeBases = knowledgeBases.filter(
    (kb) =>
      knowledgeBaseMatchesAgent(kb, agent)
      && !knowledgeAssignments.some((assignment) => readText(assignment, ["kb_id"]) === readText(kb, ["kb_id"])),
  );
  const selectedEvaluatorTemplate = useMemo(
    () =>
      evaluatorTemplates.find((template) => readText(template, ["evaluator_id"]) === selectedEvaluatorId)
      ?? ({} as ApiRecord),
    [evaluatorTemplates, selectedEvaluatorId],
  );
  const selectedEvaluatorIsJudge = Boolean(
    selectedEvaluatorId
      && (
        selectedEvaluatorTemplate.llm_enabled === true
        || readNestedText(selectedEvaluatorTemplate, ["llm_enabled"]) === "true"
        || readText(selectedEvaluatorTemplate, ["evaluator_type"]) === "response_quality"
      ),
  );

  useEffect(() => {
    setForm(agentProfileForm(agent));
    setMessage("");
    setShowVaultFields(false);
    setToolGrants(getAgentTools(agent));
  }, [agent]);

  useEffect(() => {
    let active = true;

    async function loadAssignments() {
      const session = getSession();
      if (!session?.token || !agentId) {
        return;
      }

      const [guardrails, evaluators, knowledge] = await Promise.all([
        listAgentGuardrails(session.token, agentId).catch(() => []),
        listAgentEvaluators(session.token, agentId).catch(() => []),
        listAgentKnowledgeBases(session.token, agentId).catch(() => []),
      ]);

      if (!active) {
        return;
      }

      setGuardrailAssignments(guardrails);
      setEvaluatorAssignments(evaluators);
      setKnowledgeAssignments(knowledge);
    }

    loadAssignments();

    return () => {
      active = false;
    };
  }, [agentId]);

  useEffect(() => {
    let active = true;

    async function loadCertification() {
      const session = getSession();
      if (!session?.token || !agentId) {
        return;
      }

      const [cert, runs] = await Promise.all([
        getAgentCertification(session.token, agentId).catch(() => null),
        listAgentEvaluationRuns(session.token, agentId).catch(() => []),
      ]);
      const criteria = runs[0]?.run_id
        ? await listEvaluationCriteriaResults(session.token, runs[0].run_id).catch(() => [])
        : [];

      if (!active) {
        return;
      }

      setCertification(cert);
      setCertRuns(runs);
      setCertCriteria(criteria);
    }

    loadCertification();

    return () => {
      active = false;
    };
  }, [agentId]);

  useEffect(() => {
    if (!availableTools.some((tool) => tool.id === selectedTool)) {
      setSelectedTool(availableTools[0]?.id || "");
    }
  }, [availableTools, selectedTool]);

  useEffect(() => {
    if (!availablePolicies.some((policy) => readText(policy, ["policy_id"]) === selectedPolicyId)) {
      setSelectedPolicyId(readText(availablePolicies[0] || {}, ["policy_id"]) || "");
    }
  }, [availablePolicies, selectedPolicyId]);

  useEffect(() => {
    if (!availableEvaluators.some((evaluator) => readText(evaluator, ["evaluator_id"]) === selectedEvaluatorId)) {
      setSelectedEvaluatorId(readText(availableEvaluators[0] || {}, ["evaluator_id"]) || "");
    }
  }, [availableEvaluators, selectedEvaluatorId]);

  useEffect(() => {
    if (!selectedEvaluatorId || !selectedEvaluatorIsJudge) {
      setEvaluatorJudgeProvider("ollama");
      setEvaluatorJudgeModel(DEFAULT_OLLAMA_JUDGE_MODEL);
      setEvaluatorJudgeBaseUrl("");
      return;
    }

    const defaultConfig = asRecord(selectedEvaluatorTemplate.default_config);
    const judgeConfig = asRecord(defaultConfig.judge);
    setEvaluatorJudgeProvider(readText(judgeConfig, ["provider"]) || "ollama");
    setEvaluatorJudgeModel(readText(judgeConfig, ["model"]) || DEFAULT_OLLAMA_JUDGE_MODEL);
    setEvaluatorJudgeBaseUrl(readText(judgeConfig, ["base_url", "endpoint"]) || "");
  }, [selectedEvaluatorId, selectedEvaluatorIsJudge, selectedEvaluatorTemplate]);

  useEffect(() => {
    if (!availableKnowledgeBases.some((kb) => readText(kb, ["kb_id"]) === selectedKbId)) {
      setSelectedKbId(readText(availableKnowledgeBases[0] || {}, ["kb_id"]) || "");
    }
  }, [availableKnowledgeBases, selectedKbId]);

  async function refreshAssignments() {
    const session = getSession();
    if (!session?.token || !agentId) {
      return;
    }

    const [guardrails, evaluators, knowledge] = await Promise.all([
      listAgentGuardrails(session.token, agentId),
      listAgentEvaluators(session.token, agentId),
      listAgentKnowledgeBases(session.token, agentId).catch(() => []),
    ]);
    setGuardrailAssignments(guardrails);
    setEvaluatorAssignments(evaluators);
    setKnowledgeAssignments(knowledge);
  }

  async function refreshCertification() {
    const session = getSession();
    if (!session?.token || !agentId) {
      return;
    }

    const [cert, runs] = await Promise.all([
      getAgentCertification(session.token, agentId).catch(() => null),
      listAgentEvaluationRuns(session.token, agentId).catch(() => []),
    ]);
    const criteria = runs[0]?.run_id
      ? await listEvaluationCriteriaResults(session.token, runs[0].run_id).catch(() => [])
      : [];
    setCertification(cert);
    setCertRuns(runs);
    setCertCriteria(criteria);
  }

  async function runAction(action: (token: string) => Promise<void>, success: string) {
    setMessage("");
    const session = getSession();
    if (!session?.token) {
      setMessage("Session expired. Login again before changing this agent.");
      return;
    }

    setLoading(true);
    try {
      await action(session.token);
      setMessage(success);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to update this agent.");
    } finally {
      setLoading(false);
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await runAction(async (token) => {
      const validationError =
        validateLowerToken(form.environment, "Environment")
        || validateSnakeCase(form.domain, "Domain")
        || validateAgentType(form.agent_type)
        || validateVersion(form.version);
      if (validationError) {
        throw new Error(validationError);
      }

      let metadata: Record<string, unknown>;
      try {
        metadata = JSON.parse(form.metadata || "{}") as Record<string, unknown>;
      } catch {
        throw new Error("Metadata JSON must be valid.");
      }

      const currentLlm = metadata.llm && typeof metadata.llm === "object" && !Array.isArray(metadata.llm)
        ? (metadata.llm as Record<string, unknown>)
        : {};
      const currentVault = currentLlm.hashicorp_vault && typeof currentLlm.hashicorp_vault === "object" && !Array.isArray(currentLlm.hashicorp_vault)
        ? (currentLlm.hashicorp_vault as Record<string, unknown>)
        : undefined;
      const vaultUsername = form.vault_username.trim();
      const vaultApiKey = form.vault_api_key.trim();
      const hashicorpVault = showVaultFields
        ? vaultUsername || vaultApiKey
          ? { username: vaultUsername, api_key: vaultApiKey }
          : undefined
        : currentVault;

      metadata = {
        ...metadata,
        domain: form.domain.trim() || "general",
        data_domain: form.domain.trim() || "general",
        version: form.version.trim() || "1.0.0",
        llm: {
          gateway_endpoint: form.llm_gateway_endpoint.trim() || "/llm/v1",
          model: form.llm_model.trim() || "local/default-9b",
          ...(hashicorpVault ? { hashicorp_vault: hashicorpVault } : {}),
        },
      };

      await createAgent(token, {
        ...agent,
        display_name: form.display_name,
        owner: form.owner,
        environment: form.environment,
        agent_type: form.agent_type,
        purpose: form.purpose,
        metadata,
      });
      setForm((current) => ({ ...current, metadata: JSON.stringify(metadata, null, 2) }));
      await Promise.resolve(onRefresh());
    }, "Profile saved.");
  }

  async function attachTool(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTool) {
      setMessage("Select a tool before attaching it.");
      return;
    }

    await runAction(async (token) => {
      await grantAgentTool(token, agentId, selectedTool);
      setToolGrants((current) => Array.from(new Set([...current, selectedTool])));
      await Promise.resolve(onRefresh());
    }, "Tool attached.");
  }

  async function revokeToolGrant(tool: string) {
    const confirmed = window.confirm(`Remove tool "${tool}" from this agent?`);
    if (!confirmed) {
      return;
    }

    await runAction(async (token) => {
      await revokeAgentTool(token, agentId, tool);
      setToolGrants((current) => current.filter((item) => item !== tool));
      await Promise.resolve(onRefresh());
    }, "Tool removed.");
  }

  async function attachGuardrail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedPolicyId) {
      setMessage("Select a guardrail before attaching it.");
      return;
    }

    await runAction(async (token) => {
      await assignAgentGuardrail(token, agentId, {
        policy_id: selectedPolicyId,
        mode: guardrailMode,
        threshold_overrides: {},
      });
      await refreshAssignments();
    }, "Guardrail attached.");
  }

  async function attachEvaluator(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedEvaluatorId) {
      setMessage("Select an evaluator before attaching it.");
      return;
    }

    await runAction(async (token) => {
      const evaluatorConfig = selectedEvaluatorIsJudge
        ? {
            judge: {
              provider: evaluatorJudgeProvider.trim() || "ollama",
              model: evaluatorJudgeModel.trim() || DEFAULT_OLLAMA_JUDGE_MODEL,
              ...(evaluatorJudgeBaseUrl.trim() ? { base_url: evaluatorJudgeBaseUrl.trim() } : {}),
            },
          }
        : {};

      await assignAgentEvaluator(token, agentId, {
        evaluator_id: selectedEvaluatorId,
        trigger: evaluatorTrigger,
        config: evaluatorConfig,
      });
      await refreshAssignments();
    }, "Evaluator attached.");
  }

  async function attachKnowledge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedKbId) {
      setMessage("Select a knowledge base before attaching it.");
      return;
    }

    await runAction(async (token) => {
      await assignAgentKnowledgeBase(token, agentId, {
        kb_id: selectedKbId,
        access_mode: kbAccessMode,
        retrieval_mode: kbRetrievalMode,
        top_k: kbTopK,
        citation_required: kbCitationRequired,
        metadata_filters: {},
      });
      await refreshAssignments();
    }, "Knowledge base attached.");
  }

  async function removeAssignment(kind: "guardrail" | "evaluator" | "knowledge", assignmentId: string, label: string) {
    const confirmed = window.confirm(`Remove ${label} from this agent?`);
    if (!confirmed) {
      return;
    }

    await runAction(async (token) => {
      if (kind === "guardrail") {
        await deleteAgentGuardrail(token, agentId, assignmentId);
      } else if (kind === "evaluator") {
        await deleteAgentEvaluator(token, agentId, assignmentId);
      } else {
        await deleteAgentKnowledgeBase(token, agentId, assignmentId);
      }

      await refreshAssignments();
    }, `${label} removed.`);
  }

  async function runAgentCertificationEvaluation() {
    setMessage("");
    const session = getSession();
    if (!session?.token) {
      setMessage("Session expired. Login again before evaluating this agent.");
      return;
    }

    setEvaluating(true);
    try {
      await evaluateAgent(session.token, agentId);
      setMessage("Agent evaluation completed.");
      await refreshCertification();
      await Promise.resolve(onRefresh());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to evaluate this agent.");
    } finally {
      setEvaluating(false);
    }
  }

  const tabs = [
    { id: "profile" as const, label: "Profile", icon: Bot, count: undefined },
    { id: "tools" as const, label: "Tools", icon: Wrench, count: toolGrants.length },
    { id: "guardrails" as const, label: "Guardrails", icon: ShieldCheck, count: guardrailAssignments.length },
    { id: "evaluators" as const, label: "Evaluators", icon: CheckCircle2, count: evaluatorAssignments.length },
    { id: "knowledge" as const, label: "Knowledge", icon: Database, count: knowledgeAssignments.length },
    { id: "certification" as const, label: "Certification", icon: BadgeCheck, count: undefined },
  ];

  const guardrailItems: AssignmentItem[] = guardrailAssignments.map((assignment) => ({
    id: recordId(assignment, ["assignment_id"]),
    label: readText(assignment, ["policy_id"]) || "Guardrail",
    detail: readText(assignment, ["mode"]) || "Attached guardrail",
    meta: readText(assignment, ["environment"]),
  }));
  const evaluatorItems: AssignmentItem[] = evaluatorAssignments.map((assignment) => ({
    id: recordId(assignment, ["assignment_id"]),
    label: readText(assignment, ["evaluator_id"]) || "Evaluator",
    detail: readText(assignment, ["trigger"]) || "Attached evaluator",
    meta: evaluatorAssignmentMeta(assignment),
  }));
  const knowledgeItems: AssignmentItem[] = knowledgeAssignments.map((assignment) => ({
    id: recordId(assignment, ["assignment_id"]),
    label: readText(assignment, ["kb_id"]) || "Knowledge base",
    detail: joinParts([
      readText(assignment, ["access_mode"]),
      readText(assignment, ["retrieval_mode"]),
      readText(assignment, ["top_k"]) ? `top ${readText(assignment, ["top_k"])}` : undefined,
      assignment.citation_required === true || readText(assignment, ["citation_required"]) === "true"
        ? "citations required"
        : "citations optional",
    ]) || "Attached knowledge base",
    meta: readText(assignment, ["environment"]),
  }));

  return (
    <div
      className="fixed inset-0 z-[80] grid place-items-center bg-black/55 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      data-testid="selected-agent-modal"
    >
      <div className="max-h-[92vh] w-full max-w-7xl overflow-hidden rounded-3xl border border-line bg-panel text-textPrimary shadow-[0_30px_120px_rgba(0,0,0,0.45)]">
        <div className="flex items-start justify-between gap-4 border-b border-line p-5">
          <div>
            <span className="text-xs font-semibold uppercase tracking-[0.22em] text-accent">Selected Agent</span>
            <h2 className="mt-2 text-4xl font-semibold tracking-[-0.03em]">
              {readText(agent, ["display_name", "agent_id"])}
            </h2>
            <p className="text-sm text-textSecondary">{readText(agent, ["agent_id"])}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-line bg-white/[0.05] px-4 py-2 text-sm font-semibold text-textSecondary">
              {readText(agent, ["environment"])}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="grid h-12 w-12 place-items-center rounded-2xl border border-line bg-white/[0.05] transition hover:border-accent/45 hover:bg-accent/10"
              aria-label="Close selected agent"
            >
              <X size={21} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="max-h-[calc(92vh-130px)] overflow-auto">
          <div className="sticky top-0 z-10 border-b border-line bg-panel/95 px-5 py-4 backdrop-blur-xl">
            <div className="flex gap-2 overflow-x-auto pb-1">
              {tabs.map((tab) => {
                const Icon = tab.icon;

                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => onTabChange(tab.id)}
                    className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition ${
                      modalTab === tab.id
                        ? "border-accent/45 bg-accent text-ink"
                        : "border-line bg-white/[0.04] text-textPrimary hover:border-accent/45 hover:bg-accent/10"
                    }`}
                  >
                    <span className="inline-flex items-center gap-2">
                      <Icon size={16} aria-hidden="true" />
                      {tab.label}
                    </span>
                    {typeof tab.count === "number" ? (
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${
                          modalTab === tab.id ? "bg-ink/10 text-ink/75" : "bg-white/[0.06] text-textSecondary"
                        }`}
                      >
                        {tab.count}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>

          <section className="p-5">
            {message ? (
              <div
                className={`mb-4 rounded-2xl border p-3 text-sm ${
                  isErrorMessage(message)
                    ? "border-red-400/45 bg-red-500/10 text-red-200"
                    : "border-line bg-white/[0.04] text-textSecondary"
                }`}
              >
                {message}
              </div>
            ) : null}

            {modalTab === "profile" ? (
              <form className="grid gap-4" onSubmit={saveProfile}>
                <div className="grid gap-4 md:grid-cols-2">
                  <BuilderField label="Agent ID">
                    <input
                      className="field-input cursor-not-allowed border-line/70 bg-white/[0.025] text-textSecondary opacity-70"
                      value={form.agent_id}
                      readOnly
                      aria-readonly="true"
                    />
                  </BuilderField>
                  <BuilderField label="Display Name">
                    <input
                      className="field-input"
                      value={form.display_name}
                      onChange={(event) => setForm({ ...form, display_name: event.target.value })}
                    />
                  </BuilderField>
                  <BuilderField label="Owner">
                    <input
                      className="field-input"
                      value={form.owner}
                      onChange={(event) => setForm({ ...form, owner: event.target.value })}
                    />
                  </BuilderField>
                  <BuilderField label="Environment">
                    <input
                      className="field-input"
                      value={form.environment}
                      onChange={(event) => setForm({ ...form, environment: event.target.value })}
                    />
                  </BuilderField>
                  <BuilderField label="Domain">
                    <input
                      className="field-input"
                      value={form.domain}
                      onChange={(event) => setForm({ ...form, domain: event.target.value })}
                    />
                  </BuilderField>
                  <BuilderField label="Agent Type">
                    <select
                      className="field-input"
                      value={form.agent_type}
                      onChange={(event) => setForm({ ...form, agent_type: event.target.value })}
                    >
                      {AGENT_TYPE_VALUES.map((agentType) => (
                        <option key={agentType} value={agentType}>
                          {agentType}
                        </option>
                      ))}
                    </select>
                  </BuilderField>
                  <BuilderField label="Agent Version">
                    <input
                      className="field-input"
                      value={form.version}
                      onChange={(event) => setForm({ ...form, version: event.target.value })}
                    />
                  </BuilderField>
                </div>

                <BuilderField label="Purpose">
                  <textarea
                    className="field-input min-h-28 resize-y"
                    value={form.purpose}
                    onChange={(event) => setForm({ ...form, purpose: event.target.value })}
                  />
                </BuilderField>

                <div className="grid gap-4 rounded-3xl border border-line bg-white/[0.035] p-4 md:grid-cols-2">
                  <div className="flex flex-wrap items-center justify-between gap-3 md:col-span-2">
                    <h3 className="text-lg font-semibold">LLM</h3>
                    <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-semibold text-textSecondary">
                      <input
                        type="checkbox"
                        checked={showVaultFields}
                        onChange={(event) => setShowVaultFields(event.target.checked)}
                        className="h-4 w-4 accent-[rgb(var(--color-accent))]"
                      />
                      HashiCorp Vault
                    </label>
                  </div>
                  <BuilderField label="Gateway Endpoint">
                    <input
                      className="field-input"
                      value={form.llm_gateway_endpoint}
                      onChange={(event) => setForm({ ...form, llm_gateway_endpoint: event.target.value })}
                    />
                  </BuilderField>
                  <BuilderField label="Model">
                    <input
                      className="field-input"
                      value={form.llm_model}
                      onChange={(event) => setForm({ ...form, llm_model: event.target.value })}
                    />
                  </BuilderField>
                  {showVaultFields ? (
                    <>
                      <BuilderField label="Vault User Name">
                        <input
                          className="field-input"
                          value={form.vault_username}
                          onChange={(event) => setForm({ ...form, vault_username: event.target.value })}
                        />
                      </BuilderField>
                      <BuilderField label="Vault API Key">
                        <input
                          className="field-input"
                          type="password"
                          value={form.vault_api_key}
                          onChange={(event) => setForm({ ...form, vault_api_key: event.target.value })}
                        />
                      </BuilderField>
                    </>
                  ) : null}
                </div>

                <BuilderField label="Metadata JSON">
                  <textarea
                    className="field-input min-h-48 resize-y font-mono text-xs"
                    spellCheck={false}
                    value={form.metadata}
                    onChange={(event) => setForm({ ...form, metadata: event.target.value })}
                  />
                </BuilderField>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-fit rounded-full bg-accent px-5 py-3 text-sm font-semibold text-ink transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? "Saving..." : "Save Profile"}
                </button>
              </form>
            ) : null}

            {modalTab === "tools" ? (
              <AttachmentPanel
                emptyText="No tools attached."
                items={toolGrants.map((tool) => ({ id: tool, label: tool, detail: "Attached tool grant." }))}
                onRemove={(item) => revokeToolGrant(item.id)}
                title="Attach tool"
              >
                <form className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]" onSubmit={attachTool}>
                  <select className="field-input" value={selectedTool} onChange={(event) => setSelectedTool(event.target.value)}>
                    {availableTools.map((tool) => (
                      <option key={tool.id} value={tool.id}>
                        {tool.label}
                      </option>
                    ))}
                    {!availableTools.length ? <option value="">No tools available</option> : null}
                  </select>
                  <AttachButton disabled={loading || !selectedTool} />
                </form>
              </AttachmentPanel>
            ) : null}

            {modalTab === "guardrails" ? (
              <AttachmentPanel
                emptyText="No guardrails attached."
                items={guardrailItems}
                onRemove={(item) => removeAssignment("guardrail", item.id, item.label)}
                title="Attach guardrail policy"
              >
                <form className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_auto]" onSubmit={attachGuardrail}>
                  <select className="field-input" value={selectedPolicyId} onChange={(event) => setSelectedPolicyId(event.target.value)}>
                    {availablePolicies.map((policy) => (
                      <option key={readText(policy, ["policy_id"])} value={readText(policy, ["policy_id"])}>
                        {readText(policy, ["display_name", "policy_id"])}
                      </option>
                    ))}
                    {!availablePolicies.length ? <option value="">No guardrails available</option> : null}
                  </select>
                  <select className="field-input" value={guardrailMode} onChange={(event) => setGuardrailMode(event.target.value)}>
                    <option value="enforce">enforce</option>
                    <option value="review_only">review_only</option>
                    <option value="disabled">disabled</option>
                  </select>
                  <AttachButton disabled={loading || !selectedPolicyId} />
                </form>
              </AttachmentPanel>
            ) : null}

            {modalTab === "evaluators" ? (
              <AttachmentPanel
                emptyText="No evaluators attached."
                items={evaluatorItems}
                onRemove={(item) => removeAssignment("evaluator", item.id, item.label)}
                title="Attach evaluator"
              >
                <form className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1.2fr)_160px_160px_minmax(0,1fr)_minmax(0,1fr)_auto]" onSubmit={attachEvaluator}>
                  <BuilderField label="Evaluator">
                    <select className="field-input" value={selectedEvaluatorId} onChange={(event) => setSelectedEvaluatorId(event.target.value)}>
                      {availableEvaluators.map((evaluator) => (
                        <option key={readText(evaluator, ["evaluator_id"])} value={readText(evaluator, ["evaluator_id"])}>
                          {readText(evaluator, ["display_name", "evaluator_id"])}
                        </option>
                      ))}
                      {!availableEvaluators.length ? <option value="">No evaluators available</option> : null}
                    </select>
                  </BuilderField>
                  <BuilderField label="Trigger">
                    <select className="field-input" value={evaluatorTrigger} onChange={(event) => setEvaluatorTrigger(event.target.value)}>
                      <option value="after_run">after_run</option>
                      <option value="after_workflow">after_workflow</option>
                      <option value="manual">manual</option>
                    </select>
                  </BuilderField>
                  {selectedEvaluatorIsJudge ? (
                    <>
                      <BuilderField label="Judge Provider">
                        <select className="field-input" value={evaluatorJudgeProvider} onChange={(event) => setEvaluatorJudgeProvider(event.target.value)}>
                          <option value="ollama">Ollama</option>
                          <option value="openai_compatible">OpenAI compatible</option>
                        </select>
                      </BuilderField>
                      <BuilderField label="Judge Model">
                        <input
                          className="field-input"
                          value={evaluatorJudgeModel}
                          onChange={(event) => setEvaluatorJudgeModel(event.target.value)}
                          placeholder={DEFAULT_OLLAMA_JUDGE_MODEL}
                        />
                      </BuilderField>
                      <BuilderField label="Judge Base URL">
                        <input
                          className="field-input"
                          value={evaluatorJudgeBaseUrl}
                          onChange={(event) => setEvaluatorJudgeBaseUrl(event.target.value)}
                          placeholder="http://host.docker.internal:11434"
                        />
                      </BuilderField>
                    </>
                  ) : null}
                  <div className="self-end">
                    <AttachButton disabled={loading || !selectedEvaluatorId || (selectedEvaluatorIsJudge && !evaluatorJudgeModel.trim())} />
                  </div>
                </form>
              </AttachmentPanel>
            ) : null}

            {modalTab === "knowledge" ? (
              <AttachmentPanel
                emptyText="No knowledge bases attached."
                items={knowledgeItems}
                onRemove={(item) => removeAssignment("knowledge", item.id, item.label)}
                title="Attach knowledge base"
              >
                <form className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_150px_150px_110px_150px_auto]" onSubmit={attachKnowledge}>
                  <BuilderField label="Knowledge Base">
                    <select className="field-input" value={selectedKbId} onChange={(event) => setSelectedKbId(event.target.value)}>
                      {availableKnowledgeBases.map((kb) => (
                        <option key={readText(kb, ["kb_id"])} value={readText(kb, ["kb_id"])}>
                          {readText(kb, ["display_name", "kb_id"])}
                        </option>
                      ))}
                      {!availableKnowledgeBases.length ? <option value="">No knowledge bases available</option> : null}
                    </select>
                  </BuilderField>
                  <BuilderField label="Access">
                    <select className="field-input" value={kbAccessMode} onChange={(event) => setKbAccessMode(event.target.value)}>
                      <option value="read">read</option>
                      <option value="read_write">read_write</option>
                    </select>
                  </BuilderField>
                  <BuilderField label="Retrieval">
                    <select className="field-input" value={kbRetrievalMode} onChange={(event) => setKbRetrievalMode(event.target.value)}>
                      <option value="hybrid">hybrid</option>
                      <option value="semantic">semantic</option>
                      <option value="keyword">keyword</option>
                    </select>
                  </BuilderField>
                  <BuilderField label="Top K">
                    <input
                      className="field-input"
                      type="number"
                      min={1}
                      max={50}
                      value={kbTopK}
                      onChange={(event) => setKbTopK(Math.min(50, Math.max(1, Number(event.target.value) || 1)))}
                    />
                  </BuilderField>
                  <label className="mt-auto inline-flex min-h-11 items-center gap-2 rounded-2xl border border-line bg-white/[0.035] px-4 py-3 text-sm font-semibold text-textSecondary">
                    <input
                      type="checkbox"
                      checked={kbCitationRequired}
                      onChange={(event) => setKbCitationRequired(event.target.checked)}
                    />
                    citations
                  </label>
                  <div className="mt-auto">
                    <AttachButton disabled={loading || !selectedKbId} />
                  </div>
                </form>
              </AttachmentPanel>
            ) : null}

            {modalTab === "certification" ? (
              <AgentCertificationPanel
                certification={certification}
                criteria={certCriteria}
                evaluating={evaluating}
                onEvaluate={runAgentCertificationEvaluation}
                runs={certRuns}
              />
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}

function BuilderField({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-textSecondary">
      {label}
      {children}
    </label>
  );
}

function AttachButton({ disabled }: { disabled: boolean }) {
  return (
    <button
      type="submit"
      disabled={disabled}
      className="inline-flex items-center justify-center gap-2 rounded-full bg-accent px-5 py-3 text-sm font-semibold text-ink transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <Plus size={16} aria-hidden="true" />
      Attach
    </button>
  );
}

function AttachmentPanel({
  children,
  emptyText,
  items,
  onRemove,
  title,
}: {
  children: React.ReactNode;
  emptyText: string;
  items: AssignmentItem[];
  onRemove: (item: AssignmentItem) => void;
  title: string;
}) {
  return (
    <section className="grid gap-4">
      <div className="rounded-3xl border border-line bg-white/[0.035] p-4">
        <h3 className="text-lg font-semibold">{title}</h3>
        <div className="mt-4">{children}</div>
      </div>
      <div className="grid gap-3">
        {items.length ? (
          items.map((item) => (
            <div
              key={item.id}
              className="grid gap-3 rounded-2xl border border-line bg-white/[0.035] p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
            >
              <div>
                <p className="font-semibold text-textPrimary">{item.label}</p>
                <p className="mt-1 text-sm text-textSecondary">{joinParts([item.detail, item.meta]) || "Attached source."}</p>
              </div>
              <button
                type="button"
                onClick={() => onRemove(item)}
                className="grid h-9 w-9 place-items-center rounded-xl border border-rose-300/35 bg-rose-300/10 text-textPrimary transition hover:border-rose-300/60 hover:bg-rose-300/15"
                aria-label={`Remove ${item.label}`}
                title={`Remove ${item.label}`}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          ))
        ) : (
          <ComponentRow title="No attached sources" detail={emptyText} />
        )}
      </div>
    </section>
  );
}
