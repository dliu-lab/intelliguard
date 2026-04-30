"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bot, ChevronRight } from "lucide-react";

const actions = ["Inspect Risk", "View Policy", "Audit Trail"];

export function FacilitatorBot() {
  const [open, setOpen] = useState(false);

  return (
    <div className="fixed bottom-5 right-5 z-50">
      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.96 }}
            transition={{ duration: 0.22 }}
            className="glass-card mb-3 w-[min(320px,calc(100vw-40px))] rounded-3xl p-4"
          >
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-2xl border border-accent/35 bg-accent/10 text-accent">
                <Bot size={19} aria-hidden="true" />
              </div>
              <div>
                <strong className="block text-sm text-textPrimary">Guardie</strong>
                <span className="text-xs text-textSecondary">Platform facilitator</span>
              </div>
            </div>
            <p className="mt-4 text-sm leading-6 text-textSecondary">
              I can help you inspect risks, policies, and agent actions.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {actions.map((action) => (
                <button
                  key={action}
                  className="inline-flex items-center gap-1 rounded-full border border-line bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-textPrimary transition hover:border-accent/45 hover:bg-accent/10"
                  type="button"
                >
                  {action}
                  <ChevronRight size={13} aria-hidden="true" />
                </button>
              ))}
            </div>
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
        className="group relative grid h-16 w-16 place-items-center rounded-full border border-accent/40 bg-accent/10 text-accent shadow-[0_0_42px_rgba(0,200,150,0.34)] backdrop-blur-xl"
      >
        <span className="absolute inset-2 rounded-full bg-accent/15 blur-md transition group-hover:bg-accent/25" />
        <span className="relative h-7 w-7 rounded-full bg-gradient-to-br from-accent to-emerald-300 shadow-[0_0_28px_rgba(0,200,150,0.72)]">
          <span className="absolute left-2 top-2 h-1.5 w-1.5 rounded-full bg-ink/80" />
          <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-ink/80" />
        </span>
      </motion.button>
    </div>
  );
}
