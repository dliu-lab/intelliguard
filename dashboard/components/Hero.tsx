"use client";

import { motion } from "framer-motion";
import { ArrowRight, Play, ShieldCheck } from "lucide-react";
import { useState } from "react";

const controlNodes = [
  { label: "Policy", top: "18%", left: "14%" },
  { label: "Risk", top: "30%", left: "76%" },
  { label: "Audit", top: "70%", left: "20%" },
  { label: "RBAC", top: "74%", left: "72%" },
];

const particleSeeds = [
  { x: 7, y: 44, size: 3, depth: 18, delay: 0 },
  { x: 10, y: 60, size: 2, depth: 26, delay: 0.7 },
  { x: 16, y: 51, size: 2, depth: 16, delay: 1.2 },
  { x: 28, y: 34, size: 2, depth: -20, delay: 0.3 },
  { x: 36, y: 73, size: 3, depth: 28, delay: 1.6 },
  { x: 52, y: 63, size: 2, depth: -26, delay: 0.5 },
  { x: 63, y: 28, size: 2, depth: 20, delay: 1.1 },
  { x: 71, y: 76, size: 3, depth: -16, delay: 0.9 },
  { x: 82, y: 58, size: 2, depth: 24, delay: 1.9 },
  { x: 92, y: 49, size: 2, depth: -22, delay: 0.4 },
  { x: 76, y: 38, size: 1.5, depth: 30, delay: 1.4 },
  { x: 44, y: 22, size: 1.5, depth: -18, delay: 2.1 },
];

export function Hero() {
  const [pointer, setPointer] = useState({ x: 0, y: 0 });

  return (
    <section
      id="platform"
      className="relative isolate flex min-h-screen items-center px-4 pb-20 pt-28"
      onPointerMove={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();

        setPointer({
          x: (event.clientX - bounds.left) / bounds.width - 0.5,
          y: (event.clientY - bounds.top) / bounds.height - 0.5,
        });
      }}
      onPointerLeave={() => setPointer({ x: 0, y: 0 })}
    >
      <HeroBackdrop pointer={pointer} />
      <div className="section-shell relative z-10 grid items-center gap-12 lg:grid-cols-[1fr_0.9fr]">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: "easeOut" }}
          className="mx-auto max-w-4xl text-center lg:mx-0 lg:text-left"
        >
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-line bg-white/[0.04] px-3 py-1.5 text-xs font-medium uppercase tracking-[0.24em] text-accent">
            <span className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_18px_rgba(0,200,150,0.9)]" />
            AI runtime control plane
          </div>
          <h1 className="text-balance text-5xl font-semibold leading-[0.95] tracking-[-0.04em] text-textPrimary sm:text-6xl lg:text-7xl">
            Governance wired into AI runtime
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-textSecondary sm:text-xl lg:mx-0">
            Monitor agent actions. Evaluate risk. Enforce controls. Protect trust.
          </p>
          <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row lg:justify-start">
            <a
              href="#architecture"
              className="inline-flex items-center justify-center gap-2 rounded-full border border-line bg-white/[0.04] px-6 py-3 text-sm font-semibold text-textPrimary transition hover:border-accent/50 hover:bg-accent/10 focus:outline-none focus:ring-2 focus:ring-accent/40"
            >
              View Platform
            </a>
            <a
              href="#contact"
              className="inline-flex items-center justify-center gap-2 rounded-full bg-accent px-6 py-3 text-sm font-semibold text-ink transition hover:bg-accent/90 focus:outline-none focus:ring-2 focus:ring-accent/60"
            >
              Request Demo
              <ArrowRight size={17} aria-hidden="true" />
            </a>
          </div>
        </motion.div>

        <HeroVisual />
      </div>
    </section>
  );
}

