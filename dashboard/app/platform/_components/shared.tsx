import type { FormEvent } from "react";

export type RecordRow = { title: string; detail: string; meta?: string };

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
        <button
          type="button"
          onClick={onReset}
          className="rounded-full border border-line bg-white/[0.04] px-4 py-2 text-sm font-semibold transition hover:border-accent/40 hover:bg-accent/10"
        >
          Use Template
        </button>
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

export function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-line bg-white/[0.035] p-4">
      <p className="text-xs text-textSecondary">{label}</p>
      <p className="mt-1 font-semibold text-textPrimary">{value}</p>
    </div>
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

export function MetricCard({ label, value, loading }: { label: string; value: number; loading: boolean }) {
  return (
    <div className="rounded-3xl border border-line bg-white/[0.04] p-5 backdrop-blur">
      <p className="text-sm text-textSecondary">{label}</p>
      <p className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-textPrimary">
        {loading ? "..." : value}
      </p>
    </div>
  );
}

export function RecordList({ emptyText, rows }: { emptyText: string; rows: RecordRow[] }) {
  return (
    <section className="glass-card rounded-3xl p-6">
      <div className="grid gap-3">
        {rows.length ? (
          rows.slice(0, 12).map((row, index) => (
            <ComponentRow key={row.title + "-" + index} title={row.title} detail={row.detail} meta={row.meta} />
          ))
        ) : (
          <ComponentRow title="No records" detail={emptyText} />
        )}
      </div>
    </section>
  );
}
