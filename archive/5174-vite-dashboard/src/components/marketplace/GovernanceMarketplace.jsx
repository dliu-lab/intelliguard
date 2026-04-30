import React from "react";

export default function GovernanceMarketplace({
  guardrailPolicyJson,
  guardrailPolicies,
  canCreateGuardrailPolicy,
  onCreateGuardrailPolicy,
  onSetGuardrailPolicyJson,
  onLoadJsonFile,
  onUseTemplate,
  knowledgeBaseJson,
  knowledgeBases = [],
  canCreateKnowledgeBase,
  onCreateKnowledgeBase,
  onSetKnowledgeBaseJson,
  defaultSection = "guardrails",
}) {
  const section = defaultSection;

  return (
    <div className="marketplace-view">
      {section === "guardrails" ? (
        <>
          <div className="marketplace-builder">
            <form className="json-builder" onSubmit={onCreateGuardrailPolicy}>
              <div className="builder-header">
                <div>
                  <span className="eyebrow">Guardrail Contract</span>
                  <h2>Register runtime guardrail.</h2>
                  {!canCreateGuardrailPolicy ? (
                    <p>This role cannot register guardrail policies in the selected environment.</p>
                  ) : null}
                </div>
                <div className="builder-actions">
                  <button type="button" onClick={onUseTemplate}>
                    Use Template
                  </button>
                  <label className="file-action">
                    Import JSON
                    <input
                      accept="application/json,.json"
                      type="file"
                      onChange={(event) => onLoadJsonFile(event, onSetGuardrailPolicyJson)}
                    />
                  </label>
                </div>
              </div>
              <textarea
                value={guardrailPolicyJson}
                onChange={(event) => onSetGuardrailPolicyJson(event.target.value)}
                spellCheck="false"
              />
              <button className="builder-submit" type="submit" disabled={!canCreateGuardrailPolicy}>
                Register Guardrail
              </button>
            </form>
          </div>

          <div className="tool-marketplace-grid">
            <div className="governance-section-title">
              <div className="panel-title">Guardrail Policies</div>
            </div>
            {guardrailPolicies.map((policy) => (
              <div className="tool-marketplace-card" key={policy.policy_id}>
                <strong>{policy.display_name}</strong>
                <span>{policy.policy_id}</span>
                <small>{policy.environment} / {policy.description || "No description"}</small>
              </div>
            ))}
            {!guardrailPolicies.length ? <div className="empty-state">No guardrail policies.</div> : null}
          </div>
        </>
      ) : null}

      {section === "knowledge" ? (
        <>
          <div className="marketplace-builder">
            <form className="json-builder" onSubmit={onCreateKnowledgeBase}>
              <div className="builder-header">
                <div>
                  <span className="eyebrow">Knowledge Base</span>
                  <h2>Onboard knowledge base.</h2>
                  {!canCreateKnowledgeBase ? (
                    <p>This role cannot onboard knowledge bases in the selected environment.</p>
                  ) : null}
                </div>
                <div className="builder-actions">
                  <label className="file-action">
                    Import JSON
                    <input
                      accept="application/json,.json"
                      type="file"
                      onChange={(event) => onLoadJsonFile && onLoadJsonFile(event, onSetKnowledgeBaseJson)}
                    />
                  </label>
                </div>
              </div>
              <textarea
                value={knowledgeBaseJson}
                onChange={(event) => onSetKnowledgeBaseJson(event.target.value)}
                spellCheck="false"
              />
              <button className="builder-submit" type="submit" disabled={!canCreateKnowledgeBase}>
                Onboard KB
              </button>
            </form>
          </div>

          <div className="tool-marketplace-grid">
            <div className="governance-section-title">
              <div className="panel-title">Knowledge Bases</div>
            </div>
            {knowledgeBases.map((kb) => (
              <div className="tool-marketplace-card" key={kb.kb_id}>
                <strong>{kb.display_name}</strong>
                <span>{kb.kb_id}</span>
                <small>{kb.environment} / {kb.source_type} / {kb.description || "No description"}</small>
              </div>
            ))}
            {!knowledgeBases.length ? <div className="empty-state">No knowledge bases registered.</div> : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
