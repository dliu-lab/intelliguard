"use client";

import { Boxes, CheckCircle2, Code2, Play, Rocket, ShieldCheck } from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";
import {
  activateWorkflowDeployment,
  createWorkflowDeployment,
  deployWorkflowDeployment,
  generateWorkflowDeploymentArtifacts,
  getSession,
  listWorkflowDeploymentArtifacts,
  listWorkflowDeploymentJobs,
  runWorkflowDeployment,
  type ApiRecord,
} from "@/lib/api";
import { formatTimestamp, readText } from "./utils";

interface WorkflowDeploymentPanelProps {
  graphHash: string;
  onRefresh: () => Promise<void> | void;
  onRunStarted: (runId: string) => void;
  workflowDefinitionId: string;
  workflowName: string;
}

type DeploymentStage =
  | "saved"
  | "certifying"
  | "certified"
  | "artifacts_generated"
  | "deploying"
  | "deployed"
  | "active"
  | "running"
  | "failed";

const STAGE_LABELS: Record<DeploymentStage, string> = {
  saved: "Saved",
  certifying: "Certifying",
  certified: "Certified",
  artifacts_generated: "Artifacts generated",
  deploying: "Deploying",
  deployed: "Deployed",
  active: "Active",
  running: "Running",
  failed: "Failed",
};

