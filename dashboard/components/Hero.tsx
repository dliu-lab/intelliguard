"use client";

import { motion } from "framer-motion";
import {
  ArrowRight,
  Bot,
  Database,
  GitBranch,
  Network,
  ShieldCheck,
  TerminalSquare,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";
import { openAuthModal } from "@/components/AuthModal";

const orbitNodes = [
  { label: "Knowledge Bases", icon: Database, className: "left-1/2 top-[7%] -translate-x-1/2" },
  { label: "Agents", icon: Bot, className: "left-[7%] top-[30%]" },
  { label: "Tools", icon: TerminalSquare, className: "right-[7%] top-[34%]" },
];

const platformLayers = [
  {
    title: "Control Plane",
    description: "Policy, RBAC, risk scoring, approvals, and audit evidence.",
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
    icon: Network,
  },
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
            <button
              type="button"
              onClick={() => openAuthModal("signup")}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-accent px-6 py-3 text-sm font-semibold text-ink transition hover:bg-accent/90 focus:outline-none focus:ring-2 focus:ring-accent/60"
            >
              Try IntelliGuard
              <ArrowRight size={17} aria-hidden="true" />
            </button>
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
      className="glass-card relative mx-auto min-h-[620px] w-full max-w-[620px] overflow-hidden rounded-[32px] p-5"
      aria-label="IntelliGuard platform preview"
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_44%,rgba(0,200,150,0.2),transparent_36%)]" />
      <div className="absolute left-1/2 top-1/2 h-[72%] w-[72%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-accent/20" />
      <div className="absolute left-1/2 top-1/2 h-[50%] w-[50%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-line" />

      {orbitNodes.map((node) => {
        const Icon = node.icon;

        return (
          <div
            key={node.label}
            className={`absolute z-10 flex items-center gap-2 rounded-full border border-line bg-ink/80 px-4 py-2 text-sm font-semibold text-textPrimary shadow-card backdrop-blur ${node.className}`}
          >
            <Icon className="text-accent" size={17} aria-hidden="true" />
            {node.label}
          </div>
        );
      })}

      <div className="relative z-20 flex min-h-[580px] flex-col justify-end gap-4">
        <div className="mx-auto w-full max-w-md rounded-[28px] border border-accent/25 bg-ink/86 p-6 text-center shadow-[0_0_80px_rgba(0,200,150,0.18)] backdrop-blur-xl">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl border border-accent/35 bg-accent/10 text-accent teal-glow">
            <ShieldCheck size={30} aria-hidden="true" />
          </div>
          <h2 className="mt-5 text-3xl font-semibold tracking-[-0.03em] text-textPrimary">IntelliGuard Platform</h2>
          <p className="mt-3 text-base leading-7 text-textSecondary">
            Control plane, workflow builder, deployment surface, and runtime evidence layer.
          </p>
          <div className="mt-6 rounded-2xl border border-line bg-panel/70 px-4 py-3 text-left">
            <div className="mb-2 flex items-center justify-between gap-4 text-xs text-textSecondary">
              <span>Human + AI</span>
              <span className="text-accent">Governed Runtime</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
              <motion.div
                animate={{ x: ["-35%", "235%"] }}
                transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut" }}
                className="h-full w-2/5 rounded-full bg-accent shadow-[0_0_24px_rgba(0,200,150,0.7)]"
              />
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          {platformLayers.map((layer) => (
            <PlatformLayerCard key={layer.title} {...layer} />
          ))}
        </div>
      </div>
    </motion.div>
  );
}

interface PlatformLayerCardProps {
  title: string;
  description: string;
  icon: LucideIcon;
}

function PlatformLayerCard({ title, description, icon: Icon }: PlatformLayerCardProps) {
  return (
    <div className="rounded-2xl border border-line bg-ink/76 p-4 shadow-card backdrop-blur">
      <Icon className="text-accent" size={19} aria-hidden="true" />
      <h3 className="mt-4 text-base font-semibold text-textPrimary">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-textSecondary">{description}</p>
    </div>
  );
}
