import type { LucideIcon } from "lucide-react";

type CapabilityCardProps = {
  icon: LucideIcon;
  title: string;
  description: string;
};

export function CapabilityCard({ icon: Icon, title, description }: CapabilityCardProps) {
  return (
    <article className="glass-card group rounded-3xl p-6 transition duration-300 hover:-translate-y-1 hover:border-accent/35">
      <div className="mb-8 grid h-12 w-12 place-items-center rounded-2xl border border-accent/25 bg-accent/10 text-accent transition group-hover:shadow-glow">
        <Icon size={22} strokeWidth={2.1} aria-hidden="true" />
      </div>
      <h3 className="text-xl font-semibold tracking-tight text-textPrimary">{title}</h3>
      <p className="mt-3 leading-7 text-textSecondary">{description}</p>
    </article>
  );
}
