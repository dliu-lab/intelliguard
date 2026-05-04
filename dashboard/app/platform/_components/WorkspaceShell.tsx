"use client";

import { useEffect, useState } from "react";
import { Clock3, KeyRound, LogOut, RefreshCw } from "lucide-react";
import { FacilitatorBot } from "@/components/FacilitatorBot";
import { ThemeToggle } from "@/components/ThemeToggle";
import type { AuthUser, PlatformData } from "@/lib/api";
import { workspaceViews } from "./config";
import type { BackendComponentKey, DataStatus, WorkspaceView } from "./types";
import { formatIsoTimestamp } from "./utils";
import { WorkspaceViewContent } from "./WorkspaceViewContent";

function formatPlatformTime() {
  return formatIsoTimestamp(new Date()) || "";
}

export function WorkspaceShell({
  activeComponent,
  activeView,
  data,
  dataError,
  dataStatus,
  onComponentSelect,
  onEnvironmentSelect,
  onLogout,
  onRefresh,
  onWorkflowAuditSelect,
  onViewSelect,
  selectedEnvironment,
  selectedTraceWorkflowId,
  user,
}: {
  activeComponent: BackendComponentKey;
  activeView: WorkspaceView;
  data: PlatformData;
  dataError: string | null;
  dataStatus: "loading" | "ready" | "error";
  onComponentSelect: (component: BackendComponentKey) => void;
  onEnvironmentSelect: (environment: string) => void;
  onLogout: () => void;
  onRefresh: () => void;
  onWorkflowAuditSelect: (workflowIdOrSessionId: string) => void;
  onViewSelect: (view: WorkspaceView) => void;
  selectedEnvironment: string;
  selectedTraceWorkflowId: string;
  user: AuthUser | null;
}) {
  const active = workspaceViews.find((view) => view.id === activeView) || workspaceViews[0];
  const platformViews = workspaceViews.filter((view) => view.group === "platform");
  const controlViews = workspaceViews.filter((view) => view.group === "control");
  const runtimeViews = workspaceViews.filter((view) => view.group === "runtime");
  const environmentOptions = ["all", ...data.environments.filter((environment) => environment !== "all")];
  const [platformTime, setPlatformTime] = useState(formatPlatformTime);

  useEffect(() => {
    const timer = window.setInterval(() => setPlatformTime(formatPlatformTime()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <main className="min-h-screen bg-ink text-textPrimary">
      <div className="app-backdrop pointer-events-none fixed inset-0 -z-20" />
      <div className="grid-overlay pointer-events-none fixed inset-0 -z-10 opacity-60" />

      <section className="sticky top-0 z-40 overflow-hidden border-b border-line bg-[#02070b] px-5 py-2 backdrop-blur-xl sm:px-8 lg:px-10">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(105deg,rgba(0,194,153,0.34)_0%,rgba(0,77,64,0.18)_18%,rgba(2,7,11,0.58)_44%,rgba(7,25,36,0.5)_72%,rgba(18,49,67,0.42)_100%)]" />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.08)_0%,transparent_34%,rgba(0,0,0,0.22)_100%)]" />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(0,255,213,0.16)_0%,transparent_26%,transparent_74%,rgba(56,189,248,0.12)_100%)]" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_14%_12%,rgba(0,200,150,0.22),transparent_34%),radial-gradient(circle_at_88%_0%,rgba(56,189,248,0.14),transparent_30%)]" />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(0,200,150,0.08)_1px,transparent_1px),linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[size:72px_72px] opacity-35" />
        <div className="relative grid gap-3 xl:grid-cols-[80px_1fr] xl:items-center">
          <div className="h-12 w-20 overflow-hidden">
            <img
              src="/brand/intelliguard-logo-transparent.png"
              alt="IntelliGuard"
              className="h-full w-full scale-[2.15] object-contain select-none"
              draggable={false}
            />
          </div>
          <div className="flex flex-wrap items-center justify-start gap-x-3 gap-y-2 text-xs xl:justify-end">
            <label className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-white/15 bg-white/[0.055] px-3">
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/55">
                Environment
              </span>
              <select
                value={selectedEnvironment}
                onChange={(event) => onEnvironmentSelect(event.target.value)}
                className="min-w-0 bg-transparent text-sm font-semibold text-white outline-none [&>option]:bg-[#02070b] [&>option]:text-white"
              >
                {environmentOptions.map((environment) => (
                  <option key={environment} value={environment}>
                    {environment === "all" ? "All environments" : environment}
                  </option>
                ))}
              </select>
            </label>
            <div className="inline-flex items-center gap-1">
              <ThemeToggle compact tone="banner" />
              <button
                type="button"
                onClick={onRefresh}
                className="grid h-9 w-9 place-items-center rounded-xl text-white/70 transition hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-[#2bd4aa]/45"
                aria-label="Refresh workspace"
              >
                <RefreshCw size={18} aria-hidden="true" />
              </button>
            </div>
            <div className="inline-flex items-center gap-2 whitespace-nowrap text-white/65">
              <Clock3 size={16} className="text-[#2bd4aa]" aria-hidden="true" />
              <span className="font-semibold text-white">Local</span>
              <time className="font-mono text-xs text-white/65" dateTime={platformTime}>
                {platformTime}
              </time>
            </div>
          </div>
        </div>
      </section>

      <div className="grid min-h-screen lg:grid-cols-[352px_minmax(0,1fr)]">
        <aside className="border-b border-line bg-panel/82 p-6 backdrop-blur-xl lg:sticky lg:top-[68px] lg:h-[calc(100vh-68px)] lg:overflow-y-auto lg:border-b-0 lg:border-r">
          <div className="flex h-full flex-col gap-7">
            <nav className="grid gap-6" aria-label="Platform sections">
              <WorkspaceNavStandalone
                activeView={activeView}
                onViewSelect={onViewSelect}
                views={platformViews}
              />
              <WorkspaceNavGroup
                activeView={activeView}
                label="Control Plane"
                onViewSelect={onViewSelect}
                tone="control"
                views={controlViews}
              />
              <WorkspaceNavGroup
                activeView={activeView}
                label="Runtime Plane"
                onViewSelect={onViewSelect}
                tone="runtime"
                views={runtimeViews}
              />
            </nav>

            <div className="mt-auto grid gap-3 border-t border-line pt-4">
              <div className="flex items-center gap-3 rounded-2xl border border-line bg-ink/45 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2 text-sm font-semibold">
                    <KeyRound className="shrink-0 text-accent" size={16} aria-hidden="true" />
                    <span className="truncate">{user?.name || user?.email}</span>
                  </div>
                  <p className="mt-1 truncate text-xs text-textSecondary">{user?.role}</p>
                </div>
                <button
                  type="button"
                  onClick={onLogout}
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-line bg-white/[0.04] text-textSecondary transition hover:border-accent/45 hover:bg-accent/10 hover:text-textPrimary focus:outline-none focus:ring-2 focus:ring-accent/40"
                  aria-label="Logout"
                  title="Logout"
                >
                  <LogOut size={17} aria-hidden="true" />
                </button>
              </div>
              <p className="px-1 text-[11px] leading-5 text-textSecondary">Copyright 2026 Intellidata Consulting.</p>
            </div>
          </div>
        </aside>

        <section className="min-w-0 p-5 sm:p-8 lg:p-10">
          <header className="mb-8">
            <span className="text-xs font-semibold uppercase tracking-[0.28em] text-accent">
              IntelliGuard Platform
            </span>
            <h1 className="mt-2 text-5xl font-semibold leading-none tracking-[-0.04em] text-textPrimary">
              {active.title}
            </h1>
            <p className="mt-3 max-w-3xl text-base leading-7 text-textSecondary">{active.description}</p>
          </header>

          {dataStatus === "error" ? (
            <div className="mb-6 rounded-3xl border border-red-400/45 bg-red-500/10 p-5 text-sm leading-6 text-red-200">
              Platform shell is authenticated, but live workspace data could not be loaded: {dataError}
            </div>
          ) : null}

          <WorkspaceViewContent
            activeComponent={activeComponent}
            activeView={activeView}
            data={data}
            dataStatus={dataStatus}
            onComponentSelect={onComponentSelect}
            onViewSelect={onViewSelect}
            onWorkflowAuditSelect={onWorkflowAuditSelect}
            onRefresh={onRefresh}
            selectedEnvironment={selectedEnvironment}
            selectedTraceWorkflowId={selectedTraceWorkflowId}
          />
        </section>
      </div>
      <FacilitatorBot />
    </main>
  );
}

