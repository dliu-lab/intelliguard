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
  | "monitoring"
  | "environments";

export type WorkspaceView =
  | "overview"
  | "tool-registry"
  | "agent-registry"
  | "workflow-designer"
  | "knowledge-bases"
  | "guardrail-policies"
  | "evaluation-center"
  | "agentic-workflows"
  | "reviews"
  | "audit"
  | "monitoring";
export type DataStatus = "loading" | "ready" | "error";
export type ControlTemplateKey = "agent" | "tool" | "guardrail" | "evaluator" | "knowledge";
export type AgentModalTab =
  | "profile"
  | "tools"
  | "guardrails"
  | "evaluators"
  | "knowledge"
  | "certification";

export type WorkspaceViewDefinition = {
  group: "platform" | "control" | "runtime";
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
