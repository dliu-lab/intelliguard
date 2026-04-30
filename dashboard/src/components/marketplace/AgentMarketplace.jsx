import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ClipboardCheck,
  Database,
  FileJson,
  Plus,
  Search,
  ShieldCheck,
  UploadCloud,
  Wrench,
  X,
} from "lucide-react";
import { api } from "../../lib/api";
import { userCan } from "../../lib/permissions";
import AgentGovernanceCard from "./AgentGovernanceCard";

const defaultLlmConfig = {
  gateway: "unified",
  endpoint: "/llm/v1",
  model: "local/default-9b",
  temperature: 0.2,
};

function profileFormFor(agent) {
  const llm = agent?.metadata?.llm || {};
  return {
    display_name: agent?.display_name || "",
    owner: agent?.owner || "",
    environment: agent?.environment || "",
    agent_type: agent?.agent_type || "",
    purpose: agent?.purpose || "",
    llm_gateway: llm.gateway || defaultLlmConfig.gateway,
    llm_endpoint: llm.endpoint || defaultLlmConfig.endpoint,
    llm_model: llm.model || defaultLlmConfig.model,
    llm_temperature: String(llm.temperature ?? defaultLlmConfig.temperature),
    metadata: JSON.stringify(agent?.metadata || {}, null, 2),
  };
}

async function fetchAgentAssignmentSummary(agentId) {
  const [guardrails, evaluators, knowledge] = await Promise.all([
    api.agentGuardrails(agentId).catch(() => []),
    api.agentEvaluators(agentId).catch(() => []),
    api.agentKBs(agentId).catch(() => []),
  ]);

  return {
    guardrails: guardrails.length,
    evaluators: evaluators.length,
    knowledge: knowledge.length,
  };
}

