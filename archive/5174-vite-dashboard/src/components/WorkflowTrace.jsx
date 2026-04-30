import React, { useMemo } from "react";
import { Background, Controls, MarkerType, ReactFlow } from "@xyflow/react";

const statusClass = {
  ALLOW: "node-allow",
  COMPLETED: "node-complete",
  RECEIVED: "node-neutral",
  ACTIVE: "node-neutral",
  PENDING: "node-neutral",
  RECORDED: "node-neutral",
  REVIEW: "node-review",
  BLOCK: "node-block",
};

function nodeLabel(event) {
  const payload = event.payload || {};
  if (event.event_type === "USER_PROMPT") {
    return `${event.label}\n${payload.user_query || ""}`;
  }
  if (event.event_type === "POLICY_DECISION") {
    return `${event.label}\nRisk ${payload.risk_score ?? 0}`;
  }
  if (event.event_type === "TOOL_CALL_REQUESTED") {
    return `${event.label}\n${payload.tool_name || ""}`;
  }
  return event.label;
}

export default function WorkflowTrace({ events, selectedEventId, onSelect }) {
  const { nodes, edges } = useMemo(() => {
    const mappedNodes = events.map((event, index) => ({
      id: event.event_id,
      position: { x: 80 + index * 230, y: index % 2 === 0 ? 100 : 260 },
      data: { label: nodeLabel(event) },
      className: `${statusClass[event.status] || "node-neutral"} ${
        selectedEventId === event.event_id ? "node-selected" : ""
      }`,
      sourcePosition: "right",
      targetPosition: "left",
    }));

    const mappedEdges = events.slice(1).map((event, index) => ({
      id: `${events[index].event_id}-${event.event_id}`,
      source: events[index].event_id,
      target: event.event_id,
      markerEnd: { type: MarkerType.ArrowClosed },
      className: event.status === "BLOCK" ? "edge-block" : event.status === "REVIEW" ? "edge-review" : "",
    }));

    return { nodes: mappedNodes, edges: mappedEdges };
  }, [events, selectedEventId]);

  if (!events.length) {
    return <div className="empty-state">Select or run a workflow to view its trace.</div>;
  }

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      fitView
      minZoom={0.35}
      maxZoom={1.35}
      onNodeClick={(_, node) => onSelect(events.find((event) => event.event_id === node.id))}
    >
      <Background color="#d7d0c2" gap={18} />
      <Controls />
    </ReactFlow>
  );
}
