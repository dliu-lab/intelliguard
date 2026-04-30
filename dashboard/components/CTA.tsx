import { ArrowRight } from "lucide-react";

export function CTA() {
  return (
    <section id="contact" className="section-shell py-24">
      <div className="glass-card relative overflow-hidden rounded-[32px] px-6 py-16 text-center sm:px-12">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,rgba(0,200,150,0.16),transparent_32%)]" />
        <div className="relative mx-auto max-w-3xl">
          <h2 className="text-3xl font-semibold tracking-[-0.03em] text-textPrimary sm:text-5xl">
            Bring control to autonomous AI.
          </h2>
          <p className="mt-5 text-lg leading-8 text-textSecondary">
            IntelliGuard helps teams monitor, evaluate, and govern AI actions before they become business risk.
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <a
              href="#developers"
              className="inline-flex items-center justify-center gap-2 rounded-full bg-accent px-6 py-3 text-sm font-semibold text-ink transition hover:bg-accent/90"
            >
              Explore Developer Hooks
              <ArrowRight size={17} aria-hidden="true" />
            </a>
            <a
              href="#architecture"
              className="inline-flex items-center justify-center rounded-full border border-line bg-white/[0.04] px-6 py-3 text-sm font-semibold text-textPrimary transition hover:border-accent/50 hover:bg-accent/10"
            >
              View Architecture
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
