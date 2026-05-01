"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";

const SPLASH_STORAGE_KEY = "intelliguard-splash-seen";
const SPLASH_DURATION_MS = 2600;
const REDUCED_MOTION_DURATION_MS = 900;

function shouldSkipForAuth(search: string) {
  const params = new URLSearchParams(search);
  const authMode = params.get("auth");

  return authMode === "login" || authMode === "signup";
}

export function BrandSplash() {
  const reduceMotion = useReducedMotion();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (shouldSkipForAuth(window.location.search)) {
      return undefined;
    }

    try {
      if (sessionStorage.getItem(SPLASH_STORAGE_KEY) === "true") {
        return undefined;
      }

      sessionStorage.setItem(SPLASH_STORAGE_KEY, "true");
    } catch {
      // Storage can be blocked in private or hardened browser modes; still show once for this load.
    }

    setVisible(true);
    const timeout = window.setTimeout(
      () => setVisible(false),
      reduceMotion ? REDUCED_MOTION_DURATION_MS : SPLASH_DURATION_MS,
    );

    return () => window.clearTimeout(timeout);
  }, [reduceMotion]);

  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          aria-label="IntelliGuard loading"
          aria-live="polite"
          className="fixed inset-0 z-[10000] grid place-items-center overflow-hidden bg-[#02070b] text-textPrimary"
          exit={{ opacity: 0 }}
          initial={{ opacity: 1 }}
          role="status"
          transition={{ duration: reduceMotion ? 0.25 : 0.65, ease: "easeInOut" }}
        >
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgba(0,200,150,0.2),transparent_34%),radial-gradient(circle_at_50%_50%,rgba(255,255,255,0.06),transparent_46%)]" />
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(0,200,150,0.08)_1px,transparent_1px),linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[size:80px_80px] opacity-35" />
          <motion.div
            className="relative grid w-full max-w-[720px] place-items-center px-8 text-center"
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: 18 }}
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: reduceMotion ? 0.25 : 0.8, ease: "easeOut" }}
          >
            <motion.div
              aria-hidden="true"
              className="absolute h-72 w-72 rounded-full bg-accent/20 blur-3xl"
              animate={reduceMotion ? undefined : { opacity: [0.35, 0.72, 0.35], scale: [0.9, 1.12, 0.9] }}
              transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
            />
            <motion.img
              src="/brand/intelliguard-logo.png"
              alt="IntelliGuard"
              className="relative z-10 w-full max-w-[420px] select-none drop-shadow-[0_0_42px_rgba(0,200,150,0.32)] sm:max-w-[520px]"
              draggable={false}
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
              animate={reduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1 }}
              transition={{ duration: reduceMotion ? 0.25 : 0.9, delay: reduceMotion ? 0 : 0.15, ease: "easeOut" }}
            />
            <motion.p
              className="relative z-10 mt-6 text-xs font-semibold uppercase tracking-[0.34em] text-textSecondary"
              initial={{ opacity: 0, y: reduceMotion ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: reduceMotion ? 0.2 : 0.55, delay: reduceMotion ? 0.1 : 0.75 }}
            >
              Governance wired into AI runtime
            </motion.p>
            <div className="relative z-10 mt-7 h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-white/10">
              <motion.div
                className="h-full w-2/5 rounded-full bg-accent shadow-[0_0_26px_rgba(0,200,150,0.72)]"
                animate={reduceMotion ? { opacity: 1 } : { x: ["-120%", "260%"] }}
                transition={reduceMotion ? { duration: 0.1 } : { duration: 1.45, repeat: Infinity, ease: "easeInOut" }}
              />
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