export function WorkflowDeploymentPanel({
  graphHash,
  onRefresh,
  onRunStarted,
  workflowDefinitionId,
  workflowName,
}: WorkflowDeploymentPanelProps) {
  const [stage, setStage] = useState<DeploymentStage>("saved");
  const [deployment, setDeployment] = useState<ApiRecord | null>(null);
  const [artifacts, setArtifacts] = useState<ApiRecord[]>([]);
  const [job, setJob] = useState<ApiRecord | null>(null);
  const [run, setRun] = useState<ApiRecord | null>(null);
  const [message, setMessage] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const deploymentId = readText(deployment || {}, ["deployment_id"]);
  const manifestHash = readText(deployment || {}, ["manifest_hash"]);
  const jobStatus = readText(job || {}, ["status"]);
  const workerPool = readText(job || {}, ["worker_pool"]) || "shared-readonly";
  const disabledReason = useMemo(() => {
    if (!workflowDefinitionId) {
      return "Workflow must be saved before deployment.";
    }
    if (stage === "failed") {
      return message || "Last deployment action failed.";
    }
    return "";
  }, [message, stage, workflowDefinitionId]);

  async function runAction(label: string, action: () => Promise<void>) {
    const session = getSession();
    if (!session?.token) {
      setMessage("Session expired. Login again before deployment actions.");
      return;
    }
    setBusyAction(label);
    setMessage("");
    try {
      await action();
      await onRefresh();
    } catch (error) {
      setStage("failed");
      setMessage(error instanceof Error ? error.message : "Deployment action failed.");
    } finally {
      setBusyAction("");
    }
  }

  async function createDeployment() {
    await runAction("deployment", async () => {
      const session = getSession();
      if (!session?.token) {
        throw new Error("Session expired.");
      }
      const next = await createWorkflowDeployment(session.token, workflowDefinitionId, {
        runtime_type: "native",
      });
      setDeployment(next);
      setStage("certified");
      setMessage("Deployment revision created.");
    });
  }

  async function generateArtifacts() {
    if (!deploymentId) {
      setMessage("Create a deployment revision first.");
      return;
    }
    await runAction("artifacts", async () => {
      const session = getSession();
      if (!session?.token) {
        throw new Error("Session expired.");
      }
      const rows = await generateWorkflowDeploymentArtifacts(session.token, deploymentId, {
        worker_pool: workerPool,
      });
      setArtifacts(rows);
      setStage("artifacts_generated");
      setMessage("Runtime artifacts generated.");
    });
  }

  async function deploy() {
    if (!deploymentId) {
      setMessage("Create a deployment revision first.");
      return;
    }
    await runAction("deploy", async () => {
      const session = getSession();
      if (!session?.token) {
        throw new Error("Session expired.");
      }
      const latestArtifacts = artifacts.length
        ? artifacts
        : await listWorkflowDeploymentArtifacts(session.token, deploymentId);
      setArtifacts(latestArtifacts);
      const next = await deployWorkflowDeployment(session.token, deploymentId, {
        backend: "local_compose",
        worker_pool: workerPool,
      });
      setJob(next);
      setStage(readText(next, ["status"]) === "RUNNING" ? "deployed" : "deploying");
      setMessage("Deployment job submitted.");
    });
  }

  async function activate() {
    if (!deploymentId) {
      setMessage("Create a deployment revision first.");
      return;
    }
    await runAction("activate", async () => {
      const session = getSession();
      if (!session?.token) {
        throw new Error("Session expired.");
      }
      const next = await activateWorkflowDeployment(session.token, deploymentId);
      setDeployment(next);
      setStage("active");
      setMessage("Deployment activated.");
    });
  }

  async function runDeployment() {
    if (!deploymentId) {
      setMessage("Create a deployment revision first.");
      return;
    }
    await runAction("run", async () => {
      const session = getSession();
      if (!session?.token) {
        throw new Error("Session expired.");
      }
      const next = await runWorkflowDeployment(session.token, {
        deployment_id: deploymentId,
        query: `Run ${workflowName || workflowDefinitionId}`,
        idempotency_key: `ui-${Date.now()}`,
      });
      setRun(next);
      setStage("running");
      const runId = readText(next, ["run_id", "workflow_id"]);
      if (runId) {
        onRunStarted(runId);
      }
      setMessage("Runtime run queued.");
    });
  }

  async function refreshJobs() {
    if (!deploymentId) {
      return;
    }
    await runAction("refresh", async () => {
      const session = getSession();
      if (!session?.token) {
        throw new Error("Session expired.");
      }
      const jobs = await listWorkflowDeploymentJobs(session.token, deploymentId);
      setJob(jobs[0] || null);
      setMessage("Deployment status refreshed.");
    });
  }

  return (
    <section className="mt-5 rounded-2xl border border-line bg-white/[0.035] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-textSecondary">
            <Boxes size={15} className="text-accent" aria-hidden="true" />
            Runtime deployment
          </div>
          <h4 className="mt-2 text-lg font-semibold text-textPrimary">{STAGE_LABELS[stage]}</h4>
        </div>
        <span className="rounded-full border border-line bg-ink/70 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-textSecondary">
          {workerPool}
        </span>
      </div>

      <div className="mt-4 grid gap-2 text-sm text-textSecondary md:grid-cols-2">
        <DeploymentDatum label="Workflow" value={workflowDefinitionId} />
        <DeploymentDatum label="Graph hash" value={graphHash || "pending"} />
        <DeploymentDatum label="Deployment" value={deploymentId || "not created"} />
        <DeploymentDatum label="Manifest" value={manifestHash || "not compiled"} />
        <DeploymentDatum label="Job" value={jobStatus || "not deployed"} />
        <DeploymentDatum label="Run" value={readText(run || {}, ["run_id"]) || "not queued"} />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <PanelButton busy={busyAction === "deployment"} icon={<ShieldCheck size={15} />} label="Create Deployment" onClick={createDeployment} />
        <PanelButton busy={busyAction === "artifacts"} disabled={!deploymentId} icon={<Code2 size={15} />} label="Generate Artifacts" onClick={generateArtifacts} />
        <PanelButton busy={busyAction === "deploy"} disabled={!deploymentId} icon={<Rocket size={15} />} label="Deploy" onClick={deploy} />
        <PanelButton busy={busyAction === "activate"} disabled={!deploymentId} icon={<CheckCircle2 size={15} />} label="Activate" onClick={activate} />
        <PanelButton busy={busyAction === "run"} disabled={!deploymentId} icon={<Play size={15} />} label="Run" onClick={runDeployment} />
        <button type="button" onClick={refreshJobs} disabled={!deploymentId} className="designer-action">
          Refresh
        </button>
      </div>

      {disabledReason ? <p className="mt-3 text-xs text-amber-200">{disabledReason}</p> : null}
      {message ? <p className="mt-3 text-sm text-textSecondary">{message}</p> : null}

      {artifacts.length ? (
        <div className="mt-4 grid gap-2">
          {artifacts.map((artifact) => (
            <div key={readText(artifact, ["artifact_id"])} className="rounded-xl border border-line bg-ink/60 p-3 text-xs text-textSecondary">
              <span className="font-semibold text-textPrimary">{readText(artifact, ["artifact_type"])}</span>
              <span className="ml-2">{readText(artifact, ["artifact_name"])}</span>
              <span className="ml-2">{readText(artifact, ["content_hash"])}</span>
            </div>
          ))}
        </div>
      ) : null}

      {job ? (
        <pre className="mt-4 max-h-36 overflow-auto whitespace-pre-wrap rounded-xl bg-ink/70 p-3 font-mono text-xs leading-5 text-textPrimary">
          {(Array.isArray(job.logs) ? job.logs : []).map(String).join("\n") || formatTimestamp(readText(job, ["created_at"]))}
        </pre>
      ) : null}
    </section>
  );
}

interface DeploymentDatumProps {
  label: string;
  value: string;
}

function DeploymentDatum({ label, value }: DeploymentDatumProps) {
  return (
    <div className="rounded-xl border border-line bg-ink/60 p-3">
      <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-textSecondary">{label}</p>
      <p className="mt-1 break-words font-mono text-xs text-textPrimary">{value}</p>
    </div>
  );
}

interface PanelButtonProps {
  busy: boolean;
  disabled?: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}

function PanelButton({ busy, disabled, icon, label, onClick }: PanelButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || disabled}
      className="inline-flex min-h-10 items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-4 text-sm font-semibold text-accent transition hover:border-accent/50 hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {icon}
      {busy ? "Working" : label}
    </button>
  );
}
