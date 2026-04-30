import { CheckCircle2 } from "lucide-react";

const bullets = [
  "API-first governance hooks",
  "Policy-as-code ready",
  "Works with agent frameworks",
  "Built for runtime evidence",
];

const code = `const decision = await intelliguard.evaluate({
  agentId: "claims-agent",
  action: "approve_refund",
  context: {
    customerTier: "enterprise",
    refundAmount: 4200,
    policyVersion: "v3.2"
  }
});

if (decision.status === "blocked") {
  await intelliguard.escalate(decision);
}`;

export function DeveloperSection() {
  return (
    <section id="developers" className="section-shell py-24">
      <div className="grid items-center gap-8 lg:grid-cols-[1.05fr_0.75fr]">
        <div>
          <span className="text-xs font-semibold uppercase tracking-[0.28em] text-accent">Developers</span>
          <h2 className="mt-4 text-3xl font-semibold tracking-[-0.03em] text-textPrimary sm:text-5xl">
            Built for engineers, trusted by risk teams.
          </h2>
          <div className="glass-card mt-8 overflow-hidden rounded-3xl">
            <div className="flex items-center gap-2 border-b border-line px-5 py-3">
              <span className="h-2.5 w-2.5 rounded-full bg-red-400/80" />
              <span className="h-2.5 w-2.5 rounded-full bg-yellow-400/80" />
              <span className="h-2.5 w-2.5 rounded-full bg-accent/80" />
              <span className="ml-3 font-mono text-xs text-textSecondary">runtime-governance.ts</span>
            </div>
            <pre className="overflow-x-auto p-5 text-sm leading-7 text-textPrimary">
              <code>{code}</code>
            </pre>
          </div>
        </div>

        <aside className="glass-card rounded-3xl p-6">
          <h3 className="text-lg font-semibold text-textPrimary">Runtime control without heavy lift.</h3>
          <ul className="mt-6 grid gap-4">
            {bullets.map((bullet) => (
              <li key={bullet} className="flex items-start gap-3 text-sm text-textSecondary">
                <CheckCircle2 className="mt-0.5 shrink-0 text-accent" size={18} aria-hidden="true" />
                <span>{bullet}</span>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </section>
  );
}
