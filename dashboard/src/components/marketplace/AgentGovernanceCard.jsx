import React from "react";
import { Boxes, MoreHorizontal, Trash2 } from "lucide-react";

export default function AgentGovernanceCard({
  agent,
  assignmentSummary = {},
  active,
  canDeleteAgent,
  onDeleteAgent,
  onOpenAgent,
  onSelectAgent,
}) {
  const grantedTools = agent.permissions?.tools || [];
  const llm = agent.metadata?.llm || {};
  const llmModel = llm.model || "LLM via LiteLLM";
  const assignmentTags = [
    {
      key: "guardrails",
      className: "guardrail",
      count: assignmentSummary.guardrails || 0,
      singular: "guardrail",
      plural: "guardrails",
    },
    {
      key: "evaluators",
      className: "evaluator",
      count: assignmentSummary.evaluators || 0,
      singular: "evaluator",
      plural: "evaluators",
    },
    {
      key: "knowledge",
      className: "knowledge",
      count: assignmentSummary.knowledge || 0,
      singular: "KB",
      plural: "KBs",
    },
  ].filter((tag) => tag.count > 0);

  function handleDelete(e) {
    e.stopPropagation();
    if (window.confirm(`Delete agent "${agent.display_name}"? This cannot be undone.`)) {
      onDeleteAgent(agent);
    }
  }

  return (
    <div className={`agent-card agent-summary-card ${active ? "selected" : ""}`}>
      <button className="agent-card-main" type="button" onClick={() => onSelectAgent(agent.agent_id)}>
        <div className="agent-card-heading">
          <span className="agent-avatar" aria-hidden="true">
            <Boxes size={17} strokeWidth={2.2} />
          </span>
          <div>
            <strong>{agent.display_name}</strong>
            <span>{agent.agent_id}</span>
          </div>
        </div>
        <p>{agent.purpose}</p>
        <div className="agent-meta">
          <span className="agent-chip-muted">Registered</span>
          <span>{agent.owner}</span>
          <span>{agent.environment}</span>
          <span>{agent.agent_type}</span>
          <span>{llmModel}</span>
        </div>
        <div className="agent-assignment-tags" aria-label={`${agent.display_name} attachments`}>
          <span className="agent-assignment-tag tools">
            {grantedTools.length} tool{grantedTools.length === 1 ? "" : "s"}
          </span>
          {assignmentTags.map((tag) => (
            <span key={tag.key} className={`agent-assignment-tag ${tag.className}`}>
              {tag.count} {tag.count === 1 ? tag.singular : tag.plural}
            </span>
          ))}
        </div>
      </button>
      <div className="agent-card-actions">
        <button
          className="agent-open-button"
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onOpenAgent(agent.agent_id);
          }}
          title={`Open ${agent.display_name}`}
          aria-label={`Open ${agent.display_name}`}
        >
          <MoreHorizontal size={16} strokeWidth={2.4} />
        </button>
        {canDeleteAgent ? (
          <button
            className="agent-delete-button"
            type="button"
            onClick={handleDelete}
            title={`Delete ${agent.display_name}`}
            aria-label={`Delete ${agent.display_name}`}
          >
            <Trash2 size={14} strokeWidth={2.2} />
          </button>
        ) : null}
      </div>
    </div>
  );
}
