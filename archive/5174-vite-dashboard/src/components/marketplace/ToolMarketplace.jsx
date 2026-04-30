import React from "react";

export default function ToolMarketplace({
  toolJson,
  toolMarketplace,
  canCreateTool,
  onCreateTool,
  onSetToolJson,
  onLoadJsonFile,
  onUseTemplate,
}) {
  return (
    <div className="marketplace-view">
      <form className="json-builder" onSubmit={onCreateTool}>
        <div className="builder-header">
          <div>
            <span className="eyebrow">Tool Contract</span>
            <h2>Register governed tool.</h2>
            {!canCreateTool ? <p>This role cannot register tools in the selected environment.</p> : null}
          </div>
          <div className="builder-actions">
            <button type="button" onClick={onUseTemplate}>
              Use Template
            </button>
            <label className="file-action">
              Import JSON
              <input accept="application/json,.json" type="file" onChange={(event) => onLoadJsonFile(event, onSetToolJson)} />
            </label>
          </div>
        </div>
        <textarea value={toolJson} onChange={(event) => onSetToolJson(event.target.value)} spellCheck="false" />
        <button className="builder-submit" type="submit" disabled={!canCreateTool}>
          Register Tool
        </button>
      </form>

      <div className="tool-marketplace-grid">
        {toolMarketplace.map((tool) => (
          <div className="tool-marketplace-card" key={tool.tool_name}>
            <strong>{tool.display_name || tool.tool_name}</strong>
            <span>{tool.tool_name}</span>
            <small>{tool.description || "Grant-gated tool contract"}</small>
          </div>
        ))}
      </div>
    </div>
  );
}