function WorkspaceNavStandalone({
  activeView,
  onViewSelect,
  views,
}: {
  activeView: WorkspaceView;
  onViewSelect: (view: WorkspaceView) => void;
  views: typeof workspaceViews;
}) {
  return (
    <div className="grid gap-2">
      {views.map((view) => (
        <WorkspaceNavItem
          key={view.id}
          activeView={activeView}
          onViewSelect={onViewSelect}
          view={view}
        />
      ))}
    </div>
  );
}

function WorkspaceNavGroup({
  activeView,
  label,
  onViewSelect,
  tone,
  views,
}: {
  activeView: WorkspaceView;
  label: string;
  onViewSelect: (view: WorkspaceView) => void;
  tone: "control" | "runtime";
  views: typeof workspaceViews;
}) {
  const toneClasses = tone === "control" ? "border-cyan-300/40" : "border-amber-300/40";
  const labelClasses = tone === "control" ? "text-cyan-100/75" : "text-amber-100/75";

  return (
    <div className={`border-l-2 pl-3 ${toneClasses}`}>
      <p className={`px-2 text-[11px] font-semibold uppercase tracking-[0.22em] ${labelClasses}`}>
        {label}
      </p>
      <div className="mt-3 grid gap-1">
        {views.map((view) => (
          <WorkspaceNavItem
            key={view.id}
            activeView={activeView}
            onViewSelect={onViewSelect}
            view={view}
          />
        ))}
      </div>
    </div>
  );
}

function WorkspaceNavItem({
  activeView,
  onViewSelect,
  view,
}: {
  activeView: WorkspaceView;
  onViewSelect: (view: WorkspaceView) => void;
  view: (typeof workspaceViews)[number];
}) {
  return (
    <a
      href={`/platform/?view=${view.id}`}
      onClick={(event) => {
        event.preventDefault();
        onViewSelect(view.id);
      }}
      className={`rounded-xl px-4 py-3 text-sm font-semibold leading-tight transition focus:outline-none focus:ring-2 focus:ring-accent/40 ${
        activeView === view.id
          ? "bg-accent/[0.12] text-textPrimary shadow-[inset_3px_0_0_rgb(var(--color-accent))]"
          : "text-textSecondary hover:bg-white/[0.045] hover:text-textPrimary"
      }`}
    >
      <span className="block">{view.label}</span>
    </a>
  );
}
