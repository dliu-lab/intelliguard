"use client";

import { useState, type FormEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight, FileSearch, MessageCircle, SendHorizontal, ShieldCheck, Sparkles, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";

const actions: Array<{ label: string; detail: string; icon: LucideIcon }> = [
  { label: "Inspect risk", detail: "Review blocked steps", icon: FileSearch },
  { label: "View policy", detail: "Check controls", icon: ShieldCheck },
  { label: "Audit trail", detail: "Open evidence", icon: MessageCircle },
];

function GuardieAvatar({ compact = false, active = false }: { compact?: boolean; active?: boolean }) {
  return (
    <span className={`guardie-avatar ${compact ? "guardie-avatar-compact" : ""}`} data-active={active} aria-hidden="true">
      <span className="guardie-halo" />
      <span className="guardie-antenna">
        <span />
      </span>
      <span className="guardie-ear guardie-ear-left" />
      <span className="guardie-ear guardie-ear-right" />
      <span className="guardie-shell">
        <span className="guardie-faceplate">
          <span className="guardie-eye guardie-eye-left" />
          <span className="guardie-eye guardie-eye-right" />
          <span className="guardie-mouth" />
        </span>
      </span>
      <span className="guardie-body">
        <span className="guardie-body-mark">
          <ShieldCheck size={compact ? 10 : 13} strokeWidth={2.4} />
        </span>
      </span>
      <span className="guardie-shadow" />
    </span>
  );
}

export function FacilitatorBot() {
  const [open, setOpen] = useState(false);
  const [chatDraft, setChatDraft] = useState("");

  function handleChatSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setChatDraft("");
  }

  return (
    <div className="fixed bottom-5 right-5 z-50">
      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.96 }}
            transition={{ duration: 0.22 }}
            className="guardie-panel glass-card mb-3 w-[min(360px,calc(100vw-40px))] rounded-[28px] p-4"
          >
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <strong className="block text-sm text-textPrimary">Guardie</strong>
                  <span className="inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-accent">
                    <Sparkles size={10} aria-hidden="true" />
                    Live
                  </span>
                </div>
                <span className="mt-1 block text-xs text-textSecondary">Your Guide</span>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-line bg-white/[0.04] text-textSecondary transition hover:border-accent/45 hover:bg-accent/10 hover:text-textPrimary focus:outline-none focus:ring-2 focus:ring-accent/35"
                aria-label="Close Guardie assistant"
              >
                <X size={15} aria-hidden="true" />
              </button>
            </div>
            <p className="mt-4 text-sm leading-6 text-textSecondary">
              I can help trace agent decisions, spot blocked steps, and connect policies to the evidence behind them.
            </p>
            <div className="mt-4 grid gap-2">
              {actions.map(({ detail, icon: Icon, label }) => (
                <button
                  key={label}
                  className="group/action grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-2xl border border-line bg-white/[0.04] px-3 py-2.5 text-left transition hover:border-accent/45 hover:bg-accent/10 focus:outline-none focus:ring-2 focus:ring-accent/35"
                  type="button"
                >
                  <span className="grid h-8 w-8 place-items-center rounded-xl border border-accent/25 bg-accent/10 text-accent">
                    <Icon size={15} aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold text-textPrimary">{label}</span>
                    <span className="block truncate text-[11px] text-textSecondary">{detail}</span>
                  </span>
                  <ChevronRight
                    size={14}
                    className="text-textSecondary transition group-hover/action:translate-x-0.5 group-hover/action:text-accent"
                    aria-hidden="true"
                  />
                </button>
              ))}
            </div>
            <form
              className="mt-4 grid grid-cols-[1fr_auto] items-center gap-2 rounded-2xl border border-line bg-ink/45 p-2"
              onSubmit={handleChatSubmit}
            >
              <label className="sr-only" htmlFor="guardie-chat-input">
                Ask Guardie
              </label>
              <input
                id="guardie-chat-input"
                value={chatDraft}
                onChange={(event) => setChatDraft(event.target.value)}
                className="min-h-10 min-w-0 bg-transparent px-2 text-sm text-textPrimary outline-none placeholder:text-textSecondary"
                placeholder="Ask about agents, traces, policies..."
              />
              <button
                type="submit"
                disabled={!chatDraft.trim()}
                className="grid h-10 w-10 place-items-center rounded-xl bg-accent text-ink transition hover:bg-accent/90 focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:cursor-not-allowed disabled:bg-white/[0.08] disabled:text-textSecondary"
                aria-label="Send message to Guardie"
              >
                <SendHorizontal size={16} aria-hidden="true" />
              </button>
            </form>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <motion.button
        type="button"
        aria-label={open ? "Close Guardie assistant" : "Open Guardie assistant"}
        onClick={() => setOpen((current) => !current)}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.98 }}
        animate={{ y: [0, -6, 0] }}
        transition={{ y: { duration: 3, repeat: Infinity, ease: "easeInOut" } }}
        className="guardie-trigger group relative grid h-[92px] w-[92px] place-items-center rounded-full text-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
      >
        <GuardieAvatar active={open} />
      </motion.button>
    </div>
  );
}
