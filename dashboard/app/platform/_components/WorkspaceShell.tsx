"use client";

import { useEffect, useState } from "react";
import { Clock3, KeyRound, LogOut, RefreshCw, ShieldCheck } from "lucide-react";
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
  onViewSelect,
  onWorkflowTraceSelect,
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
  onViewSelect: (view: WorkspaceView) => void;
  onWorkflowTraceSelect: (workflowId: string) => void;
  selectedEnvironment: string;
  selectedTraceWorkflowId: string;
  user: AuthUser | null;
}) {
  const active = workspaceViews.find((view) => view.id === activeView) || workspaceViews[0];
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

      <div className="grid min-h-screen lg:grid-cols-[352px_minmax(0,1fr)]">
        <aside className="border-b border-line bg-panel/82 p-6 backdrop-blur-xl lg:sticky lg:top-0 lg:h-screen lg:border-b-0 lg:border-r">
          <div className="flex h-full flex-col gap-7">
            <a href="/" className="flex items-center gap-3" aria-label="IntelliGuard home">
              <span className="grid h-12 w-12 place-items-center rounded-2xl border border-accent/30 bg-accent/10 text-accent teal-glow">
                <ShieldCheck size={24} aria-hidden="true" />
              </span>
              <span>
                <strong className="block text-lg tracking-tight">IntelliGuard</strong>
                <span className="text-sm text-textSecondary">AI governance control plane</span>
              </span>
            </a>

            <nav className="grid gap-3.5" aria-label="Platform sections">
              {workspaceViews.map((view) => (
                <a
                  key={view.id}
                  href={`/platform/?view=${view.id}`}
                  onClick={(event) => {
                    event.preventDefault();
                    onViewSelect(view.id);
                  }}
                  className={`rounded-[26px] border px-5 py-4 text-base font-semibold leading-tight transition focus:outline-none focus:ring-2 focus:ring-accent/40 ${
                    activeView === view.id
                      ? "border-accent/55 bg-accent/[0.14] text-textPrimary shadow-[inset_5px_0_0_rgb(var(--color-accent))]"
                      : "border-transparent bg-white/[0.025] text-textSecondary hover:border-line hover:bg-white/[0.07] hover:text-textPrimary"
                  }`}
                >
                  <span className="block">{view.label}</span>
                </a>
              ))}
            </nav>

            <div className="mt-auto grid gap-3">
              <div className="flex items-center gap-3 rounded-2xl border border-line bg-white/[0.06] p-3">
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
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-line bg-ink/55 text-textSecondary transition hover:border-accent/45 hover:bg-accent/10 hover:text-textPrimary focus:outline-none focus:ring-2 focus:ring-accent/40"
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
          <header className="mb-8 grid gap-5 lg:grid-cols-[1fr_auto] lg:items-start">
            <div>
              <span className="text-xs font-semibold uppercase tracking-[0.28em] text-accent">
                IntelliGuard Platform
              </span>
              <h1 className="mt-2 text-5xl font-semibold leading-none tracking-[-0.04em] text-textPrimary">
                {active.title}
              </h1>
              <p className="mt-3 max-w-3xl text-base leading-7 text-textSecondary">{active.description}</p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-3 text-sm">
              <label className="inline-flex min-h-11 items-center gap-3 rounded-2xl border border-line bg-white/[0.045] px-4">
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-textSecondary">
                  Environment
                </span>
                <select
                  value={selectedEnvironment}
                  onChange={(event) => onEnvironmentSelect(event.target.value)}
                  className="min-w-0 bg-transparent text-sm font-semibold text-textPrimary outline-none"
                >
                  {environmentOptions.map((environment) => (
                    <option key={environment} value={environment}>
                      {environment === "all" ? "All environments" : environment}
                    </option>
                  ))}
                </select>
              </label>
              <div className="inline-flex items-center gap-1">
                <ThemeToggle compact />
                <button
                  type="button"
                  onClick={onRefresh}
                  className="grid h-10 w-10 place-items-center rounded-xl text-textSecondary transition hover:bg-accent/10 hover:text-textPrimary focus:outline-none focus:ring-2 focus:ring-accent/40"
                  aria-label="Refresh workspace"
                >
                  <RefreshCw size={18} aria-hidden="true" />
                </button>
              </div>
              <div className="inline-flex items-center gap-2 whitespace-nowrap text-textSecondary">
                <Clock3 size={16} className="text-accent" aria-hidden="true" />
                <span className="font-semibold text-textPrimary">Local</span>
                <time className="font-mono text-xs text-textSecondary" dateTime={platformTime}>
                  {platformTime}
                </time>
              </div>
            </div>
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
            onRefresh={onRefresh}
            onWorkflowTraceSelect={onWorkflowTraceSelect}
            selectedEnvironment={selectedEnvironment}
            selectedTraceWorkflowId={selectedTraceWorkflowId}
          />
        </section>
      </div>
      <FacilitatorBot />
    </main>
  );
}
