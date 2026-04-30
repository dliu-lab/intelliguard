import { Activity, FileCheck2, Gauge, ShieldCheck } from "lucide-react";
import { CapabilityCard } from "./CapabilityCard";

const capabilities = [
  {
    icon: Activity,
    title: "Monitor agent actions",
    description: "Observe autonomous workflows, tool calls, context usage, and decision paths.",
  },
  {
    icon: Gauge,
    title: "Evaluate risk",
    description: "Score actions against policy, business rules, safety frameworks, and operational thresholds.",
  },
  {
    icon: ShieldCheck,
    title: "Enforce controls",
    description: "Block, approve, route, or escalate actions before they impact production systems.",
  },
  {
    icon: FileCheck2,
    title: "Audit decisions",
    description: "Preserve evidence across prompts, outputs, tool executions, policies, and approvals.",
  },
];

export function Capabilities() {
  return (
    <section id="governance" className="section-shell relative z-10 py-24">
      <div className="max-w-3xl">
        <span className="text-xs font-semibold uppercase tracking-[0.28em] text-accent">Platform capabilities</span>
        <h2 className="mt-4 text-3xl font-semibold tracking-[-0.03em] text-textPrimary sm:text-5xl">
          Control surfaces for the full agent platform.
        </h2>
        <p className="mt-5 text-lg leading-8 text-textSecondary">
          IntelliGuard is the platform shell around agentic execution: create agents and tools, route models through
          one gateway, authorize access, and govern runtime behavior.
        </p>
      </div>

      <div className="mt-12 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {capabilities.map((capability) => (
          <CapabilityCard key={capability.title} {...capability} />
        ))}
      </div>
    </section>
  );
}
