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

export function Hero() {
  return (
    <section
      id="platform"
      className="relative isolate flex min-h-screen items-center px-4 pb-20 pt-28"
    >
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
