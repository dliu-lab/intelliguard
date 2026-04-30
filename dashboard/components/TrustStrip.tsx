const signals = [
  "Runtime Control",
  "Agent Monitoring",
  "Risk Evaluation",
  "Audit Evidence",
  "Policy Enforcement",
  "RBAC",
  "LiteLLM Gateway",
];

export function TrustStrip() {
  return (
    <section aria-label="IntelliGuard platform signals" className="border-y border-line bg-panel/35 py-5 backdrop-blur">
      <div className="section-shell flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <p className="text-sm font-medium text-textPrimary">Designed for governed AI systems</p>
        <div className="flex flex-wrap gap-2">
          {signals.map((signal) => (
            <span
              key={signal}
              className="rounded-full border border-line bg-white/[0.035] px-3 py-1.5 font-mono text-[11px] uppercase text-textSecondary"
            >
              {signal}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
