"use client";

import { ShieldCheck } from "lucide-react";
import { motion } from "framer-motion";
import { openAuthModal } from "@/components/AuthModal";
import { ThemeToggle } from "@/components/ThemeToggle";

const navLinks = ["Platform", "Governance", "Use Cases", "Developers", "Contact"];

export function Navbar() {
  return (
    <motion.header
      initial={{ y: -24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className="fixed inset-x-0 top-0 z-50 border-b border-line bg-ink/72 backdrop-blur-xl"
    >
      <nav className="section-shell flex h-16 items-center justify-between gap-6" aria-label="Primary navigation">
        <a href="#" className="flex items-center gap-3" aria-label="IntelliGuard home">
          <span className="grid h-9 w-9 place-items-center rounded-xl border border-accent/30 bg-accent/10 text-accent teal-glow">
            <ShieldCheck size={19} strokeWidth={2.4} aria-hidden="true" />
          </span>
          <span className="text-base font-semibold tracking-tight text-textPrimary">IntelliGuard</span>
        </a>

        <div className="hidden items-center gap-7 md:flex">
          {navLinks.map((link) => (
            <a
              key={link}
              href={`#${link.toLowerCase().replaceAll(" ", "-")}`}
              className="text-sm text-textSecondary transition hover:text-textPrimary"
            >
              {link}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <ThemeToggle />
          <button
            type="button"
            onClick={() => openAuthModal("login")}
            className="hidden text-sm font-medium text-textSecondary transition hover:text-textPrimary sm:inline"
          >
            Login
          </button>
          <button
            type="button"
            onClick={() => openAuthModal("signup")}
            className="hidden rounded-full border border-line bg-white/[0.04] px-4 py-2 text-sm font-semibold text-textPrimary transition hover:border-accent/50 hover:bg-accent/10 sm:inline-flex"
          >
            Sign Up
          </button>
          <a
            href="#contact"
            className="shrink-0 rounded-full border border-accent/40 bg-accent px-4 py-2 text-sm font-semibold text-ink transition hover:bg-accent/90 focus:outline-none focus:ring-2 focus:ring-accent/60"
          >
            Request Demo
          </a>
        </div>
      </nav>
    </motion.header>
  );
}
