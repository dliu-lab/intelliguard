import React from "react";

export default function EvaluatorMarketplace({ evaluatorTemplates }) {
  return (
    <div className="marketplace-view">
      <div className="tool-marketplace-grid">
        <div className="governance-section-title">
          <div className="panel-title">Evaluator Templates</div>
        </div>
        {evaluatorTemplates.map((template) => (
          <div className="tool-marketplace-card" key={template.evaluator_id}>
            <strong>{template.display_name}</strong>
            <span>{template.evaluator_id}</span>
            <small>
              {template.scope} scope / {template.llm_enabled ? "LLM" : "Rule-based"} / {template.description}
            </small>
          </div>
        ))}
        {!evaluatorTemplates.length ? <div className="empty-state">No evaluator templates.</div> : null}
      </div>
    </div>
  );
}