export default function AgentMarketplace({
  agents,
  tools,
  currentUser,
  selectedEnvironment,
  environments,
  selectedAgentId,
  agentJson,
  guardrailPolicies,
  evaluatorTemplates,
  knowledgeBases = [],
  canCreateAgent,
  onCreateAgent,
  onUpdateAgent,
  onSetAgentJson,
  onSetSelectedAgentId,
  onLoadJsonFile,
  onUseTemplate,
  onGrantTool,
  onRevokeTool,
  onAssignGuardrail,
  onDeleteGuardrail,
  onAssignEvaluator,
  onDeleteEvaluator,
  onAssignKB,
  onDeleteKBAssignment,
  onDeleteAgent,
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [creationMode, setCreationMode] = useState(null); // null | "template" | "upload"
  const [modalAgentId, setModalAgentId] = useState(null);
  const [assignmentSummary, setAssignmentSummary] = useState({});
  const fileInputRef = useRef(null);

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.agent_id === selectedAgentId) || agents[0] || null,
    [agents, selectedAgentId],
  );
  const modalAgent = useMemo(
    () => agents.find((agent) => agent.agent_id === modalAgentId) || null,
    [agents, modalAgentId],
  );

  useEffect(() => {
    if (selectedAgent && selectedAgent.agent_id !== selectedAgentId) {
      onSetSelectedAgentId(selectedAgent.agent_id);
    }
  }, [onSetSelectedAgentId, selectedAgent, selectedAgentId]);

  useEffect(() => {
    if (modalAgentId && !modalAgent) {
      setModalAgentId(null);
    }
  }, [modalAgent, modalAgentId]);

  useEffect(() => {
    let active = true;

    if (!agents.length) {
      setAssignmentSummary({});
      return () => { active = false; };
    }

    Promise.all(
      agents.map(async (agent) => [
        agent.agent_id,
        await fetchAgentAssignmentSummary(agent.agent_id),
      ]),
    ).then((entries) => {
      if (active) {
        setAssignmentSummary(Object.fromEntries(entries));
      }
    });

    return () => { active = false; };
  }, [agents]);

  function openAgentModal(agentId) {
    onSetSelectedAgentId(agentId);
    setModalAgentId(agentId);
  }

  async function refreshAssignmentSummary(agentId) {
    const nextSummary = await fetchAgentAssignmentSummary(agentId);
    setAssignmentSummary((current) => ({
      ...current,
      [agentId]: nextSummary,
    }));
  }

  async function handleAssignGuardrail(agentId, payload) {
    await onAssignGuardrail(agentId, payload);
    await refreshAssignmentSummary(agentId);
  }

  async function handleDeleteGuardrail(agentId, assignmentId) {
    await onDeleteGuardrail(agentId, assignmentId);
    await refreshAssignmentSummary(agentId);
  }

  async function handleAssignEvaluator(agentId, payload) {
    await onAssignEvaluator(agentId, payload);
    await refreshAssignmentSummary(agentId);
  }

  async function handleDeleteEvaluator(agentId, assignmentId) {
    await onDeleteEvaluator(agentId, assignmentId);
    await refreshAssignmentSummary(agentId);
  }

  async function handleAssignKB(agentId, payload) {
    await onAssignKB(agentId, payload);
    await refreshAssignmentSummary(agentId);
  }

  async function handleDeleteKBAssignment(agentId, assignmentId) {
    await onDeleteKBAssignment(agentId, assignmentId);
    await refreshAssignmentSummary(agentId);
  }

  const availableEnvironments = useMemo(() => {
    const envSet = new Set((environments || []).filter((e) => e !== "all"));
    agents.forEach((a) => { if (a.environment) envSet.add(a.environment); });
    return Array.from(envSet).sort();
  }, [environments, agents]);

  function currentFormEnvironment() {
    try {
      return JSON.parse(agentJson).environment || "";
    } catch {
      return "";
    }
  }

  function handleEnvironmentChange(env) {
    try {
      const parsed = JSON.parse(agentJson);
      parsed.environment = env;
      onSetAgentJson(JSON.stringify(parsed, null, 2));
    } catch {
      // leave JSON as-is if currently invalid
    }
  }

  function handleUseTemplate() {
    onUseTemplate();
    setCreationMode(creationMode === "template" ? null : "template");
  }

  function handleFileChange(event) {
    onLoadJsonFile(event, onSetAgentJson);
    setCreationMode("upload");
  }

  function handleCancel() {
    setCreationMode(null);
  }

  const filteredAgents = searchQuery.trim()
    ? agents.filter((a) => {
        const q = searchQuery.toLowerCase();
        const summary = assignmentSummary[a.agent_id] || {};
        const searchableTerms = [
          a.display_name,
          a.agent_id,
          a.purpose,
          "Registered",
          a.owner,
          a.environment,
          a.agent_type,
          a.metadata?.llm?.gateway,
          a.metadata?.llm?.endpoint,
          a.metadata?.llm?.model,
          "LLM",
          "Unified Gateway",
          ...(a.permissions?.tools || []),
          summary.guardrails ? `${summary.guardrails} guardrail guardrails` : "",
          summary.evaluators ? `${summary.evaluators} evaluator evaluators` : "",
          summary.knowledge ? `${summary.knowledge} KB KBs knowledge` : "",
        ];
        return searchableTerms.some((term) => term?.toString().toLowerCase().includes(q));
      })
    : agents;
  const totalAttachedTools = agents.reduce(
    (sum, agent) => sum + (agent.permissions?.tools?.length || 0),
    0,
  );
  const environmentCount = new Set(agents.map((agent) => agent.environment).filter(Boolean)).size;

  return (
    <div className="agent-marketplace-page">
      <section className="agent-creation-section">
        <div className="section-heading">
          <div>
            <h3 className="section-label">Agent Onboarding</h3>
            <p>Register governed agent identities, LLM bindings, and RBAC-scoped ownership from a checked-in contract.</p>
          </div>
        </div>

        <div className="agent-creation-options">
          <button
            className={`agent-creation-option${creationMode === "template" ? " active" : ""}`}
            type="button"
            onClick={handleUseTemplate}
          >
            <span className="option-icon" aria-hidden="true">
              <FileJson size={19} strokeWidth={2.2} />
            </span>
            <span>
              <span className="option-title">Register from Template</span>
              <span className="option-desc">Start from a governed agent identity contract</span>
            </span>
          </button>
          <button
            className={`agent-creation-option${creationMode === "upload" ? " active" : ""}`}
            type="button"
            onClick={() => fileInputRef.current?.click()}
          >
            <span className="option-icon" aria-hidden="true">
              <UploadCloud size={19} strokeWidth={2.2} />
            </span>
            <span>
              <span className="option-title">Import JSON</span>
              <span className="option-desc">Load an existing agent contract from a file</span>
            </span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            style={{ display: "none" }}
            onChange={handleFileChange}
          />
        </div>

        {creationMode ? (
          <form className="agent-creation-form" onSubmit={onCreateAgent}>
            <div className="agent-form-row">
              <label className="agent-form-label" htmlFor="agent-form-env">
                Environment
              </label>
              <select
                id="agent-form-env"
                className="agent-form-env-select"
                value={currentFormEnvironment()}
                onChange={(e) => handleEnvironmentChange(e.target.value)}
              >
                {availableEnvironments.map((env) => (
                  <option key={env} value={env}>{env}</option>
                ))}
                {!availableEnvironments.length && <option value="demo">demo</option>}
              </select>
            </div>

            <textarea
              value={agentJson}
              onChange={(event) => onSetAgentJson(event.target.value)}
              spellCheck="false"
            />

            <div className="agent-creation-form-actions">
              <button type="submit" disabled={!canCreateAgent}>
                Register Agent
              </button>
              <button type="button" onClick={handleCancel}>
                Cancel
              </button>
            </div>
            {!canCreateAgent ? (
              <p className="form-permission-note">
                This role cannot register agents in the selected environment.
              </p>
            ) : null}
          </form>
        ) : null}
      </section>

      <section className="agent-harness-section">
        <div className="section-heading agent-harness-heading">
          <div>
            <h3 className="section-label">Agent Control</h3>
            <p>Select an identity, then govern model access, tool access, guardrails, evaluators, and knowledge access.</p>
          </div>
          <div className="agent-marketplace-stats" aria-label="Agent marketplace summary">
            <span><strong>{agents.length}</strong> agents</span>
            <span><strong>{environmentCount}</strong> environments</span>
            <span><strong>{totalAttachedTools}</strong> tool grants</span>
          </div>
        </div>

        <div className="agent-harness-layout">
          <div className="agent-list-section">
            <div className="agent-search-bar">
              <Search size={15} strokeWidth={2.2} aria-hidden="true" />
              <input
                type="search"
                placeholder="Search agents…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="agent-grid">
              {filteredAgents.map((agent) => (
                <AgentGovernanceCard
                  key={agent.agent_id}
                  agent={agent}
                  assignmentSummary={assignmentSummary[agent.agent_id]}
                  active={selectedAgent?.agent_id === agent.agent_id}
                  canDeleteAgent={Boolean(currentUser?.is_super_admin)}
                  onDeleteAgent={onDeleteAgent}
                  onOpenAgent={openAgentModal}
                  onSelectAgent={onSetSelectedAgentId}
                />
              ))}
              {!filteredAgents.length && searchQuery.trim() ? (
                <div className="empty-state">No agents match &ldquo;{searchQuery}&rdquo;.</div>
              ) : !agents.length ? (
                <div className="empty-state">No agents are available in this environment.</div>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      {modalAgent ? (
        <SelectedAgentModal agent={modalAgent} onClose={() => setModalAgentId(null)}>
          <SelectedAgentPanel
            agent={modalAgent}
            currentUser={currentUser}
            selectedEnvironment={selectedEnvironment}
            tools={tools}
            guardrailPolicies={guardrailPolicies}
            evaluatorTemplates={evaluatorTemplates}
            knowledgeBases={knowledgeBases}
            onGrantTool={onGrantTool}
            onRevokeTool={onRevokeTool}
            onAssignGuardrail={handleAssignGuardrail}
            onDeleteGuardrail={handleDeleteGuardrail}
            onAssignEvaluator={handleAssignEvaluator}
            onDeleteEvaluator={handleDeleteEvaluator}
            onAssignKB={handleAssignKB}
            onDeleteKBAssignment={handleDeleteKBAssignment}
            onUpdateAgent={onUpdateAgent}
          />
        </SelectedAgentModal>
      ) : null}
    </div>
  );
}

function SelectedAgentModal({ agent, children, onClose }) {
  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="agent-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className="agent-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`${agent.display_name} details`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button
          className="agent-modal-close"
          type="button"
          onClick={onClose}
          aria-label={`Close ${agent.display_name}`}
          title={`Close ${agent.display_name}`}
        >
          <X size={17} strokeWidth={2.4} />
        </button>
        {children}
      </section>
    </div>
  );
}

