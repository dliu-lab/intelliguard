import type { PlatformData } from "@/lib/api";

export type BackendComponentKey =
  | "agents"
  | "tools"
  | "workflows"
  | "guardrails"
  | "evaluators"
  | "knowledge"
  | "reviews"
  | "audit"
  | "environments";

export type WorkspaceView = "overview" | "workflows" | "trace" | "control" | "policies" | "reviews" | "audit";
export type DataStatus = "loading" | "ready" | "error";
export type ControlTemplateKey = "agent" | "tool" | "guardrail" | "evaluator" | "knowledge";
export type AgentModalTab = "profile" | "tools" | "guardrails" | "evaluators" | "knowledge";

export type WorkspaceViewDefinition = {
  id: WorkspaceView;
  label: string;
  title: string;
  description: string;
};

export type ModuleDefinition = {
  title: string;
  description: string;
  componentKey: BackendComponentKey;
  metric: (data: PlatformData) => string;
  detail: (data: PlatformData) => string;
};
