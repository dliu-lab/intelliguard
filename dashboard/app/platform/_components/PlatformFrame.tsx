import type { ReactNode } from "react";
import { ShieldCheck } from "lucide-react";

export function PlatformFrame({ message, children }: { message: string; children?: ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center bg-ink px-4 text-textPrimary">
      <div className="glass-card grid w-full max-w-xl place-items-center rounded-3xl p-8 text-center">
        <div className="grid h-12 w-12 place-items-center rounded-2xl border border-accent/30 bg-accent/10 text-accent teal-glow">
          <ShieldCheck size={24} aria-hidden="true" />
        </div>
        <h1 className="mt-6 text-3xl font-semibold tracking-[-0.03em]">{message}</h1>
        {children}
      </div>
    </main>
  );
}
