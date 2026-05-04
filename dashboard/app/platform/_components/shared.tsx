import type { FormEvent, MouseEvent, ReactNode } from "react";

type RecordRow = { title: string; detail: string; meta?: string };
export type PlatformToneName = "emerald" | "sky" | "amber" | "fuchsia" | "indigo" | "rose" | "cyan";

export const platformTones: Record<
  PlatformToneName,
  {
    edge: string;
    metric: string;
    surface: string;
  }
> = {
  amber: {
    edge: "from-amber-300/75 via-orange-300/40 to-transparent",
    metric: "border-amber-300/26 bg-[linear-gradient(145deg,rgba(251,191,36,0.15),rgba(255,255,255,0.035)_55%,rgba(245,158,11,0.08))]",
    surface:
      "border-amber-300/28 bg-[radial-gradient(circle_at_14%_0%,rgba(251,191,36,0.2),transparent_34%),linear-gradient(135deg,rgba(251,191,36,0.09),rgba(255,255,255,0.035)_50%,rgba(245,158,11,0.08))]",
  },
  cyan: {
    edge: "from-cyan-300/75 via-sky-300/45 to-transparent",
    metric: "border-cyan-300/24 bg-[linear-gradient(145deg,rgba(34,211,238,0.16),rgba(255,255,255,0.035)_55%,rgba(14,165,233,0.08))]",
    surface:
      "border-cyan-300/26 bg-[radial-gradient(circle_at_82%_0%,rgba(34,211,238,0.2),transparent_32%),linear-gradient(135deg,rgba(34,211,238,0.09),rgba(255,255,255,0.035)_48%,rgba(14,165,233,0.08))]",
  },
  emerald: {
    edge: "from-emerald-300/80 via-teal-300/50 to-transparent",
    metric: "border-emerald-300/24 bg-[linear-gradient(145deg,rgba(16,185,129,0.16),rgba(255,255,255,0.035)_55%,rgba(20,184,166,0.08))]",
    surface:
      "border-emerald-300/28 bg-[radial-gradient(circle_at_14%_0%,rgba(16,185,129,0.24),transparent_34%),linear-gradient(135deg,rgba(16,185,129,0.11),rgba(255,255,255,0.035)_46%,rgba(20,184,166,0.08))]",
  },
  fuchsia: {
    edge: "from-fuchsia-300/65 via-violet-300/40 to-transparent",
    metric: "border-fuchsia-300/22 bg-[linear-gradient(145deg,rgba(217,70,239,0.13),rgba(255,255,255,0.035)_55%,rgba(168,85,247,0.075))]",
    surface:
      "border-fuchsia-300/24 bg-[radial-gradient(circle_at_82%_0%,rgba(217,70,239,0.18),transparent_33%),linear-gradient(135deg,rgba(217,70,239,0.075),rgba(255,255,255,0.035)_48%,rgba(168,85,247,0.075))]",
  },
  indigo: {
    edge: "from-indigo-300/70 via-violet-300/42 to-transparent",
    metric: "border-indigo-300/24 bg-[linear-gradient(145deg,rgba(129,140,248,0.14),rgba(255,255,255,0.035)_55%,rgba(99,102,241,0.08))]",
    surface:
      "border-indigo-300/24 bg-[radial-gradient(circle_at_82%_0%,rgba(129,140,248,0.18),transparent_33%),linear-gradient(135deg,rgba(129,140,248,0.08),rgba(255,255,255,0.035)_48%,rgba(99,102,241,0.075))]",
  },
  rose: {
    edge: "from-rose-300/68 via-pink-300/40 to-transparent",
    metric: "border-rose-300/22 bg-[linear-gradient(145deg,rgba(251,113,133,0.13),rgba(255,255,255,0.035)_55%,rgba(244,63,94,0.075))]",
    surface:
      "border-rose-300/22 bg-[radial-gradient(circle_at_14%_0%,rgba(251,113,133,0.16),transparent_34%),linear-gradient(135deg,rgba(251,113,133,0.075),rgba(255,255,255,0.035)_50%,rgba(244,63,94,0.075))]",
  },
  sky: {
    edge: "from-sky-300/75 via-cyan-300/45 to-transparent",
    metric: "border-sky-300/24 bg-[linear-gradient(145deg,rgba(56,189,248,0.15),rgba(255,255,255,0.035)_55%,rgba(34,211,238,0.08))]",
    surface:
      "border-sky-300/26 bg-[radial-gradient(circle_at_82%_0%,rgba(56,189,248,0.22),transparent_32%),linear-gradient(135deg,rgba(56,189,248,0.09),rgba(255,255,255,0.035)_48%,rgba(34,211,238,0.08))]",
  },
};

interface PlatformSurfaceProps {
  ariaLabel?: string;
  children: ReactNode;
  className?: string;
  href?: string;
  interactive?: boolean;
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
  tone?: PlatformToneName;
}

