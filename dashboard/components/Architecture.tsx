"use client";

import { motion } from "framer-motion";

const controlPlane = [
  "Policy Engine",
  "Risk Scoring",
  "Approval Workflow",
  "Audit Trail",
  "RBAC",
  "LiteLLM Gateway",
  "Guardie",
  "Model Routing",
];
const executionPlane = [
  "Agentic Workflows",
  "Agents",
  "Tools",
  "APIs",
  "Data Sources",
  "LLMs",
  "Ollama Models",
  "Runtime Sessions",
];

export function Architecture() {
  return (
    <section id="architecture" className="section-shell py-24">
      <div className="mx-auto max-w-3xl text-center">
        <span className="text-xs font-semibold uppercase tracking-[0.28em] text-accent">Architecture</span>
        <h2 className="mt-4 text-3xl font-semibold tracking-[-0.03em] text-textPrimary sm:text-5xl">
          The execution plane runs. The control plane governs.
        </h2>
        <p className="mt-5 text-lg leading-8 text-textSecondary">
          Agentic workflows are the execution plane. IntelliGuard governs them through policy, authorization,
          evaluation, approval, model routing, and evidence capture.
        </p>
      </div>

      <div className="glass-card relative mt-14 overflow-hidden rounded-[32px] p-5 sm:p-8">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,rgba(0,200,150,0.13),transparent_30%)]" />
        <div className="relative grid gap-10">
          <ArchitectureLayer title="Control Plane" items={controlPlane} tone="control" />
          <FlowBridge />
          <ArchitectureLayer title="Execution Plane" items={executionPlane} tone="execution" />
        </div>
      </div>
    </section>
  );
}

function ArchitectureLayer({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: "control" | "execution";
}) {
  return (
    <div
      className={`rounded-3xl border p-5 ${
        tone === "control" ? "border-accent/25 bg-accent/[0.055]" : "border-line bg-white/[0.03]"
      }`}
    >
      <div className="mb-5 flex items-center justify-between gap-4">
        <h3 className="text-lg font-semibold text-textPrimary">{title}</h3>
        <span className="rounded-full border border-line bg-ink/50 px-3 py-1 text-xs uppercase tracking-[0.18em] text-textSecondary">
          {tone === "control" ? "governs" : "executes"}
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((item) => (
          <div key={item} className="rounded-2xl border border-line bg-panel/70 px-4 py-5 text-center text-sm text-textPrimary">
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}

function FlowBridge() {
  return (
    <div className="relative mx-auto h-16 w-full max-w-4xl" aria-hidden="true">
      <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-gradient-to-b from-accent via-accent/60 to-white/15" />
      <motion.div
        animate={{ y: [0, 48, 0], opacity: [0.25, 1, 0.25] }}
        transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
        className="absolute left-1/2 top-0 h-3 w-3 -translate-x-1/2 rounded-full bg-accent shadow-[0_0_24px_rgba(0,200,150,0.85)]"
      />
      <div className="absolute left-1/2 top-1/2 hidden h-px w-3/4 -translate-x-1/2 bg-gradient-to-r from-transparent via-white/12 to-transparent md:block" />
    </div>
  );
}