function SelectedAgentPanel({
  agent,
  currentUser,
  selectedEnvironment,
  tools,
  guardrailPolicies,
  evaluatorTemplates,
  knowledgeBases,
  onGrantTool,
  onRevokeTool,
  onAssignGuardrail,
  onDeleteGuardrail,
  onAssignEvaluator,
  onDeleteEvaluator,
  onAssignKB,
  onDeleteKBAssignment,
  onUpdateAgent,
}) {
  const [tab, setTab] = useState("profile");
  const [profileForm, setProfileForm] = useState(() => profileFormFor(agent));
  const [selectedTool, setSelectedTool] = useState("");
  const [guardrails, setGuardrails] = useState([]);
  const [evaluators, setEvaluators] = useState([]);
  const [kbAssignments, setKbAssignments] = useState([]);
  const [policyId, setPolicyId] = useState("");
  const [mode, setMode] = useState("enforce");
  const [evaluatorId, setEvaluatorId] = useState("");
  const [trigger, setTrigger] = useState("after_run");
  const [kbId, setKbId] = useState("");
  const [accessMode, setAccessMode] = useState("read");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [profileSaved, setProfileSaved] = useState(false);
  const agentId = agent?.agent_id;

  const agentEnvironment = agent?.environment || selectedEnvironment;
  const canGrantTool = userCan(currentUser, agentEnvironment, "tool:grant");
  const canManageGovernance = userCan(currentUser, agentEnvironment, "agent:create");
  const grantedTools = agent?.permissions?.tools || [];
  const availableTools = tools.filter((tool) => !grantedTools.includes(tool));
  const availableKBs = knowledgeBases.filter(
    (kb) => !kbAssignments.some((a) => a.kb_id === kb.kb_id),
  );

  useEffect(() => {
    if (!agent) return;
    let active = true;
    setError("");
    setProfileSaved(false);
    setTab("profile");
    setProfileForm(profileFormFor(agent));
    Promise.all([
      api.agentGuardrails(agent.agent_id).catch(() => []),
      api.agentEvaluators(agent.agent_id).catch(() => []),
      api.agentKBs(agent.agent_id).catch(() => []),
    ]).then(([guardrailRows, evaluatorRows, kbRows]) => {
      if (!active) return;
      setGuardrails(guardrailRows);
      setEvaluators(evaluatorRows);
      setKbAssignments(kbRows);
    });
    return () => { active = false; };
  }, [agentId]);

  useEffect(() => {
    if (!availableTools.includes(selectedTool)) {
      setSelectedTool(availableTools[0] || "");
    }
  }, [availableTools, selectedTool]);

  useEffect(() => {
    if (!guardrailPolicies.some((p) => p.policy_id === policyId)) {
      setPolicyId(guardrailPolicies[0]?.policy_id || "");
    }
  }, [guardrailPolicies, policyId]);

  useEffect(() => {
    if (!evaluatorTemplates.some((t) => t.evaluator_id === evaluatorId)) {
      setEvaluatorId(evaluatorTemplates[0]?.evaluator_id || "");
    }
  }, [evaluatorTemplates, evaluatorId]);

  useEffect(() => {
    if (!availableKBs.some((kb) => kb.kb_id === kbId)) {
      setKbId(availableKBs[0]?.kb_id || "");
    }
  }, [availableKBs, kbId]);

  if (!agent) {
    return (
      <aside className="selected-agent-panel">
        <div className="empty-state">Select an agent to manage tools, guardrails, and evaluators.</div>
      </aside>
    );
  }

  async function runAction(action) {
    setLoading(true);
    setError("");
    try {
      await action();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function refreshAssignments() {
    const [guardrailRows, evaluatorRows, kbRows] = await Promise.all([
      api.agentGuardrails(agent.agent_id),
      api.agentEvaluators(agent.agent_id),
      api.agentKBs(agent.agent_id).catch(() => []),
    ]);
    setGuardrails(guardrailRows);
    setEvaluators(evaluatorRows);
    setKbAssignments(kbRows);
  }

  function updateProfileField(field, value) {
    setProfileSaved(false);
    setProfileForm((current) => ({ ...current, [field]: value }));
  }

  async function saveProfile(event) {
    event.preventDefault();
    setError("");
    setProfileSaved(false);
    let metadata;
    try {
      metadata = JSON.parse(profileForm.metadata);
    } catch {
      setError("Metadata must be valid JSON.");
      return;
    }
    const llmTemperature = Number(profileForm.llm_temperature);
    if (!Number.isFinite(llmTemperature)) {
      setError("LLM temperature must be a valid number.");
      return;
    }
    metadata = {
      ...metadata,
      llm: {
        ...(metadata.llm || {}),
        gateway: profileForm.llm_gateway.trim() || defaultLlmConfig.gateway,
        endpoint: profileForm.llm_endpoint.trim() || defaultLlmConfig.endpoint,
        model: profileForm.llm_model.trim() || defaultLlmConfig.model,
        temperature: llmTemperature,
      },
    };
    await runAction(async () => {
      await onUpdateAgent({
        agent_id: agent.agent_id,
        display_name: profileForm.display_name.trim(),
        agent_type: profileForm.agent_type.trim(),
        owner: profileForm.owner.trim(),
        environment: profileForm.environment.trim(),
        purpose: profileForm.purpose.trim(),
        permissions: agent.permissions || {},
        metadata,
      });
      setProfileSaved(true);
    });
  }

  const selectedPolicy = guardrailPolicies.find((p) => p.policy_id === policyId);
  const selectedEvaluatorTemplate = evaluatorTemplates.find((t) => t.evaluator_id === evaluatorId);
  const selectedKB = knowledgeBases.find((kb) => kb.kb_id === kbId);

  return (
    <aside className="selected-agent-panel">
      <div className="selected-agent-header">
        <div>
          <span className="eyebrow">Selected Agent</span>
          <h2>{agent.display_name}</h2>
          <p>{agent.agent_id}</p>
        </div>
        <span>{agent.environment}</span>
      </div>

      <div className="selected-agent-stats" aria-label={`${agent.agent_id} assignment summary`}>
        <span><strong>{grantedTools.length}</strong> tools</span>
        <span><strong>{guardrails.length}</strong> guardrails</span>
        <span><strong>{evaluators.length}</strong> evaluators</span>
        <span><strong>{kbAssignments.length}</strong> KBs</span>
      </div>

      <div className="selected-agent-modal-body">
        <div className="marketplace-tabs agent-detail-tabs" role="tablist" aria-label={`${agent.agent_id} attachments`}>
          {[
            { id: "profile", label: "Profile", icon: ClipboardCheck },
            { id: "tools", label: "Tools", icon: Wrench },
            { id: "guardrails", label: "Guardrails", icon: ShieldCheck },
            { id: "evaluators", label: "Evaluators", icon: ClipboardCheck },
            { id: "knowledge", label: "Knowledge", icon: Database },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={tab === item.id ? "selected" : ""}
                type="button"
                role="tab"
                aria-selected={tab === item.id}
                onClick={() => setTab(item.id)}
              >
                <Icon size={14} strokeWidth={2.2} aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        <div className="selected-agent-modal-content">
          {error ? <div className="inline-error">{error}</div> : null}

          {tab === "profile" ? (
            <div className="agent-detail-section">
              <form className="agent-profile-form" onSubmit={saveProfile}>
                <label>
                  <span>Agent ID</span>
                  <input value={agent.agent_id} readOnly />
                </label>
                <label>
                  <span>Display name</span>
                  <input
                    value={profileForm.display_name}
                    onChange={(event) => updateProfileField("display_name", event.target.value)}
                    required
                  />
                </label>
                <label>
                  <span>Owner</span>
                  <input
                    value={profileForm.owner}
                    onChange={(event) => updateProfileField("owner", event.target.value)}
                    required
                  />
                </label>
                <label>
                  <span>Environment</span>
                  <input
                    value={profileForm.environment}
                    onChange={(event) => updateProfileField("environment", event.target.value)}
                    required
                  />
                </label>
                <label>
                  <span>Agent type</span>
                  <input
                    value={profileForm.agent_type}
                    onChange={(event) => updateProfileField("agent_type", event.target.value)}
                    required
                  />
                </label>
                <label className="profile-field-wide">
                  <span>Purpose</span>
                  <textarea
                    value={profileForm.purpose}
                    onChange={(event) => updateProfileField("purpose", event.target.value)}
                    required
                  />
                </label>
                <div className="profile-field-wide agent-profile-subsection">
                  <strong>Unified Gateway</strong>
                  <span>Agents call models through a single governed endpoint.</span>
                </div>
                <label>
                  <span>Gateway</span>
                  <input
                    value={profileForm.llm_gateway}
                    onChange={(event) => updateProfileField("llm_gateway", event.target.value)}
                    required
                  />
                </label>
                <label>
                  <span>Endpoint</span>
                  <input
                    value={profileForm.llm_endpoint}
                    onChange={(event) => updateProfileField("llm_endpoint", event.target.value)}
                    required
                  />
                </label>
                <label>
                  <span>Model</span>
                  <input
                    value={profileForm.llm_model}
                    onChange={(event) => updateProfileField("llm_model", event.target.value)}
                    required
                  />
                </label>
                <label>
                  <span>Temperature</span>
                  <input
                    value={profileForm.llm_temperature}
                    onChange={(event) => updateProfileField("llm_temperature", event.target.value)}
                    inputMode="decimal"
                    required
                  />
                </label>
                <label className="profile-field-wide">
                  <span>Metadata JSON</span>
                  <textarea
                    className="metadata-editor"
                    value={profileForm.metadata}
                    onChange={(event) => updateProfileField("metadata", event.target.value)}
                    spellCheck="false"
                  />
                </label>
                <div className="agent-profile-actions">
                  <button type="submit" disabled={loading || !canManageGovernance}>
                    <span>{loading ? "Saving..." : "Save Profile"}</span>
                  </button>
                  {profileSaved ? <span>Saved</span> : null}
                </div>
                {!canManageGovernance ? (
                  <p className="attachment-form-hint">
                    This role cannot edit agent profiles in this environment.
                  </p>
                ) : null}
              </form>
            </div>
          ) : null}

          {tab === "tools" ? (
            <div className="agent-detail-section">
              <div className="attachment-form-group">
                <label className="attachment-form-label">Add tool</label>
                <form
                  className="agent-attachment-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!selectedTool) {
                      setError("Select a tool before attaching it to an agent.");
                      return;
                    }
                    runAction(() => onGrantTool(agent.agent_id, selectedTool));
                  }}
                >
                  <select value={selectedTool} onChange={(event) => setSelectedTool(event.target.value)}>
                    {availableTools.map((tool) => (
                      <option key={tool} value={tool}>{tool}</option>
                    ))}
                    {!availableTools.length ? <option value="">No available tools</option> : null}
                  </select>
                  <button type="submit" disabled={loading || !canGrantTool || !selectedTool}>
                    <Plus size={14} strokeWidth={2.2} aria-hidden="true" />
                    <span>Attach</span>
                  </button>
                </form>
              </div>
              <AttachmentList
                emptyLabel="No tools attached"
                items={grantedTools.map((tool) => ({ id: tool, label: tool }))}
                canRemove={canGrantTool}
                confirmMessage={(label) => `Remove tool "${label}" from this agent?`}
                onRemove={(tool) => runAction(() => onRevokeTool(agent.agent_id, tool))}
              />
            </div>
          ) : null}

          {tab === "guardrails" ? (
            <div className="agent-detail-section">
              <div className="attachment-form-group">
                <label className="attachment-form-label">Attach guardrail policy</label>
                <form
                  className="agent-attachment-form three-column"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!policyId) {
                      setError("Select a guardrail policy before attaching it.");
                      return;
                    }
                    runAction(async () => {
                      await onAssignGuardrail(agent.agent_id, { policy_id: policyId, mode, threshold_overrides: {} });
                      await refreshAssignments();
                    });
                  }}
                >
                  <select value={policyId} onChange={(event) => setPolicyId(event.target.value)}>
                    {guardrailPolicies.map((policy) => (
                      <option key={policy.policy_id} value={policy.policy_id}>
                        {policy.display_name}
                      </option>
                    ))}
                    {!guardrailPolicies.length ? <option value="">No policies</option> : null}
                  </select>
                  <select value={mode} onChange={(event) => setMode(event.target.value)}>
                    <option value="enforce">enforce</option>
                    <option value="review_only">review_only</option>
                    <option value="disabled">disabled</option>
                  </select>
                  <button type="submit" disabled={loading || !policyId || !canManageGovernance}>
                    <Plus size={14} strokeWidth={2.2} aria-hidden="true" />
                    <span>Attach</span>
                  </button>
                </form>
                {selectedPolicy?.description ? (
                  <p className="attachment-form-hint">{selectedPolicy.description}</p>
                ) : null}
              </div>
              <AttachmentList
                emptyLabel="No guardrails attached"
                items={guardrails.map((g) => ({
                  id: g.assignment_id,
                  label: g.policy_id,
                  badge: g.mode,
                }))}
                canRemove={canManageGovernance}
                confirmMessage={(label) => `Remove guardrail policy "${label}" from this agent?`}
                onRemove={(assignmentId) =>
                  runAction(async () => {
                    await onDeleteGuardrail(agent.agent_id, assignmentId);
                    await refreshAssignments();
                  })
                }
              />
            </div>
          ) : null}

          {tab === "evaluators" ? (
            <div className="agent-detail-section">
              <div className="attachment-form-group">
                <label className="attachment-form-label">Attach evaluator</label>
                <form
                  className="agent-attachment-form three-column"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!evaluatorId) {
                      setError("Select an evaluator before attaching it.");
                      return;
                    }
                    runAction(async () => {
                      await onAssignEvaluator(agent.agent_id, { evaluator_id: evaluatorId, trigger, config: {} });
                      await refreshAssignments();
                    });
                  }}
                >
                  <select value={evaluatorId} onChange={(event) => setEvaluatorId(event.target.value)}>
                    {evaluatorTemplates.map((template) => (
                      <option key={template.evaluator_id} value={template.evaluator_id}>
                        {template.display_name}
                      </option>
                    ))}
                    {!evaluatorTemplates.length ? <option value="">No evaluators</option> : null}
                  </select>
                  <select value={trigger} onChange={(event) => setTrigger(event.target.value)}>
                    <option value="after_run">after_run</option>
                    <option value="after_workflow">after_workflow</option>
                    <option value="manual">manual</option>
                  </select>
                  <button type="submit" disabled={loading || !evaluatorId || !canManageGovernance}>
                    <Plus size={14} strokeWidth={2.2} aria-hidden="true" />
                    <span>Attach</span>
                  </button>
                </form>
                {selectedEvaluatorTemplate?.description ? (
                  <p className="attachment-form-hint">{selectedEvaluatorTemplate.description}</p>
                ) : null}
              </div>
              <AttachmentList
                emptyLabel="No evaluators attached"
                items={evaluators.map((ev) => ({
                  id: ev.assignment_id,
                  label: ev.evaluator_id,
                  badge: ev.trigger,
                }))}
                canRemove={canManageGovernance}
                confirmMessage={(label) => `Remove evaluator "${label}" from this agent?`}
                onRemove={(assignmentId) =>
                  runAction(async () => {
                    await onDeleteEvaluator(agent.agent_id, assignmentId);
                    await refreshAssignments();
                  })
                }
              />
            </div>
          ) : null}

          {tab === "knowledge" ? (
            <div className="agent-detail-section">
              <div className="attachment-form-group">
                <label className="attachment-form-label">Attach knowledge base</label>
                <form
                  className="agent-attachment-form three-column"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!kbId) {
                      setError("Select a knowledge base before attaching it.");
                      return;
                    }
                    runAction(async () => {
                      await onAssignKB(agent.agent_id, { kb_id: kbId, access_mode: accessMode });
                      await refreshAssignments();
                    });
                  }}
                >
                  <select value={kbId} onChange={(event) => setKbId(event.target.value)}>
                    {availableKBs.map((kb) => (
                      <option key={kb.kb_id} value={kb.kb_id}>
                        {kb.display_name}
                      </option>
                    ))}
                    {!availableKBs.length ? <option value="">No knowledge bases available</option> : null}
                  </select>
                  <select value={accessMode} onChange={(event) => setAccessMode(event.target.value)}>
                    <option value="read">read</option>
                    <option value="read_write">read_write</option>
                  </select>
                  <button type="submit" disabled={loading || !kbId || !canManageGovernance}>
                    <Plus size={14} strokeWidth={2.2} aria-hidden="true" />
                    <span>Attach</span>
                  </button>
                </form>
                {selectedKB?.description ? (
                  <p className="attachment-form-hint">{selectedKB.description}</p>
                ) : null}
              </div>
              <AttachmentList
                emptyLabel="No knowledge bases attached"
                items={kbAssignments.map((a) => ({
                  id: a.assignment_id,
                  label: a.kb_id,
                  badge: a.access_mode,
                }))}
                canRemove={canManageGovernance}
                confirmMessage={(label) => `Remove knowledge base "${label}" from this agent?`}
                onRemove={(assignmentId) =>
                  runAction(async () => {
                    await onDeleteKBAssignment(agent.agent_id, assignmentId);
                    await refreshAssignments();
                  })
                }
              />
            </div>
          ) : null}
        </div>
      </div>
    </aside>
  );
}

function AttachmentList({ canRemove, emptyLabel, items, confirmMessage, onRemove }) {
  return (
    <div className="attachment-list">
      {items.map((item) => (
        <div key={item.id} className="attachment-item">
          <span className="attachment-item-label">{item.label}</span>
          {item.badge ? <span className="attachment-item-badge">{item.badge}</span> : null}
          {canRemove ? (
            <button
              className="attachment-item-remove"
              type="button"
              title={`Remove ${item.label}`}
              aria-label={`Remove ${item.label}`}
              onClick={() => {
                if (window.confirm(confirmMessage ? confirmMessage(item.label) : `Remove "${item.label}"?`)) {
                  onRemove(item.id);
                }
              }}
            >
              <X size={14} strokeWidth={2.2} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ))}
      {!items.length ? <span className="attachment-list-empty">{emptyLabel}</span> : null}
    </div>
  );
}