export function PlatformSurface({
  ariaLabel,
  children,
  className = "",
  href,
  interactive = false,
  onClick,
  tone = "emerald",
}: PlatformSurfaceProps) {
  const toneClasses = platformTones[tone];
  const classes = `group relative overflow-hidden rounded-3xl border p-5 text-left shadow-[0_18px_60px_rgba(0,0,0,0.16)] ${toneClasses.surface} ${
    interactive ? "transition hover:-translate-y-0.5 hover:border-accent/45 focus:outline-none focus:ring-2 focus:ring-accent/40" : ""
  } ${className}`;
  const content = (
    <>
      <div className={`pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${toneClasses.edge}`} />
      <div className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full bg-white/[0.055] blur-2xl transition group-hover:scale-110" />
      <div className="pointer-events-none absolute -bottom-24 left-10 h-44 w-44 rounded-full bg-ink/20 blur-3xl" />
      <div className="relative">{children}</div>
    </>
  );

  if (href) {
    return (
      <a aria-label={ariaLabel} className={classes} href={href} onClick={onClick}>
        {content}
      </a>
    );
  }

  return <div className={classes}>{content}</div>;
}

interface MetricSurfaceProps {
  label: string;
  loading: boolean;
  tone?: PlatformToneName;
  value: number;
}

export function MetricSurface({ label, loading, tone = "emerald", value }: MetricSurfaceProps) {
  const toneClasses = platformTones[tone];

  return (
    <div className={`relative overflow-hidden rounded-3xl border p-4 shadow-[0_14px_42px_rgba(0,0,0,0.12)] backdrop-blur ${toneClasses.metric}`}>
      <div className="pointer-events-none absolute -right-8 -top-8 h-20 w-20 rounded-full bg-white/[0.075] blur-xl" />
      <div className="pointer-events-none absolute inset-x-3 bottom-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />
      <div className="relative">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-textSecondary">{label}</p>
        <div className="mt-4 flex items-end justify-between gap-3">
          <p className="text-3xl font-semibold tracking-[-0.03em] text-textPrimary">{loading ? "..." : value}</p>
          <span className="h-1.5 w-10 rounded-full bg-white/20">
            <span className={`block h-full w-2/3 rounded-full bg-gradient-to-r ${toneClasses.edge}`} />
          </span>
        </div>
      </div>
    </div>
  );
}

export function JsonBuilder({
  cancelLabel = "Cancel",
  endpoint: _endpoint,
  json,
  onCancel,
  onChange,
  onReset,
  onSubmit,
  submitLabel,
  title,
}: {
  cancelLabel?: string;
  endpoint: string;
  json: string;
  onCancel?: () => void;
  onChange: (value: string) => void;
  onReset: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  submitLabel: string;
  title: string;
}) {
  return (
    <form className="glass-card rounded-3xl p-5" onSubmit={onSubmit}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h3 className="text-xl font-semibold">{title}</h3>
      </div>
      <textarea
        className="mt-5 min-h-[360px] w-full resize-y rounded-2xl border border-line bg-ink/80 p-4 font-mono text-xs leading-6 text-textPrimary outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/20"
        spellCheck={false}
        value={json}
        onChange={(event) => onChange(event.target.value)}
      />
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="submit"
          className="rounded-full bg-accent px-5 py-3 text-sm font-semibold text-ink transition hover:bg-accent/90"
        >
          {submitLabel}
        </button>
        <button
          type="button"
          onClick={onReset}
          className="rounded-full border border-line bg-white/[0.04] px-5 py-3 text-sm font-semibold text-textPrimary transition hover:border-accent/40 hover:bg-accent/10"
        >
          Reset
        </button>
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full border border-line bg-white/[0.04] px-5 py-3 text-sm font-semibold text-textPrimary transition hover:border-accent/40 hover:bg-accent/10"
          >
            {cancelLabel}
          </button>
        ) : null}
      </div>
    </form>
  );
}

export function ResourceGrid({ emptyText, label = "Registered", rows }: { emptyText: string; label?: string; rows: RecordRow[] }) {
  return (
    <section className="glass-card rounded-3xl p-5">
      <span className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">{label}</span>
      <div className="mt-5 grid gap-3">
        {rows.length ? (
          rows.map((row, index) => (
            <ComponentRow key={row.title + "-" + index} title={row.title} detail={row.detail} meta={row.meta} />
          ))
        ) : (
          <ComponentRow title="No records" detail={emptyText} />
        )}
      </div>
    </section>
  );
}

export function ComponentRow({ title, detail, meta }: RecordRow) {
  return (
    <div className="grid gap-3 rounded-2xl border border-line bg-white/[0.035] p-4 sm:grid-cols-[1fr_auto] sm:items-center">
      <div>
        <p className="font-semibold text-textPrimary">{title}</p>
        <p className="mt-1 text-sm leading-6 text-textSecondary">{detail}</p>
      </div>
      {meta ? (
        <span className="w-fit rounded-full border border-line bg-ink/70 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-textSecondary">
          {meta}
        </span>
      ) : null}
    </div>
  );
}
