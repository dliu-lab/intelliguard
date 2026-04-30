import { Activity, ArrowRight, Bot, Database, GitBranch, LockKeyhole, Network, ShieldCheck, TerminalSquare } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";

export function PlatformTransition() {
  const platformLayers = [
    {
      title: "Control Plane",
      description: "Policy, RBAC, risk scoring, approval paths, and audit evidence.",
      icon: ShieldCheck,
    },
    {
      title: "Execution Plane",
      description: "Agentic workflows, tools, APIs, unified gateway, and deployment paths.",
      icon: GitBranch,
    },
    {
      title: "Runtime Evidence",
      description: "Traces across prompts, tool calls, model decisions, reviews, and outcomes.",
      icon: Activity,
    },
  ];

  const orbitNodes = [
    { label: "Agents", icon: Bot, className: "left-[6%] top-[18%]" },
    { label: "Tools", icon: TerminalSquare, className: "right-[8%] top-[20%]" },
    { label: "RBAC", icon: LockKeyhole, className: "left-[12%] bottom-[17%]" },
    { label: "Unified Gateway", icon: Network, className: "right-[4%] bottom-[22%]" },
    { label: "Knowledge Bases", icon: Database, className: "left-1/2 top-[4%] -translate-x-1/2" },
  ];

  return (
    <main className="relative isolate min-h-screen overflow-hidden bg-ink text-textPrimary">
      <div className="app-backdrop pointer-events-none fixed inset-0 -z-30" />
      <div className="grid-overlay pointer-events-none fixed inset-0 -z-20 opacity-60" />
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_50%_28%,rgba(0,200,150,0.24),transparent_34%),radial-gradient(circle_at_16%_10%,rgba(0,200,150,0.16),transparent_28%)]" />

      <header className="border-b border-line bg-ink/75 backdrop-blur-xl">
        <nav className="section-shell flex min-h-16 flex-wrap items-center justify-between gap-4 py-4">
          <a href="/" className="flex items-center gap-3" aria-label="IntelliGuard home">
            <span className="grid h-9 w-9 place-items-center rounded-xl border border-accent/30 bg-accent/10 text-accent teal-glow">
              <ShieldCheck size={19} aria-hidden="true" />
            </span>
            <span className="text-base font-semibold tracking-tight">IntelliGuard</span>
          </a>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <a
              href="/?auth=login"
              className="hidden rounded-full border border-line bg-white/[0.04] px-4 py-2 text-sm font-semibold text-textPrimary transition hover:border-accent/45 hover:bg-accent/10 sm:inline-flex"
            >
              Login
            </a>
            <a
              href="/?auth=signup"
              className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-ink transition hover:bg-accent/90"
            >
              Try IntelliGuard
            </a>
          </div>
        </nav>
      </header>

      <section className="section-shell grid min-h-[calc(100vh-4rem)] items-center gap-12 py-16 lg:grid-cols-[0.9fr_1.1fr]">
        <div>
          <span className="text-xs font-semibold uppercase tracking-[0.28em] text-accent">Platform transition</span>
          <h1 className="mt-5 text-5xl font-semibold leading-[0.95] tracking-[-0.04em] text-textPrimary sm:text-6xl">
            From AI idea to governed runtime.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-textSecondary">
            IntelliGuard brings the public product story into the actual platform: design agents, connect tools and
            models, deploy workflows, and govern every runtime action through one control plane.
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <a
              href="/?auth=signup"
              className="inline-flex items-center justify-center gap-2 rounded-full bg-accent px-6 py-3 text-sm font-semibold text-ink transition hover:bg-accent/90 focus:outline-none focus:ring-2 focus:ring-accent/60"
            >
              Enter workspace
              <ArrowRight size={17} aria-hidden="true" />
            </a>
            <a
              href="/#governance"
              className="inline-flex items-center justify-center rounded-full border border-line bg-white/[0.04] px-6 py-3 text-sm font-semibold text-textPrimary transition hover:border-accent/50 hover:bg-accent/10"
            >
              View architecture
            </a>
          </div>
        </div>

        <div className="glass-card relative min-h-[560px] overflow-hidden rounded-[32px] p-5">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_48%,rgba(0,200,150,0.22),transparent_34%)]" />
          <div className="absolute left-1/2 top-1/2 h-[68%] w-[68%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-accent/20" />
          <div className="absolute left-1/2 top-1/2 h-[48%] w-[48%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-line" />

          {orbitNodes.map((node) => {
            const Icon = node.icon;

            return (
              <div
                key={node.label}
                className={`absolute z-10 flex items-center gap-2 rounded-full border border-line bg-ink/75 px-3 py-2 text-xs font-semibold text-textPrimary backdrop-blur ${node.className}`}
              >
                <Icon className="text-accent" size={15} aria-hidden="true" />
                {node.label}
              </div>
            );
          })}

          <div className="relative z-20 grid h-full min-h-[520px] place-items-center">
            <div className="w-full max-w-sm rounded-[28px] border border-accent/25 bg-ink/80 p-5 text-center shadow-[0_0_80px_rgba(0,200,150,0.18)] backdrop-blur-xl">
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl border border-accent/35 bg-accent/10 text-accent teal-glow">
                <ShieldCheck size={30} aria-hidden="true" />
              </div>
              <h2 className="mt-5 text-2xl font-semibold tracking-[-0.03em]">IntelliGuard Platform</h2>
              <p className="mt-3 text-sm leading-6 text-textSecondary">
                Control plane, workflow builder, deployment surface, and runtime evidence layer.
              </p>
              <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-white/10">
                <div className="h-full w-2/5 animate-[pulse_2.6s_ease-in-out_infinite] rounded-full bg-accent shadow-[0_0_24px_rgba(0,200,150,0.7)]" />
              </div>
            </div>
          </div>

          <div className="relative z-20 grid gap-3 md:grid-cols-3">
            {platformLayers.map((layer) => {
              const Icon = layer.icon;

              return (
                <article key={layer.title} className="rounded-2xl border border-line bg-ink/70 p-4 backdrop-blur">
                  <Icon className="text-accent" size={20} aria-hidden="true" />
                  <h3 className="mt-3 font-semibold text-textPrimary">{layer.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-textSecondary">{layer.description}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>
    </main>
  );
}
