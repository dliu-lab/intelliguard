import type { PlatformData } from "@/lib/api";
import { ControlPlaneWorkspace } from "./ControlPlaneWorkspace";
import { OverviewWorkspace } from "./OverviewWorkspace";
import { AuditEventsWorkspace, ReviewQueueWorkspace, RuntimePoliciesWorkspace, WorkflowTraceWorkspace } from "./RecordListWorkspace";
import type { BackendComponentKey, DataStatus, WorkspaceView } from "./types";
import { WorkflowBuilderWorkspace } from "./WorkflowBuilderWorkspace";

export function WorkspaceViewContent({
  activeComponent,
  activeView,
  data,
  dataStatus,
  onComponentSelect,
  onRefresh,
  onWorkflowTraceSelect,
  selectedEnvironment,
  selectedTraceWorkflowId,
}: {
  activeComponent: BackendComponentKey;
  activeView: WorkspaceView;
  data: PlatformData;
  dataStatus: DataStatus;
  onComponentSelect: (component: BackendComponentKey) => void;
  onRefresh: () => void;
  onWorkflowTraceSelect: (workflowId: string) => void;
  selectedEnvironment: string;
  selectedTraceWorkflowId: string;
}) {
  if (activeView === "overview") {
    return <OverviewWorkspace data={data} dataStatus={dataStatus} onComponentSelect={onComponentSelect} />;
  }

  if (activeView === "control") {
    return (
      <ControlPlaneWorkspace
        activeComponent={activeComponent}
        data={data}
        dataStatus={dataStatus}
        onRefresh={onRefresh}
        onSelect={onComponentSelect}
      />
    );
  }

  if (activeView === "workflows") {
    return (
      <WorkflowBuilderWorkspace
        data={data}
        onRefresh={onRefresh}
        onWorkflowTraceSelect={onWorkflowTraceSelect}
        selectedEnvironment={selectedEnvironment}
      />
    );
  }

  if (activeView === "trace") {
    return <WorkflowTraceWorkspace data={data} selectedWorkflowId={selectedTraceWorkflowId} />;
  }

  if (activeView === "policies") {
    return <RuntimePoliciesWorkspace data={data} />;
  }

  if (activeView === "reviews") {
    return <ReviewQueueWorkspace data={data} onRefresh={onRefresh} />;
  }

  return <AuditEventsWorkspace data={data} />;
}
