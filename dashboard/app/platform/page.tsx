"use client";

import { useEffect, useState } from "react";
import { clearSession, getSession, me, platformOverview, type AuthUser, type PlatformData } from "@/lib/api";
import { emptyPlatformData } from "./_components/config";
import { PlatformFrame } from "./_components/PlatformFrame";
import { PlatformTransition } from "./_components/PlatformTransition";
import { WorkspaceShell } from "./_components/WorkspaceShell";
import type { BackendComponentKey, DataStatus, WorkspaceView } from "./_components/types";
import { isBackendComponentKey, workspaceViewForComponent, workspaceViewFromUrl } from "./_components/utils";

export default function PlatformPage() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [data, setData] = useState<PlatformData>(emptyPlatformData);
  const [status, setStatus] = useState<"loading" | "ready" | "public">("loading");
  const [dataStatus, setDataStatus] = useState<DataStatus>("loading");
  const [dataError, setDataError] = useState<string | null>(null);
  const [activeComponent, setActiveComponent] = useState<BackendComponentKey>("agents");
  const [activeView, setActiveView] = useState<WorkspaceView>("overview");
  const [selectedEnvironment, setSelectedEnvironment] = useState("all");
  const [selectedTraceWorkflowId, setSelectedTraceWorkflowId] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedComponent = params.get("component");
    setSelectedTraceWorkflowId(params.get("workflow") || "");

    if (isBackendComponentKey(requestedComponent)) {
      setActiveComponent(requestedComponent);
      setActiveView(workspaceViewForComponent(requestedComponent));
    } else {
      setActiveView(workspaceViewFromUrl());
    }

    const session = getSession();

    if (!session?.token) {
      setStatus("public");
      return;
    }

    const token = session.token;

    async function loadWorkspace() {
      try {
        const nextUser = await me(token);
        setUser(nextUser);
        setStatus("ready");
        setDataStatus("loading");

        try {
          const nextData = await platformOverview(token, selectedEnvironment);
          setData(nextData);
          setDataError(null);
          setDataStatus("ready");
        } catch (error) {
          setDataError(error instanceof Error ? error.message : "Unable to load platform data");
          setDataStatus("error");
        }
      } catch {
        clearSession();
        setStatus("public");
      }
    }

    loadWorkspace();
  }, [selectedEnvironment]);

  function logout() {
    clearSession();
    window.location.assign("/");
  }

  async function refreshWorkspace() {
    const session = getSession();

    if (!session?.token) {
      setStatus("public");
      return;
    }

    setDataStatus("loading");
    try {
      const nextData = await platformOverview(session.token, selectedEnvironment);
      setData(nextData);
      setDataError(null);
      setDataStatus("ready");
    } catch (error) {
      setDataError(error instanceof Error ? error.message : "Unable to load platform data");
      setDataStatus("error");
    }
  }

  function switchWorkspaceView(view: WorkspaceView) {
    setActiveView(view);
    if (view !== "trace") {
      setSelectedTraceWorkflowId("");
    }
    window.history.replaceState(null, "", `/platform/?view=${view}`);
  }

  function switchEnvironment(environment: string) {
    setSelectedEnvironment(environment);
  }

  function openBackendComponent(component: BackendComponentKey) {
    setActiveComponent(component);
    setActiveView(workspaceViewForComponent(component));
    setSelectedTraceWorkflowId("");
    window.history.replaceState(null, "", `/platform/?view=${workspaceViewForComponent(component)}&component=${component}`);
  }

  function openWorkflowTrace(workflowId: string) {
    setSelectedTraceWorkflowId(workflowId);
    setActiveView("trace");
    window.history.replaceState(
      null,
      "",
      workflowId ? `/platform/?view=trace&workflow=${encodeURIComponent(workflowId)}` : "/platform/?view=trace",
    );
  }

  if (status === "loading") {
    return <PlatformFrame message="Validating workspace session..." />;
  }

  if (status === "public") {
    return <PlatformTransition />;
  }

  return (
    <WorkspaceShell
      activeComponent={activeComponent}
      activeView={activeView}
      data={data}
      dataError={dataError}
      dataStatus={dataStatus}
      onComponentSelect={openBackendComponent}
      onEnvironmentSelect={switchEnvironment}
      onLogout={logout}
      onRefresh={refreshWorkspace}
      onViewSelect={switchWorkspaceView}
      onWorkflowTraceSelect={openWorkflowTrace}
      selectedEnvironment={selectedEnvironment}
      selectedTraceWorkflowId={selectedTraceWorkflowId}
      user={user}
    />
  );
}
