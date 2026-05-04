import type { PlatformData } from "@/lib/api";
import { ControlPlaneWorkspace } from "./ControlPlaneWorkspace";
import { EvaluationCenterWorkspace } from "./EvaluationCenterWorkspace";
import { KnowledgeBasesWorkspace } from "./KnowledgeBasesWorkspace";
import { MonitoringWorkspace } from "./MonitoringWorkspace";
import { OverviewWorkspace } from "./OverviewWorkspace";
import { AuditEventsWorkspace, ReviewQueueWorkspace, WorkflowTraceWorkspace } from "./RecordListWorkspace";
import type { BackendComponentKey, DataStatus, WorkspaceView } from "./types";
import { ToolRegistryWorkspace } from "./ToolRegistryWorkspace";
import { WorkflowBuilderWorkspace } from "./WorkflowBuilderWorkspace";

export function WorkspaceViewContent({
  activeComponent,
  activeView,
  data,
  dataStatus,
  onComponentSelect,
  onWorkflowAuditSelect,
  onRefresh,
  selectedEnvironment,
  selectedTraceWorkflowId,
}: {
  activeComponent: BackendComponentKey;
  activeView: WorkspaceView;
  data: PlatformData;
  dataStatus: DataStatus;
  onComponentSelect: (component: BackendComponentKey) => void;
  onWorkflowAuditSelect: (workflowIdOrSessionId: string) => void;
  onRefresh: () => void;
  selectedEnvironment: string;
  selectedTraceWorkflowId: string;
}) {
  if (activeView === "overview") {
    return <OverviewWorkspace data={data} dataStatus={dataStatus} onComponentSelect={onComponentSelect} />;
  }

  if (activeView === "tool-registry") {
    return <ToolRegistryWorkspace data={data} onRefresh={onRefresh} />;
  }

  if (activeView === "agent-registry") {
    return (
      <ControlPlaneWorkspace
        activeComponent={activeComponent}
        data={data}
        dataStatus={dataStatus}
        lockedTab="agents"
        onRefresh={onRefresh}
        onSelect={onComponentSelect}
      />
    );
  }

  if (activeView === "workflow-designer") {
    return (
      <WorkflowBuilderWorkspace
        data={data}
        onRefresh={onRefresh}
        selectedEnvironment={selectedEnvironment}
      />
    );
  }

  if (activeView === "knowledge-bases") {
    return <KnowledgeBasesWorkspace data={data} dataStatus={dataStatus} onRefresh={onRefresh} />;
  }

  if (activeView === "guardrail-policies") {
    return (
      <ControlPlaneWorkspace
        activeComponent="guardrails"
        data={data}
        dataStatus={dataStatus}
        lockedTab="guardrails"
        onRefresh={onRefresh}
        onSelect={onComponentSelect}
      />
    );
  }

  if (activeView === "evaluation-center") {
    return <EvaluationCenterWorkspace data={data} dataStatus={dataStatus} />;
  }

  if (activeView === "agentic-workflows") {
    return (
      <WorkflowTraceWorkspace
        data={data}
        onAuditEventsSelect={onWorkflowAuditSelect}
        onRefresh={onRefresh}
        selectedWorkflowId={selectedTraceWorkflowId}
      />
    );
  }

  if (activeView === "reviews") {
    return <ReviewQueueWorkspace data={data} onRefresh={onRefresh} />;
  }

  if (activeView === "monitoring") {
    return <MonitoringWorkspace data={data} dataStatus={dataStatus} />;
  }

  return <AuditEventsWorkspace data={data} selectedWorkflowId={selectedTraceWorkflowId} />;
}
