"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Building2, LockKeyhole, Mail, ShieldCheck, UserCog, X } from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { bootstrapStatus, fetchLoginRoleOptions, login, register, saveSession } from "@/lib/api";

type AuthMode = "login" | "signup";

const copy = {
  login: {
    eyebrow: "Workspace access",
    title: "Login to IntelliGuard",
    description: "Return to your governance control plane for agents, policies, approvals, and audit evidence.",
    button: "Continue to workspace",
  },
  signup: {
    eyebrow: "Sandbox access",
    title: "Start with IntelliGuard",
    description: "Create a controlled sandbox to evaluate runtime governance before production rollout.",
    button: "Create sandbox",
  },
};

const signupRoleOptions = ["Governance Lead", "Governance Reviewer", "Support Operations Manager", "Agent Developer"];
const defaultLoginRoleOptions = [""];

export function openAuthModal(mode: AuthMode = "signup") {
  window.dispatchEvent(new CustomEvent<AuthMode>("intelliguard:auth", { detail: mode }));
}

export function AuthModal() {
  const [mode, setMode] = useState<AuthMode>("signup");
  const [isOpen, setIsOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [company, setCompany] = useState("");
  const [requiresInitialAdmin, setRequiresInitialAdmin] = useState(false);
  const [signupRoles, setSignupRoles] = useState(signupRoleOptions);
  const [loginRoles, setLoginRoles] = useState(defaultLoginRoleOptions);
  const [selectedRole, setSelectedRole] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeCopy = copy[mode];

  useEffect(() => {
    function handleOpen(event: Event) {
      const authEvent = event as CustomEvent<AuthMode>;

      setMode(authEvent.detail ?? "signup");
      setError(null);
      setIsOpen(true);
    }

    window.addEventListener("intelliguard:auth", handleOpen);
    return () => window.removeEventListener("intelliguard:auth", handleOpen);
  }, []);

  useEffect(() => {
    const authMode = new URLSearchParams(window.location.search).get("auth");

    if (authMode === "login" || authMode === "signup") {
      setMode(authMode);
      setIsOpen(true);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    bootstrapStatus()
      .then((status) => {
        const nextRoles = status.signup_roles.length ? status.signup_roles : signupRoleOptions;

        setRequiresInitialAdmin(status.requires_initial_admin);
        setSignupRoles(nextRoles);
        if (mode === "signup") {
          setSelectedRole(status.requires_initial_admin ? "Governance Lead" : nextRoles[0]);
        }
      })
      .catch(() => {
        setRequiresInitialAdmin(false);
        setSignupRoles(signupRoleOptions.filter((role) => role !== "Governance Lead"));
      });
  }, [isOpen]);

  useEffect(() => {
    if (mode === "login") {
      setSelectedRole("");
      setLoginRoles(defaultLoginRoleOptions);
      return;
    }

    setSelectedRole((currentRole) => (signupRoles.includes(currentRole) ? currentRole : signupRoles[0]));
  }, [mode, signupRoles]);

  useEffect(() => {
    if (!isOpen || mode !== "login") {
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    setSelectedRole("");
    setLoginRoles(defaultLoginRoleOptions);

    if (!normalizedEmail || password.length < 8) {
      return;
    }

    let cancelled = false;
    const timeout = window.setTimeout(() => {
      fetchLoginRoleOptions({ email: normalizedEmail, password })
        .then((response) => {
          if (cancelled) {
            return;
          }

          setLoginRoles(response.roles.length ? response.roles : defaultLoginRoleOptions);
          setSelectedRole(
            response.default_role && response.roles.includes(response.default_role)
              ? response.default_role
              : response.roles[0] || "",
          );
        })
        .catch(() => {
          if (cancelled) {
            return;
          }

          setLoginRoles(defaultLoginRoleOptions);
          setSelectedRole("");
        });
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [email, isOpen, mode, password]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const normalizedEmail = email.trim().toLowerCase();
      const session =
        mode === "login"
          ? await login({
              email: normalizedEmail,
              password,
              ...(selectedRole ? { role: selectedRole } : {}),
            })
          : await register({
              email: normalizedEmail,
              password,
              display_name: company.trim() || normalizedEmail.split("@")[0] || "IntelliGuard user",
              roles: [
                requiresInitialAdmin
                  ? "Governance Lead"
                  : selectedRole || signupRoles[0] || "Agent Developer",
              ],
            });

      saveSession(session);
      window.location.assign("/platform/");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Authentication failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AnimatePresence>
      {isOpen ? (
        <motion.div
          className="fixed inset-0 z-[80] grid place-items-center bg-ink/78 px-4 py-8 backdrop-blur-xl"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="presentation"
          onMouseDown={() => setIsOpen(false)}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="auth-modal-title"
            className="glass-card relative grid w-full max-w-3xl overflow-hidden rounded-[28px] lg:grid-cols-[0.86fr_1fr]"
            initial={{ opacity: 0, y: 20, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              aria-label="Close login and sign up modal"
              onClick={() => setIsOpen(false)}
              className="absolute right-4 top-4 z-10 grid h-9 w-9 place-items-center rounded-full border border-line bg-white/[0.04] text-textSecondary transition hover:border-accent/45 hover:text-textPrimary"
            >
              <X size={17} aria-hidden="true" />
            </button>

            <aside className="relative overflow-hidden border-b border-line p-6 lg:border-b-0 lg:border-r">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_18%,rgba(0,200,150,0.2),transparent_38%)]" />
              <div className="relative">
                <div className="grid h-12 w-12 place-items-center rounded-2xl border border-accent/35 bg-accent/10 text-accent teal-glow">
                  <ShieldCheck size={24} aria-hidden="true" />
                </div>
                <p className="mt-8 text-xs font-semibold uppercase tracking-[0.28em] text-accent">{activeCopy.eyebrow}</p>
                <h2 id="auth-modal-title" className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-textPrimary">
                  {activeCopy.title}
                </h2>
                <p className="mt-4 text-sm leading-7 text-textSecondary">{activeCopy.description}</p>
                <div className="mt-8 rounded-2xl border border-line bg-ink/55 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-textSecondary">Access includes</p>
                  <ul className="mt-4 grid gap-3 text-sm text-textSecondary">
                    <li>RBAC-aware workspace authorization</li>
                    <li>Agent, tool, policy, and audit visibility</li>
                    <li>Unified gateway and governed model routing</li>
                  </ul>
                </div>
              </div>
            </aside>

            <div className="p-6">
              <div className="mb-6 inline-grid grid-cols-2 rounded-full border border-line bg-ink/70 p-1">
                <button
                  type="button"
                  onClick={() => setMode("login")}
                  className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                    mode === "login" ? "bg-accent text-ink" : "text-textSecondary hover:text-textPrimary"
                  }`}
                >
                  Login
                </button>
                <button
                  type="button"
                  onClick={() => setMode("signup")}
                  className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                    mode === "signup" ? "bg-accent text-ink" : "text-textSecondary hover:text-textPrimary"
                  }`}
                >
                  Sign Up
                </button>
              </div>

              <form className="grid gap-4" aria-label={`${activeCopy.title} form`} onSubmit={handleSubmit}>
                <Field
                  icon={Mail}
                  label="Work email"
                  type="email"
                  placeholder="name@company.com"
                  value={email}
                  onChange={setEmail}
                  autoComplete="email"
                />
                <RoleField
                  value={selectedRole}
                  onChange={setSelectedRole}
                  roles={mode === "login" ? loginRoles : signupRoles}
                  disabled={mode === "signup" && requiresInitialAdmin}
                />
                {mode === "login" ? (
                  <Field
                    icon={LockKeyhole}
                    label="Password"
                    type="password"
                    placeholder="Password"
                    value={password}
                    onChange={setPassword}
                    autoComplete="current-password"
                  />
                ) : (
                  <>
                    <Field
                      icon={LockKeyhole}
                      label="Password"
                      type="password"
                      placeholder="Minimum 8 characters"
                      value={password}
                      onChange={setPassword}
                      autoComplete="new-password"
                    />
                    <Field
                      icon={Building2}
                      label="Company"
                      type="text"
                      placeholder="Company name"
                      value={company}
                      onChange={setCompany}
                      autoComplete="organization"
                    />
                  </>
                )}
                {mode === "signup" ? (
                  <p className="text-xs leading-5 text-textSecondary">
                    {requiresInitialAdmin
                      ? "This first account will become the Governance Lead admin."
                      : `New sandboxes start with the selected ${selectedRole} role.`}
                  </p>
                ) : null}
                {error ? (
                  <div className="rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm leading-6 text-red-100">
                    {error}
                  </div>
                ) : null}
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="mt-2 inline-flex items-center justify-center gap-2 rounded-full bg-accent px-5 py-3 text-sm font-semibold text-ink transition hover:bg-accent/90 focus:outline-none focus:ring-2 focus:ring-accent/60 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmitting ? "Connecting..." : activeCopy.button}
                  <ArrowRight size={16} aria-hidden="true" />
                </button>
              </form>

              <p className="mt-5 text-center text-xs leading-6 text-textSecondary">
                Successful authentication opens the IntelliGuard platform workspace.
              </p>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function RoleField({
  value,
  onChange,
  roles,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  roles: string[];
  disabled?: boolean;
}) {
  return (
    <label className="grid gap-2 text-sm font-medium text-textPrimary">
      Role
      <span className="flex items-center gap-3 rounded-2xl border border-line bg-ink/70 px-4 py-3 text-textSecondary transition focus-within:border-accent/50">
        <UserCog size={16} className="shrink-0 text-accent" aria-hidden="true" />
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          className="w-full appearance-none bg-transparent text-sm text-textPrimary outline-none disabled:cursor-not-allowed disabled:text-textSecondary"
        >
          {roles.map((role) => (
            <option key={role || "account-default"} value={role} className="bg-panel text-textPrimary">
              {role || "Account default"}
            </option>
          ))}
        </select>
      </span>
    </label>
  );
}

function Field({
  icon: Icon,
  label,
  type,
  placeholder,
  value,
  onChange,
  autoComplete,
}: {
  icon: typeof Mail;
  label: string;
  type: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
}) {
  return (
    <label className="grid gap-2 text-sm font-medium text-textPrimary">
      {label}
      <span className="flex items-center gap-3 rounded-2xl border border-line bg-ink/70 px-4 py-3 text-textSecondary transition focus-within:border-accent/50">
        <Icon size={16} className="shrink-0 text-accent" aria-hidden="true" />
        <input
          type={type}
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          required
          minLength={type === "password" ? 8 : undefined}
          className="w-full bg-transparent text-sm text-textPrimary outline-none placeholder:text-textSecondary/55"
        />
      </span>
    </label>
  );
}
