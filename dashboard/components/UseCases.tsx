const useCases = [
  {
    title: "AI code review governance",
    problem: "Autonomous code agents can approve changes without enough policy context.",
    help: "IntelliGuard scores agent actions against engineering controls, ownership rules, and release policy.",
    outcome: "High-risk changes route to review before they merge or deploy.",
  },
  {
    title: "Agent runtime monitoring",
    problem: "Teams cannot see how agents use tools, context, prompts, and delegated steps.",
    help: "IntelliGuard captures runtime traces and links decisions to agent identity, permissions, and policies.",
    outcome: "Operations teams get searchable evidence for every autonomous workflow.",
  },
  {
    title: "Enterprise LLM risk controls",
    problem: "Model outputs and tool calls need enforcement before they touch customer or production systems.",
    help: "IntelliGuard blocks, approves, escalates, or audits actions through runtime governance hooks.",
    outcome: "Risk teams get enforceable control without slowing engineering delivery.",
  },
];

export function UseCases() {
  return (
    <section id="use-cases" className="section-shell py-24">
      <div className="max-w-3xl">
        <span className="text-xs font-semibold uppercase tracking-[0.28em] text-accent">Use cases</span>
        <h2 className="mt-4 text-3xl font-semibold tracking-[-0.03em] text-textPrimary sm:text-5xl">
          Governance where agentic work happens.
        </h2>
      </div>

      <div className="mt-12 grid gap-4 lg:grid-cols-3">
        {useCases.map((useCase) => (
          <article key={useCase.title} className="glass-card rounded-3xl p-6">
            <h3 className="text-xl font-semibold text-textPrimary">{useCase.title}</h3>
            <dl className="mt-6 grid gap-5">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">Problem</dt>
                <dd className="mt-2 text-sm leading-6 text-textSecondary">{useCase.problem}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">How IntelliGuard helps</dt>
                <dd className="mt-2 text-sm leading-6 text-textSecondary">{useCase.help}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">Outcome</dt>
                <dd className="mt-2 text-sm leading-6 text-textSecondary">{useCase.outcome}</dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}