function HeroBackdrop({ pointer }: { pointer: { x: number; y: number } }) {
  return (
    <div className="hero-backdrop pointer-events-none absolute inset-x-0 -top-24 bottom-[-18rem] z-0 overflow-hidden" aria-hidden="true">
      <div className="hero-backdrop-ambient absolute inset-0" />
      <motion.div
        className="hero-orb-primary absolute -left-[18vw] -top-[28vw] h-[62vw] w-[62vw] rounded-full border border-accent/30 blur-[0.2px]"
        style={{ x: pointer.x * -22, y: pointer.y * -16 }}
      />
      <motion.div
        className="hero-orb-horizon absolute -bottom-[37vw] -left-[10vw] h-[66vw] w-[86vw] rounded-[50%] border-t border-accent/70 shadow-[0_-18px_90px_rgba(0,200,150,0.3)]"
        style={{ x: pointer.x * 30, y: pointer.y * 18, rotate: 7 }}
      />
      <div className="absolute inset-x-0 bottom-0 h-2/3 bg-[linear-gradient(22deg,transparent_0%,rgba(0,200,150,0.06)_46%,transparent_47%),linear-gradient(19deg,transparent_0%,rgba(255,255,255,0.035)_42%,transparent_43%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(0,200,150,0.08)_1px,transparent_1px),linear-gradient(rgba(255,255,255,0.018)_1px,transparent_1px)] bg-[size:210px_100%,56px_56px] opacity-45" />
      <div className="absolute left-[9%] top-[12%] h-[65%] w-px bg-gradient-to-b from-transparent via-accent/35 to-transparent" />
      <div className="absolute left-[24%] top-[22%] h-[48%] w-px bg-gradient-to-b from-transparent via-accent/25 to-transparent" />
      <div className="absolute right-[10%] top-[45%] h-[42%] w-px bg-gradient-to-b from-transparent via-accent/25 to-transparent" />

      {particleSeeds.map((particle) => (
        <motion.span
          key={`${particle.x}-${particle.y}`}
          className="absolute rounded-full bg-accent shadow-[0_0_16px_rgba(0,200,150,0.8)]"
          style={{
            left: `${particle.x}%`,
            top: `${particle.y}%`,
            width: particle.size,
            height: particle.size,
            x: pointer.x * particle.depth,
            y: pointer.y * particle.depth,
          }}
          animate={{ opacity: [0.25, 0.85, 0.25], scale: [1, 1.7, 1] }}
          transition={{ duration: 3.5 + particle.delay, delay: particle.delay, repeat: Infinity, ease: "easeInOut" }}
        />
      ))}

      <div className="hero-vignette absolute inset-0" />
    </div>
  );
}

function HeroVisual() {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96, y: 18 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.8, delay: 0.12, ease: "easeOut" }}
      className="glass-card relative mx-auto aspect-[1.16] w-full max-w-[620px] overflow-hidden rounded-[28px] p-4"
      aria-label="Cinematic frame showing Human plus AI flowing into governed runtime"
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,rgba(0,200,150,0.18),transparent_38%)]" />
      <div className="relative flex h-full flex-col rounded-[22px] border border-line bg-ink/70 p-4">
        <div className="flex items-center justify-between border-b border-line pb-3">
          <div className="flex items-center gap-2 text-xs text-textSecondary">
            <Play size={14} aria-hidden="true" />
            runtime-preview
          </div>
          <span className="rounded-full border border-accent/30 bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent">
            governed runtime
          </span>
        </div>

        <div className="relative flex flex-1 items-center justify-center">
          <motion.div
            animate={{ opacity: [0.24, 0.58, 0.24], scale: [1, 1.08, 1] }}
            transition={{ duration: 4.8, repeat: Infinity, ease: "easeInOut" }}
            className="absolute h-52 w-52 rounded-full bg-accent/10 blur-3xl"
          />

          {controlNodes.map((node, index) => (
            <motion.div
              key={node.label}
              animate={{ y: [0, index % 2 ? -7 : 7, 0] }}
              transition={{ duration: 4 + index * 0.4, repeat: Infinity, ease: "easeInOut" }}
              className="absolute rounded-full border border-line bg-white/[0.045] px-3 py-1.5 text-xs text-textSecondary backdrop-blur"
              style={{ top: node.top, left: node.left }}
            >
              {node.label}
            </motion.div>
          ))}

          <div className="grid w-full grid-cols-[1fr_auto_1fr] items-center gap-3 text-center">
            <AbstractActor label="Human" sublabel="intent" />
            <div className="flex flex-col items-center gap-3">
              <span className="text-xs uppercase tracking-[0.22em] text-textSecondary">+</span>
              <motion.div
                animate={{ rotate: [0, 8, -8, 0] }}
                transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
                className="grid h-24 w-24 place-items-center rounded-3xl border border-accent/35 bg-accent/10 text-accent teal-glow"
              >
                <ShieldCheck size={38} strokeWidth={2.1} aria-hidden="true" />
              </motion.div>
              <span className="text-xs uppercase tracking-[0.22em] text-accent">IntelliGuard</span>
            </div>
            <AbstractActor label="AI" sublabel="agent action" />
          </div>

          <div className="absolute bottom-6 left-1/2 w-[84%] -translate-x-1/2 rounded-2xl border border-line bg-panel/80 px-4 py-3 text-left shadow-card">
            <div className="mb-2 flex items-center justify-between text-xs text-textSecondary">
              <span>Human + AI</span>
              <span className="text-accent">Governed Runtime</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
              <motion.div
                animate={{ x: ["-30%", "130%"] }}
                transition={{ duration: 2.7, repeat: Infinity, ease: "easeInOut" }}
                className="h-full w-1/3 rounded-full bg-accent"
              />
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function AbstractActor({ label, sublabel }: { label: string; sublabel: string }) {
  return (
    <div className="mx-auto grid gap-3">
      <div className="mx-auto h-24 w-20 rounded-t-[42px] border border-line bg-gradient-to-b from-white/12 to-white/[0.02]" />
      <div>
        <strong className="block text-sm text-textPrimary">{label}</strong>
        <span className="text-xs uppercase tracking-[0.18em] text-textSecondary">{sublabel}</span>
      </div>
    </div>
  );
}
