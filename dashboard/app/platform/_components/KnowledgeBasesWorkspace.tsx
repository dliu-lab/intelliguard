"use client";

import type { ChangeEvent, FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  CircleHelp,
  Copy,
  Database,
  FileText,
  Filter,
  ListChecks,
  MoreHorizontal,
  PencilLine,
  RefreshCw,
  Search,
  Server,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import {
  createKnowledgeBaseWithFiles,
  createKnowledgeBaseVersion,
  deleteKnowledgeBase,
  evaluateKnowledgeBase,
  getKnowledgeBaseDetail,
  getSession,
  listKnowledgeBaseVersions,
  listKnowledgeDocuments,
  publishKnowledgeBaseVersion,
  queryKnowledgeBase,
  syncKnowledgeBase,
  uploadKnowledgeFile,
  type ApiRecord,
  type KnowledgeBaseCreateWithFilesPayload,
  type KnowledgeBaseVersionPayload,
  type PlatformData,
} from "@/lib/api";
import { ComponentRow, PlatformSurface } from "./shared";
import type { DataStatus } from "./types";
import { formatCount, joinParts, readText } from "./utils";

type RetrievalMode = "file" | "vector";
type KBScope = "domain" | "agent" | "shared";
type ChunkingStrategy =
  | "sentence"
  | "token"
  | "markdown"
  | "json"
  | "html"
  | "code"
  | "semantic"
  | "hierarchical";
type KBFormMode = "create" | "edit" | "duplicate";
type EvaluationPill = "ready" | "needs_review" | "failed" | "not_evaluated";
type FeedbackSetter = (message: string) => void;

type KBFormState = {
  kb_id: string;
  display_name: string;
  description: string;
  owner: string;
  domain: string;
  sensitivity: string;
  environment: string;
  kb_scope: KBScope;
  linked_agent_id: string;
  retrieval_mode: RetrievalMode;
  embedding_model: string;
  chunking_strategy: ChunkingStrategy;
  chunk_size: number;
  chunk_overlap: number;
  version: string;
  notes: string;
};

const MAX_FILES_PER_KB = 10;
const VECTOR_KB_FILE_ACCEPT =
  ".txt,.md,.pdf,.docx,.json,.html,.htm,.yaml,.yml,.py,.js,.jsx,.ts,.tsx,.java,.go,.rs,.rb,.php,.cs,.c,.cpp,.h,.hpp,.sql,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/json,text/html,application/xhtml+xml,text/yaml,application/x-yaml,text/x-python,text/javascript,application/javascript,text/typescript,text/x-java-source,text/x-c,text/x-c++,text/x-go,text/x-rust,text/x-ruby,text/x-php,application/sql";
const FILE_KB_FILE_ACCEPT = `${VECTOR_KB_FILE_ACCEPT},.png,.jpg,.jpeg,.webp,.gif,image/png,image/jpeg,image/webp,image/gif`;

const scopeOptions: Array<{ label: string; value: KBScope }> = [
  { label: "Domain", value: "domain" },
  { label: "Agent dedicated", value: "agent" },
  { label: "Shared", value: "shared" },
];

const chunkingOptions: Array<{ label: string; value: ChunkingStrategy }> = [
  { label: "Sentence boundaries", value: "sentence" },
  { label: "Token count", value: "token" },
  { label: "Markdown", value: "markdown" },
  { label: "JSON", value: "json" },
  { label: "HTML", value: "html" },
  { label: "Code", value: "code" },
  { label: "Semantic similarity", value: "semantic" },
  { label: "Hierarchical", value: "hierarchical" },
];

const nodeParserLabels: Record<ChunkingStrategy, string> = {
  sentence: "SentenceSplitter",
  token: "TokenTextSplitter",
  markdown: "MarkdownNodeParser",
  json: "JSONNodeParser",
  html: "HTMLNodeParser",
  code: "CodeSplitter",
  semantic: "SemanticSplitterNodeParser",
  hierarchical: "HierarchicalNodeParser",
};

const chunkingStrategyDetails: Record<ChunkingStrategy, string> = {
  sentence: "Splits text while respecting sentence boundaries.",
  token: "Splits text by token count.",
  markdown: "Parses Markdown documents.",
  json: "Parses JSON documents.",
  html: "Parses HTML documents.",
  code: "Splits source code.",
  semantic: "Splits based on semantic similarity.",
  hierarchical: "Creates parent-child chunk structures based on input files.",
};

const legacyChunkingStrategies: Record<string, ChunkingStrategy> = {
  semantic_sections: "semantic",
  fixed_size: "token",
  qa_pairs: "sentence",
  procedure_steps: "markdown",
};

const feedbackToneClasses = {
  neutral: "border-line bg-ink/55 text-textSecondary",
  warning: "border-amber-300/40 bg-amber-300/10 text-amber-100",
  danger: "border-rose-300/45 bg-rose-300/12 text-rose-100",
};

interface FeedbackAlertProps {
  message: string;
  className?: string;
  tone?: keyof typeof feedbackToneClasses;
}

const FeedbackAlert = ({ message, className = "", tone = "warning" }: FeedbackAlertProps) => {
  if (!message) {
    return null;
  }

  return (
    <div
      role="alert"
      aria-live="polite"
      className={`rounded-2xl border px-4 py-3 text-sm ${feedbackToneClasses[tone]} ${className}`}
    >
      {message}
    </div>
  );
};

function emptyKbForm(environment = "demo"): KBFormState {
  return {
    kb_id: "",
    display_name: "",
    description: "",
    owner: "",
    domain: "",
    sensitivity: "internal",
    environment,
    kb_scope: "domain",
    linked_agent_id: "",
    retrieval_mode: "file",
    embedding_model: "nomic-embed-text",
    chunking_strategy: "semantic",
    chunk_size: 512,
    chunk_overlap: 80,
    version: "v0.1.0",
    notes: "",
  };
}

function isRecord(value: unknown): value is ApiRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRecord(record: ApiRecord | undefined | null, key: string): ApiRecord | undefined {
  const value = record?.[key];
  return isRecord(value) ? value : undefined;
}

function numberValue(record: ApiRecord | undefined | null, keys: string[], fallback = 0) {
  const value = Number(readText(record || {}, keys));
  return Number.isFinite(value) ? value : fallback;
}

function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function sourceConfigFor(record: ApiRecord | undefined | null) {
  return readRecord(record, "source_config") || {};
}

function retrievalModeFor(record: ApiRecord | undefined | null): RetrievalMode {
  return readText(sourceConfigFor(record), ["retrieval_mode"]) === "vector" ? "vector" : "file";
}

function scopeFor(record: ApiRecord | undefined | null): KBScope {
  const value = readText(sourceConfigFor(record), ["kb_scope"]);
  if (value === "agent" || value === "shared" || value === "domain") {
    return value;
  }
  return readText(record || {}, ["domain"]) ? "domain" : "shared";
}

function scopeLabel(value: KBScope) {
  return scopeOptions.find((option) => option.value === value)?.label || "Shared";
}

function scopeRefFor(record: ApiRecord | undefined | null) {
  const config = sourceConfigFor(record);
  const scope = scopeFor(record);
  if (scope === "agent") {
    return readText(config, ["linked_agent_id", "scope_ref"]) || "agent not linked";
  }
  if (scope === "domain") {
    return readText(config, ["scope_ref"]) || readText(record || {}, ["domain"]) || "general";
  }
  return "shared";
}

function embeddingModelFor(record: ApiRecord | undefined | null) {
  return (
    readText(record || {}, ["embedding_model"]) ||
    readText(sourceConfigFor(record), ["embedding_model"]) ||
    "nomic-embed-text"
  );
}

function chunkingStrategyFor(record: ApiRecord | undefined | null): ChunkingStrategy {
  const value = readText(sourceConfigFor(record), ["chunking_strategy"]) || "";
  if (legacyChunkingStrategies[value]) {
    return legacyChunkingStrategies[value];
  }
  return chunkingOptions.some((option) => option.value === value) ? (value as ChunkingStrategy) : "semantic";
}

function chunkingStrategyLabel(value: ChunkingStrategy) {
  return chunkingOptions.find((option) => option.value === value)?.label || "Semantic sections";
}

function usesFixedSizeControls(value: ChunkingStrategy) {
  return value === "token";
}

function versionParts(value: string) {
  const match = /^v(\d+)\.(\d+)\.(\d+)$/.exec(value);
  return match ? match.slice(1).map(Number) : null;
}

function nextMinorVersion(versions: ApiRecord[], fallback?: ApiRecord | null) {
  const candidates = versions
    .map((version) => readText(version, ["version"]))
    .concat(readText(readRecord(fallback || {}, "latest_version") || {}, ["version"]))
    .filter((value): value is string => Boolean(value));
  const latest = candidates
    .map((value) => ({ value, parts: versionParts(value) }))
    .filter((item): item is { value: string; parts: number[] } => Boolean(item.parts))
    .sort((left, right) => {
      for (let index = 0; index < 3; index += 1) {
        if (left.parts[index] !== right.parts[index]) {
          return right.parts[index] - left.parts[index];
        }
      }
      return 0;
    })[0];

  if (!latest) {
    return "v0.1.0";
  }

  return `v${latest.parts[0]}.${latest.parts[1] + 1}.0`;
}

function displayVersion(version: ApiRecord | undefined) {
  if (!version) {
    return "no version";
  }
  const status = readText(version, ["status"]) || "draft";
  const value = readText(version, ["version"]) || "v0.0.0";
  return `${status} ${value}`;
}

function fileManifestCount(version: ApiRecord) {
  return Array.isArray(version.file_manifest) ? version.file_manifest.length : 0;
}

function statusClasses(status: string) {
  if (status === "published" || status === "ready" || status === "indexed") {
    return "border-emerald-300/40 bg-emerald-300/12 text-emerald-100";
  }
  if (status === "failed") {
    return "border-rose-300/45 bg-rose-300/12 text-rose-100";
  }
  if (status === "archived") {
    return "border-line bg-white/[0.045] text-textSecondary";
  }
  return "border-amber-300/45 bg-amber-300/12 text-amber-100";
}

function localFileCountFor(kb: ApiRecord, selectedKbId: string, selectedDocuments: ApiRecord[]) {
  const kbId = readText(kb, ["kb_id"]) || "";
  if (kbId && kbId === selectedKbId && selectedDocuments.length) {
    return selectedDocuments.length;
  }

  const latestVersion = readRecord(kb, "latest_version");
  const manifestCount = latestVersion ? fileManifestCount(latestVersion) : 0;
  if (manifestCount > 0) {
    return manifestCount;
  }

  return numberValue(sourceConfigFor(kb), ["local_file_count", "file_count"], 0);
}

function evaluationPayloadFor(kb: ApiRecord, freshEvaluation?: ApiRecord) {
  if (freshEvaluation) {
    return (
      readRecord(freshEvaluation, "evaluation") ||
      readRecord(freshEvaluation, "knowledge_base") ||
      freshEvaluation
    );
  }

  return readRecord(sourceConfigFor(kb), "evaluation") || readRecord(kb, "evaluation");
}

function evaluationStatusFor(kb: ApiRecord, freshEvaluation?: ApiRecord): EvaluationPill {
  const payload = evaluationPayloadFor(kb, freshEvaluation);
  if (!payload) {
    return "not_evaluated";
  }

  const rawStatus = ((
    readText(payload, ["status", "overall_result", "result"]) ||
    readText(readRecord(payload, "run") || {}, ["status", "overall_result"])
  ) || "")
    .toLowerCase()
    .replaceAll("-", "_");

  if (["ready", "pass", "passed", "certified", "succeeded"].includes(rawStatus)) {
    return "ready";
  }
  if (["failed", "fail", "error"].includes(rawStatus)) {
    return "failed";
  }
  if (["needs_review", "review", "warning", "partial"].includes(rawStatus)) {
    return "needs_review";
  }

  const criteriaTotal = numberValue(payload, ["criteria_total"], 0);
  const criteriaPassed = numberValue(payload, ["criteria_passed"], 0);
  if (criteriaTotal > 0) {
    return criteriaPassed === criteriaTotal ? "ready" : "needs_review";
  }

  return "not_evaluated";
}

function evaluationLabel(status: EvaluationPill) {
  if (status === "ready") {
    return "Ready";
  }
  if (status === "needs_review") {
    return "Needs review";
  }
  if (status === "failed") {
    return "Failed";
  }
  return "Not evaluated";
}

function evaluationClasses(status: EvaluationPill) {
  if (status === "ready") {
    return "border-emerald-300/40 bg-emerald-300/12 text-emerald-100";
  }
  if (status === "failed") {
    return "border-rose-300/45 bg-rose-300/12 text-rose-100";
  }
  if (status === "needs_review") {
    return "border-amber-300/45 bg-amber-300/12 text-amber-100";
  }
  return "border-line bg-ink/55 text-textSecondary";
}

function agentName(data: PlatformData, agentId: string) {
  const agent = data.agents.find((item) => readText(item, ["agent_id"]) === agentId);
  return readText(agent || {}, ["display_name", "agent_id"]) || agentId || "agent not linked";
}

function kbSearchText(kb: ApiRecord) {
  return [
    readText(kb, ["display_name", "kb_id"]),
    readText(kb, ["kb_id"]),
    readText(kb, ["description"]),
    readText(kb, ["owner"]),
    readText(kb, ["domain"]),
    readText(kb, ["environment"]),
    scopeFor(kb),
    retrievalModeFor(kb),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function formFromKb(
  kb: ApiRecord,
  versions: ApiRecord[],
  environment: string,
  mode: KBFormMode,
): KBFormState {
  const config = sourceConfigFor(kb);
  const scope = scopeFor(kb);
  const originalId = readText(kb, ["kb_id"]) || "";
  return {
    kb_id: mode === "duplicate" ? `${originalId}-copy` : originalId,
    display_name:
      mode === "duplicate"
        ? `${readText(kb, ["display_name", "kb_id"]) || "Knowledge Base"} Copy`
        : readText(kb, ["display_name", "kb_id"]) || "",
    description: readText(kb, ["description"]) || "",
    owner: readText(kb, ["owner"]) || "",
    domain: readText(kb, ["domain"]) || "",
    sensitivity: readText(kb, ["sensitivity"]) || "internal",
    environment: readText(kb, ["environment"]) || environment,
    kb_scope: scope,
    linked_agent_id:
      scope === "agent" ? readText(config, ["linked_agent_id", "scope_ref"]) || "" : "",
    retrieval_mode: retrievalModeFor(kb),
    embedding_model: embeddingModelFor(kb),
    chunking_strategy: chunkingStrategyFor(kb),
    chunk_size: numberValue(config, ["chunk_size"], 512),
    chunk_overlap: numberValue(config, ["chunk_overlap"], 80),
    version: mode === "edit" ? nextMinorVersion(versions, kb) : "v0.1.0",
    notes: "",
  };
}

export function KnowledgeBasesWorkspace({
  data,
  dataStatus,
  onRefresh,
}: {
  data: PlatformData;
  dataStatus: DataStatus;
  onRefresh: () => Promise<void> | void;
}) {
  const defaultEnvironment = data.environments[0] || "demo";
  const [selectedKbId, setSelectedKbId] = useState("");
  const [showSelectedWorkspace, setShowSelectedWorkspace] = useState(false);
  const [pageMessage, setPageMessage] = useState("");
  const [builderMessage, setBuilderMessage] = useState("");
  const [workspaceMessage, setWorkspaceMessage] = useState("");
  const [deleteMessage, setDeleteMessage] = useState("");
  const [showBuilder, setShowBuilder] = useState(false);
  const [formMode, setFormMode] = useState<KBFormMode>("create");
  const [kbForm, setKbForm] = useState<KBFormState>(() => emptyKbForm(defaultEnvironment));
  const [builderFiles, setBuilderFiles] = useState<File[]>([]);
  const [indexAfterCreate, setIndexAfterCreate] = useState(true);
  const [registryDomain, setRegistryDomain] = useState("all");
  const [registrySearch, setRegistrySearch] = useState("");
  const [actionMenuKbId, setActionMenuKbId] = useState<string | null>(null);
  const [evaluationResults, setEvaluationResults] = useState<Record<string, ApiRecord>>({});
  const [evaluatingKbId, setEvaluatingKbId] = useState<string | null>(null);
  const [deleteDialogKb, setDeleteDialogKb] = useState<ApiRecord | null>(null);
  const [deletingKbId, setDeletingKbId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [queryTopK, setQueryTopK] = useState(5);
  const [queryResults, setQueryResults] = useState<ApiRecord[]>([]);
  const [selectedKbDetail, setSelectedKbDetail] = useState<ApiRecord | null>(null);
  const [selectedDocuments, setSelectedDocuments] = useState<ApiRecord[]>([]);
  const [selectedVersions, setSelectedVersions] = useState<ApiRecord[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailRefreshNonce, setDetailRefreshNonce] = useState(0);
  const selectedKbIdRef = useRef(selectedKbId);
  const queryRequestIdRef = useRef(0);
  const detailRequestIdRef = useRef(0);

  const selectedKb = data.knowledgeBases.find((kb) => readText(kb, ["kb_id"]) === selectedKbId);
  const selectedKbIdValue = selectedKb ? readText(selectedKb, ["kb_id"]) || "" : "";
  const selectedKbRecord = selectedKbDetail || selectedKb;
  const selectedMode = retrievalModeFor(selectedKbRecord);
  const selectedScope = scopeFor(selectedKbRecord);
  const latestVersion =
    readRecord(selectedKbRecord, "latest_version") || selectedVersions[0] || undefined;
  const publishedVersion =
    readRecord(selectedKbRecord, "published_version") ||
    selectedVersions.find((version) => readText(version, ["status"]) === "published");
  const latestIndex = readRecord(selectedKbRecord, "latest_index");
  const builderFileSlots =
    formMode === "edit" ? Math.max(0, MAX_FILES_PER_KB - selectedDocuments.length) : MAX_FILES_PER_KB;
  const builderFileLimitReached = builderFiles.length >= builderFileSlots;
  const domainFilters = useMemo(() => {
    const counts = data.knowledgeBases.reduce<Record<string, number>>((items, kb) => {
      const domain = readText(kb, ["domain"]) || "general";
      items[domain] = (items[domain] || 0) + 1;
      return items;
    }, {});

    return Object.entries(counts)
      .map(([domain, count]) => ({ domain, count }))
      .sort((left, right) => left.domain.localeCompare(right.domain));
  }, [data.knowledgeBases]);
  const builderFileAccept =
    kbForm.retrieval_mode === "file" ? FILE_KB_FILE_ACCEPT : VECTOR_KB_FILE_ACCEPT;

  useEffect(() => {
    if (!selectedKbId) {
      return;
    }

    const selectedKbExists = data.knowledgeBases.some((kb) => readText(kb, ["kb_id"]) === selectedKbId);
    if (!selectedKbExists) {
      setSelectedKbId("");
      closeSelectedWorkspace();
    }
  }, [data.knowledgeBases, selectedKbId]);

  useEffect(() => {
    selectedKbIdRef.current = selectedKbId;
    setQuery("");
    setQueryResults([]);
    setActionMenuKbId(null);
  }, [selectedKbId]);

  useEffect(() => {
    setSelectedKbDetail(null);
    setSelectedDocuments([]);
    setSelectedVersions([]);

    if (!selectedKbId) {
      setDetailLoading(false);
      return;
    }

    const session = getSession();
    if (!session?.token) {
      setDetailLoading(false);
      return;
    }

    const requestId = detailRequestIdRef.current + 1;
    detailRequestIdRef.current = requestId;
    setDetailLoading(true);

    Promise.all([
      getKnowledgeBaseDetail(session.token, selectedKbId),
      listKnowledgeDocuments(session.token, selectedKbId),
      listKnowledgeBaseVersions(session.token, selectedKbId),
    ])
      .then(([detail, documents, versions]) => {
        if (requestId !== detailRequestIdRef.current || selectedKbIdRef.current !== selectedKbId) {
          return;
        }

        setSelectedKbDetail(detail);
        setSelectedDocuments(documents);
        setSelectedVersions(versions);
      })
      .catch((error) => {
        if (requestId !== detailRequestIdRef.current || selectedKbIdRef.current !== selectedKbId) {
          return;
        }

        setWorkspaceMessage(error instanceof Error ? error.message : "Unable to load knowledge base detail.");
      })
      .finally(() => {
        if (requestId === detailRequestIdRef.current) {
          setDetailLoading(false);
        }
      });
  }, [selectedKbId, detailRefreshNonce]);

  const filteredKnowledgeBases = useMemo(() => {
    const queryText = registrySearch.trim().toLowerCase();
    return data.knowledgeBases
      .filter((kb) => registryDomain === "all" || (readText(kb, ["domain"]) || "general") === registryDomain)
      .filter((kb) => !queryText || kbSearchText(kb).includes(queryText))
      .sort((left, right) =>
        (readText(left, ["display_name", "kb_id"]) || "").localeCompare(
          readText(right, ["display_name", "kb_id"]) || "",
        ),
      );
  }, [data.knowledgeBases, registryDomain, registrySearch]);

  const selectedAgentAssignments = useMemo(() => {
    if (!selectedKbIdValue) {
      return [];
    }

    return Object.entries(data.agentAssignments)
      .flatMap(([agentId, assignments]) =>
        assignments.knowledge
          .filter((assignment) => readText(assignment, ["kb_id"]) === selectedKbIdValue)
          .map((assignment) => ({ agentId, assignment })),
      );
  }, [data.agentAssignments, selectedKbIdValue]);

  function openCreateForm() {
    setFormMode("create");
    setKbForm(emptyKbForm(defaultEnvironment));
    setBuilderFiles([]);
    setBuilderMessage("");
    setPageMessage("");
    setIndexAfterCreate(true);
    setShowBuilder(true);
  }

  function openEditForm(kb: ApiRecord) {
    const kbId = readText(kb, ["kb_id"]) || "";
    setSelectedKbId(kbId);
    closeSelectedWorkspace();
    setFormMode("edit");
    setKbForm(formFromKb(kb, kbId === selectedKbId ? selectedVersions : [], defaultEnvironment, "edit"));
    setBuilderFiles([]);
    setBuilderMessage("");
    setPageMessage("");
    setIndexAfterCreate(true);
    setShowBuilder(true);
    setActionMenuKbId(null);
  }

  function openDuplicateForm(kb: ApiRecord) {
    const kbId = readText(kb, ["kb_id"]) || "";
    setSelectedKbId(kbId);
    setFormMode("duplicate");
    setKbForm(formFromKb(kb, [], defaultEnvironment, "duplicate"));
    setBuilderFiles([]);
    setBuilderMessage("");
    setPageMessage("");
    setIndexAfterCreate(true);
    setShowBuilder(true);
    setActionMenuKbId(null);
  }

  function openSelectedWorkspace(kb: ApiRecord) {
    const kbId = readText(kb, ["kb_id"]) || "";
    if (!kbId) {
      return;
    }

    setSelectedKbId(kbId);
    setWorkspaceMessage("");
    setPageMessage("");
    setShowSelectedWorkspace(true);
    setActionMenuKbId(null);
  }

  function closeBuilder() {
    setBuilderMessage("");
    setShowBuilder(false);
  }

  function closeSelectedWorkspace() {
    setWorkspaceMessage("");
    setShowSelectedWorkspace(false);
  }

  function openDeleteDialog(kb: ApiRecord) {
    setDeleteMessage("");
    setPageMessage("");
    setActionMenuKbId(null);
    setDeleteDialogKb(kb);
  }

  function closeDeleteDialog() {
    setDeleteMessage("");
    setDeleteDialogKb(null);
  }

  async function withToken(action: (token: string) => Promise<void>, setFeedback: FeedbackSetter = setPageMessage) {
    setFeedback("");
    const session = getSession();
    if (!session?.token) {
      setFeedback("Session expired. Login again before changing knowledge bases.");
      return;
    }

    try {
      await action(session.token);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Knowledge base action failed.");
    }
  }

  function versionPayload(status: KnowledgeBaseVersionPayload["status"] = "draft"): KnowledgeBaseVersionPayload {
    const scopeRef =
      kbForm.kb_scope === "agent"
        ? kbForm.linked_agent_id.trim()
        : kbForm.kb_scope === "domain"
          ? kbForm.domain.trim()
          : "shared";
    return {
      version: kbForm.version.trim(),
      status,
      notes: kbForm.notes.trim(),
      profile: {
        display_name: kbForm.display_name.trim(),
        description: kbForm.description.trim(),
        owner: kbForm.owner.trim() || "Unassigned",
        domain: kbForm.domain.trim(),
        sensitivity: kbForm.sensitivity,
        environment: kbForm.environment.trim(),
      },
      file_manifest: null,
      retrieval_mode: kbForm.retrieval_mode,
      kb_scope: kbForm.kb_scope,
      scope_ref: scopeRef,
      vector_backend: kbForm.retrieval_mode === "vector" ? "pgvector" : "",
      embedding_model: kbForm.embedding_model.trim() || "nomic-embed-text",
      chunking_strategy: kbForm.chunking_strategy,
      chunk_size: kbForm.chunk_size,
      chunk_overlap: kbForm.chunk_overlap,
    };
  }

  function createPayload(): KnowledgeBaseCreateWithFilesPayload {
    const scopeRef =
      kbForm.kb_scope === "agent"
        ? kbForm.linked_agent_id.trim()
        : kbForm.kb_scope === "domain"
          ? kbForm.domain.trim()
          : "shared";
    const isVector = kbForm.retrieval_mode === "vector";

    return {
      kb_id: kbForm.kb_id.trim(),
      display_name: kbForm.display_name.trim(),
      description: kbForm.description.trim(),
      owner: kbForm.owner.trim() || "Unassigned",
      domain: kbForm.domain.trim(),
      environment: kbForm.environment.trim(),
      sensitivity: kbForm.sensitivity,
      retrieval_mode: kbForm.retrieval_mode,
      kb_scope: kbForm.kb_scope,
      scope_ref: scopeRef,
      linked_agent_id: kbForm.kb_scope === "agent" ? kbForm.linked_agent_id.trim() : "",
      version: kbForm.version.trim(),
      notes: kbForm.notes.trim(),
      vector_backend: isVector ? "pgvector" : "",
      embedding_model: kbForm.embedding_model.trim() || "nomic-embed-text",
      chunking_strategy: kbForm.chunking_strategy,
      chunk_size: kbForm.chunk_size,
      chunk_overlap: kbForm.chunk_overlap,
      index_after_create: isVector ? indexAfterCreate : false,
    };
  }

  function handleBuilderFilesChange(event: ChangeEvent<HTMLInputElement>) {
    const incoming = Array.from(event.target.files || []);
    if (!incoming.length) {
      return;
    }

    const availableSlots = Math.max(0, builderFileSlots - builderFiles.length);
    if (incoming.length > availableSlots) {
      setBuilderMessage(`A KB can include at most ${MAX_FILES_PER_KB} files.`);
    } else {
      setBuilderMessage("");
    }

    setBuilderFiles((files) => files.concat(incoming.slice(0, availableSlots)));
    event.target.value = "";
  }

  function removeBuilderFile(indexToRemove: number) {
    setBuilderFiles((files) => files.filter((_, index) => index !== indexToRemove));
  }

  async function submitKnowledgeBase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedKbId = kbForm.kb_id.trim();
    const trimmedDisplayName = kbForm.display_name.trim();
    const trimmedEnvironment = kbForm.environment.trim();

    if (!trimmedKbId || !trimmedDisplayName || !trimmedEnvironment) {
      setBuilderMessage("KB ID, display name, and environment are required.");
      return;
    }
    if (kbForm.kb_scope === "agent" && !kbForm.linked_agent_id.trim()) {
      setBuilderMessage("Select the dedicated agent for an agent-scoped KB.");
      return;
    }
    if (kbForm.kb_scope === "domain" && !kbForm.domain.trim()) {
      setBuilderMessage("Domain is required for a domain-scoped KB.");
      return;
    }
    if (!/^v\d+\.\d+\.\d+$/.test(kbForm.version.trim())) {
      setBuilderMessage("Version must use v0.0.0 format.");
      return;
    }
    if (builderFiles.length > builderFileSlots) {
      setBuilderMessage(`A KB can include at most ${MAX_FILES_PER_KB} files.`);
      return;
    }
    if (formMode !== "edit" && builderFiles.length === 0) {
      setBuilderMessage("Attach at least one file before creating a KB.");
      return;
    }

    await withToken(async (token) => {
      if (formMode === "edit") {
        for (const file of builderFiles) {
          await uploadKnowledgeFile(token, trimmedKbId, file);
        }
        await createKnowledgeBaseVersion(token, trimmedKbId, versionPayload("draft"));
        if (kbForm.retrieval_mode === "vector" && indexAfterCreate) {
          await syncKnowledgeBase(token, trimmedKbId, {
            embedding_model: kbForm.embedding_model.trim() || "nomic-embed-text",
            vector_backend: "pgvector",
            chunk_size: kbForm.chunk_size,
            chunk_overlap: kbForm.chunk_overlap,
            force_reindex: true,
          });
        }
        setPageMessage(`Draft ${kbForm.version.trim()} saved. Publish it after review.`);
        await onRefresh();
        setDetailRefreshNonce((value) => value + 1);
        setBuilderMessage("");
        closeBuilder();
        setBuilderFiles([]);
        return;
      }

      await createKnowledgeBaseWithFiles(token, createPayload(), builderFiles);
      setPageMessage(
        formMode === "duplicate"
          ? "KB duplicated with a draft version. Select its registered KB card to review it."
          : kbForm.retrieval_mode === "vector" && indexAfterCreate
            ? "KB created and indexing started. Select its registered KB card to review it."
            : "KB created with a draft version. Select its registered KB card to review it.",
      );
      try {
        await onRefresh();
      } finally {
        setBuilderMessage("");
        closeBuilder();
        setBuilderFiles([]);
      }
    }, setBuilderMessage);
  }

  async function syncSelectedKb() {
    if (!selectedKbIdValue || selectedMode !== "vector") {
      return;
    }

    await withToken(async (token) => {
      await syncKnowledgeBase(token, selectedKbIdValue, {
        embedding_model: embeddingModelFor(selectedKbRecord),
        vector_backend: "pgvector",
        chunk_size: numberValue(sourceConfigFor(selectedKbRecord), ["chunk_size"], 512),
        chunk_overlap: numberValue(sourceConfigFor(selectedKbRecord), ["chunk_overlap"], 80),
        force_reindex: true,
      });
      setWorkspaceMessage("Index sources completed. Query this KB to inspect retrieval quality.");
      await onRefresh();
      setDetailRefreshNonce((value) => value + 1);
    }, setWorkspaceMessage);
  }

  async function saveVersionForArchive(kb: ApiRecord) {
    const kbId = readText(kb, ["kb_id"]) || "";
    if (!kbId) {
      return;
    }

    await withToken(async (token) => {
      await createKnowledgeBaseVersion(token, kbId, {
        version: nextMinorVersion(kbId === selectedKbId ? selectedVersions : [], kb),
        status: "archived",
        notes: "Archived from the KB registry menu.",
        profile: {
          display_name: readText(kb, ["display_name", "kb_id"]) || "",
          description: readText(kb, ["description"]) || "",
          owner: readText(kb, ["owner"]) || "Unassigned",
          domain: readText(kb, ["domain"]) || "",
          sensitivity: readText(kb, ["sensitivity"]) || "internal",
          environment: readText(kb, ["environment"]) || defaultEnvironment,
        },
        file_manifest: null,
        retrieval_mode: retrievalModeFor(kb),
        kb_scope: scopeFor(kb),
        scope_ref: scopeRefFor(kb),
        vector_backend: retrievalModeFor(kb) === "vector" ? "pgvector" : "",
        embedding_model: embeddingModelFor(kb),
        chunking_strategy: chunkingStrategyFor(kb),
        chunk_size: numberValue(sourceConfigFor(kb), ["chunk_size"], 512),
        chunk_overlap: numberValue(sourceConfigFor(kb), ["chunk_overlap"], 80),
      });
      setPageMessage("Archived version saved.");
      setActionMenuKbId(null);
      await onRefresh();
      setDetailRefreshNonce((value) => value + 1);
    });
  }

  async function runKnowledgeBaseEvaluation(kb: ApiRecord) {
    const kbId = readText(kb, ["kb_id"]) || "";
    if (!kbId) {
      setWorkspaceMessage("KB record is missing kb_id.");
      return;
    }

    await withToken(async (token) => {
      setEvaluatingKbId(kbId);
      try {
        const result = await evaluateKnowledgeBase(token, kbId);
        setEvaluationResults((items) => ({ ...items, [kbId]: result }));
        setWorkspaceMessage(`${evaluationLabel(evaluationStatusFor(kb, result))} evaluation recorded for ${readText(kb, ["display_name", "kb_id"]) || kbId}.`);
        await onRefresh();
        setDetailRefreshNonce((value) => value + 1);
      } finally {
        setEvaluatingKbId(null);
        setActionMenuKbId(null);
      }
    }, setWorkspaceMessage);
  }

  async function confirmDeleteKnowledgeBase() {
    const kb = deleteDialogKb;
    const kbId = readText(kb || {}, ["kb_id"]) || "";
    if (!kb || !kbId) {
      closeDeleteDialog();
      return;
    }

    await withToken(async (token) => {
      setDeletingKbId(kbId);
      try {
        await deleteKnowledgeBase(token, kbId);
        setPageMessage(`${readText(kb, ["display_name", "kb_id"]) || kbId} deleted.`);
        setDeleteMessage("");
        closeDeleteDialog();
        setActionMenuKbId(null);
        if (selectedKbId === kbId) {
          setSelectedKbId("");
          closeSelectedWorkspace();
          setSelectedKbDetail(null);
          setSelectedDocuments([]);
          setSelectedVersions([]);
          setQueryResults([]);
        }
        await onRefresh();
      } finally {
        setDeletingKbId(null);
      }
    }, setDeleteMessage);
  }

  async function publishVersion(version: ApiRecord) {
    if (!selectedKbIdValue) {
      return;
    }
    const versionId = readText(version, ["version_id"]) || "";
    if (!versionId) {
      setWorkspaceMessage("Version record is missing version_id.");
      return;
    }

    await withToken(async (token) => {
      await publishKnowledgeBaseVersion(token, selectedKbIdValue, versionId);
      setWorkspaceMessage(`${readText(version, ["version"]) || "Version"} published.`);
      await onRefresh();
      setDetailRefreshNonce((value) => value + 1);
    }, setWorkspaceMessage);
  }

  async function testQuery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedKbIdValue || selectedMode !== "vector" || !query.trim()) {
      return;
    }

    const queryKbId = selectedKbIdValue;
    const requestId = queryRequestIdRef.current + 1;
    queryRequestIdRef.current = requestId;

    await withToken(async (token) => {
      const results = await queryKnowledgeBase(token, queryKbId, {
        query,
        top_k: queryTopK,
      });

      if (requestId !== queryRequestIdRef.current || selectedKbIdRef.current !== queryKbId) {
        return;
      }

      setQueryResults(results);
      setWorkspaceMessage(results.length ? "KB query completed." : "No semantic matches returned.");
    }, setWorkspaceMessage);
  }

  const selectedFreshEvaluation = selectedKbIdValue ? evaluationResults[selectedKbIdValue] : undefined;
  const selectedEvaluationPayload = selectedKbRecord
    ? evaluationPayloadFor(selectedKbRecord, selectedFreshEvaluation)
    : undefined;
  const selectedEvaluationStatus = selectedKbRecord
    ? evaluationStatusFor(selectedKbRecord, selectedFreshEvaluation)
    : "not_evaluated";
  const selectedEvaluationChecks = selectedEvaluationPayload
    ? Object.entries(readRecord(selectedEvaluationPayload, "checks") || {})
    : [];

  const nextAction = !selectedKbRecord
    ? "Select or create a KB"
    : selectedDocuments.length === 0
      ? "Attach files in a draft version"
      : selectedMode === "vector" && !latestIndex
        ? "Index sources"
        : !publishedVersion
          ? "Publish version"
          : "Ready for assignment";

  return (
    <section className="grid gap-5">
      <FeedbackAlert message={pageMessage} tone="neutral" />

      <PlatformSurface tone="cyan">
        <div className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(320px,0.6fr)] xl:items-center">
          <div>
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
              Knowledge Base onboarding
            </span>
            <h2 className="mt-2 text-xl font-semibold tracking-[-0.02em] text-textPrimary">
              Create governed knowledge bases
            </h2>
            <p className="mt-2 text-sm leading-6 text-textSecondary">
              Build KBs with files, version metadata, and evaluation controls in one governed flow.
            </p>
          </div>
          <button
            type="button"
            onClick={openCreateForm}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-accent/45 bg-accent px-5 py-4 text-sm font-semibold text-ink transition hover:bg-accent/90"
          >
            <UploadCloud size={17} aria-hidden="true" />
            Create KB
          </button>
        </div>
      </PlatformSurface>

      {showBuilder ? (
        <div
          aria-labelledby="kb-builder-title"
          aria-modal="true"
          className="fixed inset-0 z-50 overflow-y-auto bg-ink/75 px-4 py-6 backdrop-blur-sm"
          role="dialog"
        >
        <PlatformSurface
          tone="sky"
          className="mx-auto max-h-[calc(100vh-3rem)] max-w-6xl overflow-y-auto"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
                {formMode === "edit" ? "Draft version" : "KB profile"}
              </span>
              <h3 id="kb-builder-title" className="mt-2 text-xl font-semibold text-textPrimary">
                {formMode === "edit" ? "Save new KB version" : formMode === "duplicate" ? "Duplicate KB" : "Create KB"}
              </h3>
            </div>
            <button
              type="button"
              onClick={closeBuilder}
              className="grid h-9 w-9 place-items-center rounded-xl border border-line bg-white/[0.04] text-textPrimary transition hover:border-accent/40 hover:bg-accent/10"
              aria-label="Close KB form"
              title="Close"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
          <FeedbackAlert message={builderMessage} className="mt-5" />
          <form className="mt-5 grid gap-4" onSubmit={submitKnowledgeBase}>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <label className="grid gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-textSecondary">
              KB ID
              <input
                className="field-input"
                disabled={formMode === "edit"}
                placeholder="claims-policy-kb"
                required
                value={kbForm.kb_id}
                onChange={(event) => setKbForm({ ...kbForm, kb_id: event.target.value })}
              />
            </label>
            <label className="grid gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-textSecondary">
              Display name
              <input
                className="field-input"
                placeholder="Claims Policy KB"
                required
                value={kbForm.display_name}
                onChange={(event) => setKbForm({ ...kbForm, display_name: event.target.value })}
              />
            </label>
            <label className="grid gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-textSecondary">
              Version
              <input
                className="field-input"
                placeholder="v0.1.0"
                required
                value={kbForm.version}
                onChange={(event) => setKbForm({ ...kbForm, version: event.target.value })}
              />
            </label>
            <label className="grid gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-textSecondary">
              Scope
              <select
                className="field-input"
                value={kbForm.kb_scope}
                onChange={(event) => setKbForm({ ...kbForm, kb_scope: event.target.value as KBScope })}
              >
                {scopeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            {kbForm.kb_scope === "agent" ? (
              <label className="grid gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-textSecondary">
                Dedicated agent
                <select
                  className="field-input"
                  required
                  value={kbForm.linked_agent_id}
                  onChange={(event) => setKbForm({ ...kbForm, linked_agent_id: event.target.value })}
                >
                  <option value="">Select agent</option>
                  {data.agents.map((agent) => {
                    const agentId = readText(agent, ["agent_id"]) || "";
                    return (
                      <option key={agentId} value={agentId}>
                        {readText(agent, ["display_name", "agent_id"]) || agentId}
                      </option>
                    );
                  })}
                </select>
              </label>
            ) : (
              <label className="grid gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-textSecondary">
                Domain
                <input
                  className="field-input"
                  disabled={kbForm.kb_scope === "shared"}
                  placeholder="claims"
                  required={kbForm.kb_scope === "domain"}
                  value={kbForm.kb_scope === "shared" ? "" : kbForm.domain}
                  onChange={(event) => setKbForm({ ...kbForm, domain: event.target.value })}
                />
              </label>
            )}
            <label className="grid gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-textSecondary">
              Owner
              <input
                className="field-input"
                placeholder="Claims Ops"
                value={kbForm.owner}
                onChange={(event) => setKbForm({ ...kbForm, owner: event.target.value })}
              />
            </label>
            <label className="grid gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-textSecondary">
              Sensitivity
              <select
                className="field-input"
                value={kbForm.sensitivity}
                onChange={(event) => setKbForm({ ...kbForm, sensitivity: event.target.value })}
              >
                <option value="public">Public</option>
                <option value="internal">Internal</option>
                <option value="confidential">Confidential</option>
                <option value="restricted">Restricted</option>
              </select>
            </label>
            <label className="grid gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-textSecondary">
              Environment
              <input
                className="field-input"
                placeholder="demo"
                required
                value={kbForm.environment}
                onChange={(event) => setKbForm({ ...kbForm, environment: event.target.value })}
              />
            </label>
            </div>

            <section className="rounded-2xl border border-line bg-white/[0.035] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-textSecondary">Retrieval mode</p>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {(["file", "vector"] as const).map((mode) => {
                  const active = kbForm.retrieval_mode === mode;
                  return (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setKbForm({ ...kbForm, retrieval_mode: mode })}
                      className={`rounded-2xl border p-4 text-left transition hover:border-accent/45 hover:bg-accent/10 ${
                        active ? "border-accent/45 bg-accent/10 text-textPrimary" : "border-line bg-ink/45 text-textSecondary"
                      }`}
                    >
                      <span className="flex items-center gap-3">
                        <span className="grid h-10 w-10 place-items-center rounded-xl border border-accent/25 bg-accent/10 text-accent">
                          {mode === "vector" ? <Server size={18} aria-hidden="true" /> : <FileText size={18} aria-hidden="true" />}
                        </span>
                        <span>
                          <strong className="block text-textPrimary">{mode === "vector" ? "Vector-indexed KB" : "File KB"}</strong>
                          <span className="mt-1 block text-sm leading-6">
                            {mode === "vector"
                              ? "Use LlamaIndex, Ollama, chunking, and pgvector for semantic retrieval."
                              : "Files are the knowledge source. No embeddings or pgvector ingestion."}
                          </span>
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="rounded-2xl border border-line bg-white/[0.035] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-textPrimary">{kbForm.retrieval_mode === "vector" ? "Source files for indexing" : "File sources"}</p>
                  <p className="mt-1 text-sm leading-6 text-textSecondary">
                    Attach up to {MAX_FILES_PER_KB} files. {kbForm.retrieval_mode === "file" ? "Images are allowed for File KBs." : "Vector KBs accept documents that can be indexed."}
                  </p>
                </div>
                <span className="rounded-full border border-line bg-ink/60 px-3 py-1 text-xs font-semibold text-textSecondary">
                  {formMode === "edit" ? `${selectedDocuments.length + builderFiles.length}/${MAX_FILES_PER_KB}` : `${builderFiles.length}/${MAX_FILES_PER_KB}`}
                </span>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                <label className="grid gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-textSecondary">
                  <span className="flex items-center gap-2">
                    Select files
                    <span className="relative inline-flex normal-case tracking-normal">
                      <span
                        aria-label="Best file format for knowledge bases"
                        className="peer inline-flex cursor-help text-textSecondary transition hover:text-accent focus:text-accent focus:outline-none"
                        role="img"
                        tabIndex={0}
                      >
                        <CircleHelp size={14} aria-hidden="true" />
                      </span>
                      <span
                        className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 hidden w-64 -translate-x-1/2 rounded-xl border border-line bg-ink px-3 py-2 text-[11px] font-medium leading-5 text-textPrimary shadow-xl peer-hover:block peer-focus:block"
                        role="tooltip"
                      >
                        Markdown (.md) is preferred because headings, lists, and sections stay clean for review and ingestion.
                      </span>
                    </span>
                  </span>
                  <input
                    accept={builderFileAccept}
                    className="field-input"
                    disabled={builderFileLimitReached}
                    multiple
                    type="file"
                    onChange={handleBuilderFilesChange}
                  />
                </label>
                <span className="rounded-full border border-line bg-ink/55 px-4 py-3 text-sm font-semibold text-textSecondary">
                  {builderFileLimitReached ? "File limit reached" : `${builderFileSlots - builderFiles.length} slots left`}
                </span>
              </div>
              <div className="mt-4 grid gap-2">
                {formMode === "edit" ? (
                  <div className="grid gap-2 rounded-xl border border-line bg-ink/45 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-textPrimary">Already attached files</p>
                      <span className="rounded-full border border-line bg-white/[0.04] px-2.5 py-1 text-[11px] font-semibold text-textSecondary">
                        {detailLoading ? "loading" : formatCount(selectedDocuments.length, "file")}
                      </span>
                    </div>
                    {detailLoading ? (
                      <ComponentRow title="Loading attached files" detail="Reading the persisted KB document manifest." />
                    ) : selectedDocuments.length ? (
                      selectedDocuments.map((document) => {
                        const checksum = readText(document, ["checksum"]) || "";
                        return (
                          <ComponentRow
                            key={readText(document, ["document_id"]) || readText(document, ["file_name"])}
                            title={readText(document, ["file_name"]) || "Knowledge document"}
                            detail={
                              joinParts([
                                readText(document, ["content_type"]),
                                formatFileSize(numberValue(document, ["size_bytes"])),
                                checksum ? `sha256 ${checksum.slice(0, 10)}` : "",
                                readText(document, ["last_error"]),
                              ]) || "Persisted as a KB source document."
                            }
                            meta={readText(document, ["status"]) || "uploaded"}
                          />
                        );
                      })
                    ) : (
                      <ComponentRow
                        title="No files attached yet"
                        detail="Attach files below and save the draft version to persist them."
                      />
                    )}
                  </div>
                ) : null}
                {builderFiles.length ? (
                  <div className="grid gap-2">
                    {formMode === "edit" ? (
                      <p className="text-sm font-semibold text-textPrimary">New files for this draft version</p>
                    ) : null}
                    {builderFiles.map((file, index) => (
                      <div key={`${file.name}-${file.size}-${file.lastModified}-${index}`} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-ink/50 px-3 py-2 text-sm">
                        <span className="min-w-0">
                          <span className="block truncate font-semibold text-textPrimary">{file.name}</span>
                          <span className="text-xs text-textSecondary">{formatFileSize(file.size) || "Selected file"}</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => removeBuilderFile(index)}
                          className="grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-line bg-white/[0.04] text-textPrimary transition hover:border-rose-300/45 hover:bg-rose-300/10"
                          aria-label={`Remove ${file.name}`}
                          title="Remove file"
                        >
                          <X size={15} aria-hidden="true" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <ComponentRow
                    title={formMode === "edit" ? "No new files selected" : "No files selected"}
                    detail={formMode === "edit" ? "Existing files remain attached. Select files only when this draft version needs additional sources." : "Attach at least one file to create the KB."}
                  />
                )}
              </div>
            </section>

            {kbForm.retrieval_mode === "vector" ? (
              <section className="rounded-2xl border border-line bg-white/[0.035] p-4">
                <div className="grid gap-3 md:grid-cols-3">
                  <ComponentRow title="pgvector" detail="Target vector store" meta="store" />
                  <ComponentRow title="LlamaIndex" detail="Ingestion and indexing engine" meta="ingest" />
                  <ComponentRow title="Ollama" detail="Local embedding provider" meta="embed" />
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <label className="grid gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-textSecondary">
                  Embedding model
                  <input
                    className="field-input"
                    placeholder="nomic-embed-text"
                    value={kbForm.embedding_model}
                    onChange={(event) => setKbForm({ ...kbForm, embedding_model: event.target.value })}
                  />
                  </label>
                  <label className="grid gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-textSecondary">
                  Chunking strategy
                  <select
                    className="field-input"
                    value={kbForm.chunking_strategy}
                    onChange={(event) => setKbForm({ ...kbForm, chunking_strategy: event.target.value as ChunkingStrategy })}
                  >
                    {chunkingOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                      ))}
                    </select>
                  </label>
                  {usesFixedSizeControls(kbForm.chunking_strategy) ? (
                    <>
                      <label className="grid gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-textSecondary">
                      Chunk size
                      <input
                        className="field-input"
                        max={8192}
                        min={128}
                        type="number"
                        value={kbForm.chunk_size}
                        onChange={(event) => setKbForm({ ...kbForm, chunk_size: Math.max(128, Number(event.target.value) || 512) })}
                      />
                      </label>
                      <label className="grid gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-textSecondary">
                      Chunk overlap
                      <input
                        className="field-input"
                        max={2048}
                        min={0}
                        type="number"
                        value={kbForm.chunk_overlap}
                        onChange={(event) => setKbForm({ ...kbForm, chunk_overlap: Math.max(0, Number(event.target.value) || 0) })}
                      />
                      </label>
                    </>
                  ) : null}
                </div>
                <div className="mt-3">
                  <ComponentRow
                    title={nodeParserLabels[kbForm.chunking_strategy]}
                    detail={chunkingStrategyDetails[kbForm.chunking_strategy]}
                    meta="parser"
                  />
                </div>
                <label className="mt-4 flex items-center gap-3 rounded-2xl border border-line bg-ink/50 px-4 py-3 text-sm font-semibold text-textPrimary">
                  <input
                    checked={indexAfterCreate}
                    className="h-4 w-4 accent-accent"
                    type="checkbox"
                    onChange={(event) => setIndexAfterCreate(event.target.checked)}
                  />
                  Index after create
                </label>
              </section>
            ) : (
              <section className="rounded-2xl border border-line bg-white/[0.035] p-4">
                <p className="font-semibold text-textPrimary">File KB behavior</p>
                <p className="mt-2 text-sm leading-6 text-textSecondary">
                  Uploaded files are stored and versioned as the KB source of truth. File KBs do not run LlamaIndex ingestion, create chunks, generate embeddings, write pgvector rows, or enable semantic query.
                </p>
              </section>
            )}
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-textSecondary">
                Description
                <textarea
                  className="field-input min-h-24 resize-y"
                  placeholder="Claims operating procedures."
                  value={kbForm.description}
                  onChange={(event) => setKbForm({ ...kbForm, description: event.target.value })}
                />
              </label>
              <label className="grid gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-textSecondary">
                Version notes
                <textarea
                  className="field-input min-h-24 resize-y"
                  placeholder="What changed in this version?"
                  value={kbForm.notes}
                  onChange={(event) => setKbForm({ ...kbForm, notes: event.target.value })}
                />
              </label>
            </div>
            <button className="inline-flex w-fit items-center gap-2 rounded-full bg-accent px-5 py-3 text-sm font-semibold text-ink transition hover:bg-accent/90" type="submit">
              <UploadCloud size={16} aria-hidden="true" />
              {formMode === "edit"
                ? "Save Draft Version"
                : kbForm.retrieval_mode === "vector" && indexAfterCreate
                  ? "Create and Index KB"
                  : kbForm.retrieval_mode === "vector"
                    ? "Create Vector KB"
                    : "Create File KB"}
            </button>
          </form>
        </PlatformSurface>
        </div>
      ) : null}

      <section className="grid gap-5 xl:grid-cols-[minmax(290px,0.34fr)_minmax(0,1fr)]">
        <PlatformSurface tone="cyan">
          <div>
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
              Knowledge harness
            </span>
            <h3 className="mt-2 text-xl font-semibold tracking-[-0.02em] text-textPrimary">
              Govern registered KBs
            </h3>
            <p className="mt-2 text-sm leading-6 text-textSecondary">
              Browse registered knowledge bases by domain.
            </p>
          </div>
          <div className="mt-5 rounded-2xl border border-line bg-ink/45 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-textSecondary">
              Registered KBs
            </p>
            <p className="mt-2 text-3xl font-semibold text-textPrimary">{data.knowledgeBases.length}</p>
          </div>
          <div className="mt-6 border-t border-line pt-5">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-textSecondary">
              <Filter size={14} aria-hidden="true" />
              Domain
            </p>
            <div className="mt-3 grid gap-2">
              <button
                type="button"
                onClick={() => setRegistryDomain("all")}
                className={`flex items-center justify-between rounded-xl border px-3 py-2 text-left text-sm font-semibold transition hover:border-accent/45 hover:bg-accent/10 ${
                  registryDomain === "all" ? "border-accent/45 bg-accent/10 text-textPrimary" : "border-line bg-ink/45 text-textSecondary"
                }`}
              >
                <span>All domains</span>
                <span>{data.knowledgeBases.length}</span>
              </button>
              {domainFilters.map((item) => (
                <button
                  key={item.domain}
                  type="button"
                  onClick={() => setRegistryDomain(item.domain)}
                  className={`flex items-center justify-between rounded-xl border px-3 py-2 text-left text-sm font-semibold transition hover:border-accent/45 hover:bg-accent/10 ${
                    registryDomain === item.domain ? "border-accent/45 bg-accent/10 text-textPrimary" : "border-line bg-ink/45 text-textSecondary"
                  }`}
                >
                  <span className="truncate">{item.domain}</span>
                  <span>{item.count}</span>
                </button>
              ))}
            </div>
          </div>
        </PlatformSurface>

        <section className="grid gap-5">
          <section className="rounded-3xl border border-line bg-white/[0.035] p-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <span className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
                  Registered knowledge bases
                </span>
                <h3 className="mt-2 text-xl font-semibold text-textPrimary">Created KBs</h3>
              </div>
              <span className="rounded-full border border-line bg-ink/55 px-3 py-1 text-xs font-semibold text-textSecondary">
                {dataStatus === "loading" ? "Loading" : `${filteredKnowledgeBases.length} visible`}
              </span>
            </div>
            <label className="mt-5 flex items-center gap-3 rounded-2xl border border-line bg-ink/65 px-4 py-3 text-sm text-textSecondary">
              <Search size={17} aria-hidden="true" />
              <input
                className="w-full bg-transparent text-textPrimary outline-none placeholder:text-textSecondary"
                placeholder="Search KBs by name, owner, domain, or environment..."
                value={registrySearch}
                onChange={(event) => setRegistrySearch(event.target.value)}
              />
            </label>
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {filteredKnowledgeBases.length ? (
                filteredKnowledgeBases.map((kb) => {
                  const kbId = readText(kb, ["kb_id"]) || "";
                  const mode = retrievalModeFor(kb);
                  const version = readRecord(kb, "published_version") || readRecord(kb, "latest_version");
                  const selected = selectedKbId === kbId;
                  const fileCount = localFileCountFor(kb, selectedKbIdValue, selectedDocuments);

                  return (
                    <article
                      key={kbId}
                      className={`rounded-2xl border bg-white/[0.035] p-4 transition ${
                        selected ? "border-accent/60 bg-accent/10" : "border-line hover:border-accent/35"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <button
                          type="button"
                          aria-label={`Select ${readText(kb, ["display_name", "kb_id"]) || "knowledge base"}`}
                          aria-pressed={selected}
                          onClick={() => openSelectedWorkspace(kb)}
                          className="min-w-0 flex-1 text-left focus:outline-none"
                        >
                          <span className="flex items-start gap-3">
                            <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-accent/25 bg-accent/10 text-accent">
                              {mode === "vector" ? <Server size={17} aria-hidden="true" /> : <FileText size={17} aria-hidden="true" />}
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate font-semibold text-textPrimary">
                                {readText(kb, ["display_name", "kb_id"])}
                              </span>
                              <span className="mt-1 block truncate text-xs text-textSecondary">{kbId}</span>
                              <span className="mt-2 block line-clamp-2 text-sm leading-6 text-textSecondary">
                                {readText(kb, ["description"]) || "No description."}
                              </span>
                            </span>
                          </span>
                        </button>
                        <div className="flex shrink-0 gap-2">
                          <div className="relative">
                            <button
                              type="button"
                              onClick={() => setActionMenuKbId((value) => (value === kbId ? null : kbId))}
                              className="grid h-9 w-9 place-items-center rounded-xl border border-line bg-white/[0.04] text-textPrimary transition hover:border-accent/45 hover:bg-accent/10"
                              aria-expanded={actionMenuKbId === kbId}
                              aria-haspopup="menu"
                              aria-label={`KB actions for ${readText(kb, ["display_name", "kb_id"]) || "knowledge base"}`}
                              title="KB actions"
                            >
                              <MoreHorizontal size={16} aria-hidden="true" />
                            </button>
                            {actionMenuKbId === kbId ? (
                              <div className="absolute right-0 top-11 z-20 w-56 overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl" role="menu">
                                <button type="button" role="menuitem" onClick={() => openEditForm(kb)} className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-semibold text-textPrimary transition hover:bg-accent/10">
                                  <PencilLine size={15} aria-hidden="true" />
                                  Edit KB
                                </button>
                                <button type="button" role="menuitem" onClick={() => openDuplicateForm(kb)} className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-semibold text-textPrimary transition hover:bg-accent/10">
                                  <Copy size={15} aria-hidden="true" />
                                  Duplicate as new KB
                                </button>
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() => {
                                    openSelectedWorkspace(kb);
                                    setWorkspaceMessage("Version history is shown in the selected KB workspace.");
                                  }}
                                  className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-semibold text-textPrimary transition hover:bg-accent/10"
                                >
                                  <Database size={15} aria-hidden="true" />
                                  View versions
                                </button>
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() => {
                                    openSelectedWorkspace(kb);
                                    void runKnowledgeBaseEvaluation(kb);
                                  }}
                                  className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-semibold text-textPrimary transition hover:bg-accent/10"
                                >
                                  <ListChecks size={15} aria-hidden="true" />
                                  {evaluatingKbId === kbId ? "Evaluating" : "Evaluate KB"}
                                </button>
                                <button type="button" role="menuitem" onClick={() => saveVersionForArchive(kb)} className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-semibold text-textPrimary transition hover:bg-accent/10">
                                  <Archive size={15} aria-hidden="true" />
                                  Archive KB
                                </button>
                              </div>
                            ) : null}
                          </div>
                          <button
                            type="button"
                            onClick={() => openDeleteDialog(kb)}
                            className="grid h-9 w-9 place-items-center rounded-xl border border-rose-300/35 bg-rose-300/10 text-rose-100 transition hover:border-rose-300/65 hover:bg-rose-300/15"
                            aria-label={`Delete ${readText(kb, ["display_name", "kb_id"]) || "knowledge base"}`}
                            title="Delete KB"
                          >
                            <Trash2 size={15} aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2 text-xs text-textSecondary">
                        <span className="rounded-full border border-line bg-ink/55 px-2.5 py-1">{displayVersion(version)}</span>
                        <span className="rounded-full border border-line bg-ink/55 px-2.5 py-1">{fileCount}/{MAX_FILES_PER_KB} files</span>
                        <span className="rounded-full border border-line bg-ink/55 px-2.5 py-1">{readText(kb, ["owner"]) || "Unassigned"}</span>
                        {readText(kb, ["domain"]) ? (
                          <span className="rounded-full border border-line bg-ink/55 px-2.5 py-1">{readText(kb, ["domain"])}</span>
                        ) : null}
                        <span className="rounded-full border border-line bg-ink/55 px-2.5 py-1">{readText(kb, ["environment"]) || "demo"}</span>
                      </div>
                    </article>
                  );
                })
              ) : (
                <ComponentRow
                  title={data.knowledgeBases.length ? "No matching KBs" : "No KBs registered"}
                  detail={data.knowledgeBases.length ? "Adjust the search or filters." : "Create a KB with files before assigning it to agents."}
                />
              )}
            </div>
          </section>

        {showSelectedWorkspace && selectedKbRecord ? (
          <div
            className="fixed inset-0 z-50 overflow-y-auto bg-ink/75 px-4 py-6 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="selected-kb-workspace-title"
          >
          <section className="mx-auto max-h-[calc(100vh-3rem)] max-w-7xl overflow-y-auto rounded-3xl border border-line bg-panel p-5 shadow-2xl">
            <>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <span className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
                    Selected workspace
                  </span>
                  <h3 id="selected-kb-workspace-title" className="mt-2 text-2xl font-semibold text-textPrimary">
                    {readText(selectedKbRecord, ["display_name", "kb_id"]) || "Knowledge Base"}
                  </h3>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-textSecondary">
                    {readText(selectedKbRecord, ["description"]) || "No description recorded."}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {selectedMode === "vector" ? (
                    <button
                      className="inline-flex items-center gap-2 rounded-full border border-line px-4 py-2 text-sm font-semibold text-textPrimary transition hover:border-accent/40 hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-50"
                      type="button"
                      onClick={syncSelectedKb}
                      disabled={detailLoading || !selectedDocuments.length}
                    >
                      <RefreshCw size={15} aria-hidden="true" />
                      Index sources
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={closeSelectedWorkspace}
                    className="grid h-9 w-9 place-items-center rounded-xl border border-line bg-white/[0.04] text-textPrimary transition hover:border-accent/40 hover:bg-accent/10"
                    aria-label="Close selected KB workspace"
                    title="Close"
                  >
                    <X size={16} aria-hidden="true" />
                  </button>
                </div>
              </div>
              <FeedbackAlert message={workspaceMessage} className="mt-5" />

              <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {[
                  ["Files", `${selectedDocuments.length}/${MAX_FILES_PER_KB}`],
                  ["Version", displayVersion(publishedVersion || latestVersion)],
                  ["Next action", nextAction],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl border border-line bg-ink/50 px-3 py-2">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-textSecondary">{label}</p>
                    <p className="mt-1 truncate text-sm font-semibold text-textPrimary">{value}</p>
                  </div>
                ))}
              </div>

              <section className="mt-5 rounded-2xl border border-line bg-white/[0.035] p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-textPrimary">KB evaluation</p>
                    <p className="mt-1 text-sm text-textSecondary">
                      Run readiness checks against the selected KB before assigning or publishing it.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${evaluationClasses(selectedEvaluationStatus)}`}>
                      {evaluationLabel(selectedEvaluationStatus)}
                    </span>
                    <button
                      type="button"
                      onClick={() => runKnowledgeBaseEvaluation(selectedKbRecord)}
                      disabled={evaluatingKbId === selectedKbIdValue}
                      className="inline-flex items-center gap-2 rounded-full border border-line bg-white/[0.04] px-4 py-2 text-sm font-semibold text-textPrimary transition hover:border-accent/40 hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <ListChecks size={15} aria-hidden="true" />
                      {evaluatingKbId === selectedKbIdValue ? "Evaluating" : "Evaluate KB"}
                    </button>
                  </div>
                </div>
                <div className="mt-4 grid gap-2 md:grid-cols-2">
                  {selectedEvaluationChecks.length ? (
                    selectedEvaluationChecks.map(([checkName, rawCheck]) => {
                      const check = isRecord(rawCheck) ? rawCheck : {};
                      const status = readText(check, ["status", "result"]) || "unknown";
                      return (
                        <ComponentRow
                          key={checkName}
                          title={checkName.replaceAll("_", " ")}
                          detail={readText(check, ["message", "detail", "reason"]) || status}
                          meta={status}
                        />
                      );
                    })
                  ) : (
                    <ComponentRow
                      title="No evaluation run"
                      detail="Evaluate this KB to check file coverage, version readiness, indexing state, and assignment readiness."
                    />
                  )}
                </div>
              </section>

              <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,0.95fr)_minmax(320px,0.7fr)]">
                <div className="grid gap-5">
                  <section className="rounded-2xl border border-line bg-white/[0.035] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-semibold text-textPrimary">Files</p>
                        <p className="mt-1 text-sm text-textSecondary">
                          Review the file manifest for this KB. Use Edit KB to attach files to a new draft version.
                        </p>
                      </div>
                      <span className="rounded-full border border-line bg-ink/60 px-3 py-1 text-xs font-semibold text-textSecondary">
                        {selectedDocuments.length}/{MAX_FILES_PER_KB}
                      </span>
                    </div>
                    <div className="mt-4 grid gap-2">
                      {selectedDocuments.length ? (
                        selectedDocuments.map((document) => (
                          <ComponentRow
                            key={readText(document, ["document_id"]) || readText(document, ["file_name"])}
                            title={readText(document, ["file_name"]) || "Knowledge document"}
                            detail={
                              joinParts([
                                readText(document, ["content_type"]),
                                formatCount(numberValue(document, ["chunk_count"]), "chunk"),
                                readText(document, ["last_error"]),
                              ]) || "Uploaded and waiting for version review."
                            }
                            meta={readText(document, ["status"])}
                          />
                        ))
                      ) : (
                        <ComponentRow
                          title={detailLoading ? "Loading files" : "No files attached"}
                          detail={
                            selectedMode === "file"
                              ? "Upload Markdown, text, PDF, DOCX, or image files. Markdown gives the cleanest KB structure."
                              : "Upload Markdown, text, PDF, or DOCX files for indexing."
                          }
                        />
                      )}
                    </div>
                  </section>

                  {selectedMode === "vector" ? (
                    <>
                      <section className="rounded-2xl border border-line bg-white/[0.035] p-4">
                        <p className="font-semibold text-textPrimary">Vector store</p>
                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                          <ComponentRow
                            title="pgvector"
                            detail={`Target store for ${scopeLabel(selectedScope).toLowerCase()} scope: ${scopeRefFor(selectedKbRecord)}.`}
                            meta="target"
                          />
                          <ComponentRow
                            title="LlamaIndex + Ollama"
                            detail={`Ingestion indexes sources with ${embeddingModelFor(selectedKbRecord)} before storing embeddings in pgvector.`}
                            meta="local"
                          />
                        </div>
                      </section>
                      <section className="rounded-2xl border border-line bg-white/[0.035] p-4">
                        <p className="font-semibold text-textPrimary">Chunking strategy</p>
                        <div
                          className={`mt-3 grid gap-3 ${
                            usesFixedSizeControls(chunkingStrategyFor(selectedKbRecord))
                              ? "md:grid-cols-2 xl:grid-cols-4"
                              : "md:grid-cols-2"
                          }`}
                        >
                          <ComponentRow
                            title={chunkingStrategyLabel(chunkingStrategyFor(selectedKbRecord))}
                            detail={chunkingStrategyDetails[chunkingStrategyFor(selectedKbRecord)]}
                            meta="strategy"
                          />
                          <ComponentRow
                            title={nodeParserLabels[chunkingStrategyFor(selectedKbRecord)]}
                            detail="LlamaIndex parser used during vector indexing."
                            meta="parser"
                          />
                          {usesFixedSizeControls(chunkingStrategyFor(selectedKbRecord)) ? (
                            <>
                              <ComponentRow
                                title={String(numberValue(sourceConfigFor(selectedKbRecord), ["chunk_size"], 512))}
                                detail="Target token window per chunk."
                                meta="size"
                              />
                              <ComponentRow
                                title={String(numberValue(sourceConfigFor(selectedKbRecord), ["chunk_overlap"], 80))}
                                detail="Overlap retained between neighboring chunks."
                                meta="overlap"
                              />
                            </>
                          ) : null}
                        </div>
                      </section>
                    </>
                  ) : (
                    <section className="rounded-2xl border border-line bg-white/[0.035] p-4">
                      <p className="font-semibold text-textPrimary">File KB mode</p>
                      <p className="mt-2 text-sm leading-6 text-textSecondary">
                        Uploaded files are the knowledge base. They are versioned as file manifests and do not need chunking, embeddings, pgvector indexing, or semantic query testing.
                      </p>
                    </section>
                  )}
                </div>

                <div className="grid content-start gap-5">
                  <section className="rounded-2xl border border-line bg-white/[0.035] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-semibold text-textPrimary">Versions</p>
                      <button
                        type="button"
                        onClick={() => openEditForm(selectedKbRecord)}
                        className="rounded-full border border-line bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-textPrimary transition hover:border-accent/40 hover:bg-accent/10"
                      >
                        Edit KB
                      </button>
                    </div>
                    <div className="mt-3 grid gap-2">
                      {selectedVersions.length ? (
                        selectedVersions.map((version) => {
                          const status = readText(version, ["status"]) || "draft";
                          return (
                            <div key={readText(version, ["version_id"]) || readText(version, ["version"])} className="rounded-2xl border border-line bg-ink/45 p-3">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="font-semibold text-textPrimary">{readText(version, ["version"]) || "v0.0.0"}</span>
                                <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusClasses(status)}`}>
                                  {status}
                                </span>
                              </div>
                              <p className="mt-2 text-sm leading-6 text-textSecondary">
                                {readText(version, ["notes"]) || joinParts([
                                  readText(version, ["retrieval_mode"]),
                                  readText(version, ["kb_scope"]),
                                  `${formatCount(fileManifestCount(version), "file")} snapshot`,
                                ]) || "No version notes."}
                              </p>
                              <div className="mt-3 flex flex-wrap gap-2">
                                {status !== "published" ? (
                                  <button
                                    type="button"
                                    onClick={() => publishVersion(version)}
                                    className="rounded-full border border-line bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-textPrimary transition hover:border-accent/40 hover:bg-accent/10"
                                  >
                                    Publish
                                  </button>
                                ) : null}
                                <span className="rounded-full border border-line bg-ink/60 px-3 py-1.5 text-xs font-semibold text-textSecondary">
                                  {readText(version, ["created_at"])?.slice(0, 10) || "no date"}
                                </span>
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <ComponentRow title="No versions loaded" detail="Create or select a KB to see append-only versions." />
                      )}
                    </div>
                  </section>

                  <section className="rounded-2xl border border-line bg-white/[0.035] p-4">
                    <p className="font-semibold text-textPrimary">Agent usage</p>
                    <div className="mt-3 grid gap-2">
                      {selectedAgentAssignments.length ? (
                        selectedAgentAssignments.map(({ agentId, assignment }) => (
                          <ComponentRow
                            key={readText(assignment, ["assignment_id"]) || agentId}
                            title={agentName(data, agentId)}
                            detail={joinParts([readText(assignment, ["access_mode"]), readText(assignment, ["retrieval_mode"])]) || "Knowledge base assigned."}
                            meta={readText(assignment, ["environment"])}
                          />
                        ))
                      ) : (
                        <ComponentRow title="No agent assignments" detail="Agents should use a published KB version or a pinned published version." />
                      )}
                    </div>
                  </section>
                </div>
              </div>

              {selectedMode === "vector" ? (
                <section className="mt-5 rounded-2xl border border-line bg-white/[0.035] p-4">
                  <div className="flex items-center gap-3">
                    <Search className="text-accent" size={20} aria-hidden="true" />
                    <p className="font-semibold text-textPrimary">Query this KB</p>
                  </div>
                  <form className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_112px_auto]" onSubmit={testQuery}>
                    <label className="grid gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-textSecondary">
                      Retrieval question
                      <input className="field-input" placeholder="Ask this knowledge base a question" value={query} onChange={(event) => setQuery(event.target.value)} />
                    </label>
                    <label className="grid gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-textSecondary">
                      Top K
                      <input
                        className="field-input"
                        max={20}
                        min={1}
                        type="number"
                        value={queryTopK}
                        onChange={(event) => setQueryTopK(Math.max(1, Math.min(20, Number(event.target.value) || 1)))}
                      />
                    </label>
                    <button
                      className="self-end rounded-full bg-accent px-5 py-3 text-sm font-semibold text-ink transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
                      type="submit"
                      disabled={!query.trim()}
                    >
                      Query
                    </button>
                  </form>
                  <div className="mt-4 grid gap-3">
                    {queryResults.length ? (
                      queryResults.map((result, index) => (
                        <ComponentRow
                          key={`${readText(result, ["score"]) || "result"}-${index}`}
                          title={`Result ${index + 1}`}
                          detail={readText(result, ["content"]) || "No content returned."}
                          meta={joinParts([
                            readText(readRecord(result, "metadata") || {}, ["file_name", "source_display_name"]),
                            readText(readRecord(result, "metadata") || {}, ["chunk_id"]),
                            readText(result, ["score"]),
                          ])}
                        />
                      ))
                    ) : (
                      <ComponentRow title="No query results" detail="Index sources, then run a query to inspect snippets, scores, and metadata." />
                    )}
                  </div>
                </section>
              ) : null}
            </>
          </section>
          </div>
        ) : null}
      </section>
      </section>

      {deleteDialogKb ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/75 px-4 py-8" role="dialog" aria-modal="true" aria-labelledby="delete-kb-title">
          <div className="w-full max-w-lg rounded-3xl border border-line bg-panel p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="text-xs font-semibold uppercase tracking-[0.2em] text-rose-100">Delete KB</span>
                <h3 id="delete-kb-title" className="mt-2 text-xl font-semibold text-textPrimary">
                  {readText(deleteDialogKb, ["display_name", "kb_id"]) || "Knowledge base"}
                </h3>
                <p className="mt-1 text-sm text-textSecondary">{readText(deleteDialogKb, ["kb_id"])}</p>
              </div>
              <button
                type="button"
                onClick={closeDeleteDialog}
                className="grid h-9 w-9 place-items-center rounded-xl border border-line bg-white/[0.04] text-textPrimary transition hover:border-accent/45 hover:bg-accent/10"
                aria-label="Cancel delete"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <div className="mt-5 grid gap-2 text-sm leading-6 text-textSecondary">
              <p>This removes KB versions, file/document records, sources, and vector index rows for this KB.</p>
              <p>Assigned KBs are blocked by the API and must be detached from agents before deletion.</p>
            </div>
            <FeedbackAlert message={deleteMessage} className="mt-5" tone="danger" />
            <div className="mt-5 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={closeDeleteDialog}
                className="rounded-full border border-line bg-white/[0.04] px-4 py-2 text-sm font-semibold text-textPrimary transition hover:border-accent/40 hover:bg-accent/10"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDeleteKnowledgeBase}
                disabled={Boolean(deletingKbId)}
                className="inline-flex items-center gap-2 rounded-full border border-rose-300/45 bg-rose-300/12 px-4 py-2 text-sm font-semibold text-rose-100 transition hover:bg-rose-300/18 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Trash2 size={15} aria-hidden="true" />
                {deletingKbId ? "Deleting" : "Delete KB"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
