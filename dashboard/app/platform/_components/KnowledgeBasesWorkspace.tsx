"use client";

import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { Database, FileText, Link2, RefreshCw, Search, Server, UploadCloud } from "lucide-react";
import {
  createKnowledgeBase,
  createKnowledgeSource,
  getSession,
  queryKnowledgeBase,
  syncKnowledgeBase,
  type ApiRecord,
  type KnowledgeSourcePayload,
  type PlatformData,
} from "@/lib/api";
import { ComponentRow, MetricSurface, PlatformSurface } from "./shared";
import type { DataStatus } from "./types";
import { formatCount, joinParts, readText } from "./utils";

type SourceType = "file" | "url" | "vector_store";

const sourceTypeOptions: Array<{ label: string; value: SourceType }> = [
  { label: "File", value: "file" },
  { label: "URL", value: "url" },
  { label: "Vector store", value: "vector_store" },
];

function sourceIcon(sourceType: string) {
  if (sourceType === "url") return Link2;
  if (sourceType === "vector_store") return Server;
  return FileText;
}

function numberValue(record: ApiRecord, keys: string[]) {
  return Number(readText(record, keys) || 0);
}

function sourceTypeLabel(value: string) {
  return sourceTypeOptions.find((option) => option.value === value)?.label || value || "Unknown";
}

export function KnowledgeBasesWorkspace({
  data,
  dataStatus,
  onRefresh,
}: {
  data: PlatformData;
  dataStatus: DataStatus;
  onRefresh: () => void;
}) {
  const firstKbId = readText(data.knowledgeBases[0] || {}, ["kb_id"]) || "";
  const [selectedKbId, setSelectedKbId] = useState(firstKbId);
  const selectedKb = data.knowledgeBases.find((kb) => readText(kb, ["kb_id"]) === selectedKbId) || data.knowledgeBases[0];
  const [message, setMessage] = useState("");
  const [kbForm, setKbForm] = useState({
    kb_id: "",
    display_name: "",
    description: "",
    owner: "",
    domain: "",
    sensitivity: "internal",
    source_type: "file" as SourceType,
    environment: "demo",
  });
  const [sourceForm, setSourceForm] = useState<KnowledgeSourcePayload>({
    source_type: "file",
    display_name: "",
    uri: "",
    content_type: "",
    source_config: {},
  });
  const [query, setQuery] = useState("");
  const [queryResults, setQueryResults] = useState<ApiRecord[]>([]);

  useEffect(() => {
    if (!selectedKbId && firstKbId) {
      setSelectedKbId(firstKbId);
    }
  }, [firstKbId, selectedKbId]);

  const sourceTypes = useMemo(() => {
    const counts = new Map<string, number>();

    data.knowledgeBases.forEach((kb) => {
      const value = readText(kb, ["source_type"]) || "unknown";
      counts.set(value, (counts.get(value) || 0) + 1);
    });

    return Array.from(counts.entries())
      .map(([type, count]) => `${sourceTypeLabel(type)}: ${count}`)
      .join(" / ");
  }, [data.knowledgeBases]);

  const assignedAgents = useMemo(
    () => Object.values(data.agentAssignmentCounts).filter((item) => item.knowledge > 0).length,
    [data.agentAssignmentCounts],
  );
  const documentCount = data.knowledgeBases.reduce((sum, kb) => sum + numberValue(kb, ["document_count"]), 0);
  const chunkCount = data.knowledgeBases.reduce((sum, kb) => sum + numberValue(kb, ["chunk_count"]), 0);
  const degradedCount = data.knowledgeBases.filter((kb) => {
    const status = readText(kb, ["status"]) || "";
    return status === "failed" || status === "degraded";
  }).length;
  const selectedKbIdValue = selectedKb ? readText(selectedKb, ["kb_id"]) || "" : "";
  const SelectedSourceIcon = sourceIcon(readText(selectedKb || {}, ["source_type"]) || "");

  async function withToken(action: (token: string) => Promise<void>) {
    setMessage("");
    const session = getSession();
    if (!session?.token) {
      setMessage("Session expired. Login again before changing knowledge bases.");
      return;
    }

    try {
      await action(session.token);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Knowledge base action failed.");
    }
  }

  async function submitKnowledgeBase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await withToken(async (token) => {
      await createKnowledgeBase(token, {
        ...kbForm,
        source_config: {},
      });
      setMessage("Knowledge base saved.");
      setSelectedKbId(kbForm.kb_id);
      onRefresh();
    });
  }

  async function submitSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedKbIdValue) {
      setMessage("Create or select a knowledge base before adding a source.");
      return;
    }

    await withToken(async (token) => {
      await createKnowledgeSource(token, selectedKbIdValue, sourceForm);
      setMessage("Knowledge source registered.");
      setSourceForm({
        source_type: sourceForm.source_type,
        display_name: "",
        uri: "",
        content_type: "",
        source_config: {},
      });
      onRefresh();
    });
  }

  async function syncSelectedKb() {
    if (!selectedKbIdValue) {
      return;
    }

    await withToken(async (token) => {
      await syncKnowledgeBase(token, selectedKbIdValue);
      setMessage("Knowledge index status refreshed.");
      onRefresh();
    });
  }

  async function testQuery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedKbIdValue || !query.trim()) {
      return;
    }

    await withToken(async (token) => {
      const results = await queryKnowledgeBase(token, selectedKbIdValue, {
        query,
        top_k: 5,
      });
      setQueryResults(results);
      setMessage(results.length ? "Retrieval test complete." : "No retrieval matches returned.");
    });
  }

  return (
    <section className="grid gap-6">
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5" aria-label="Knowledge base metrics">
        <MetricSurface label="Knowledge Bases" value={data.knowledgeBases.length} tone="fuchsia" loading={dataStatus === "loading"} />
        <MetricSurface label="Assigned Agents" value={assignedAgents} tone="emerald" loading={dataStatus === "loading"} />
        <MetricSurface label="Documents" value={documentCount} tone="cyan" loading={dataStatus === "loading"} />
        <MetricSurface label="Chunks" value={chunkCount} tone="sky" loading={dataStatus === "loading"} />
        <MetricSurface label="Degraded" value={degradedCount} tone="amber" loading={dataStatus === "loading"} />
      </section>

      {message ? <div className="rounded-2xl border border-line bg-ink/55 px-4 py-3 text-sm text-textSecondary">{message}</div> : null}

      <div className="grid gap-5 xl:grid-cols-[420px_minmax(0,1fr)]">
        <PlatformSurface tone="fuchsia">
          <div className="flex items-center gap-3">
            <Database className="text-accent" size={20} aria-hidden="true" />
            <h2 className="text-xl font-semibold">Knowledge inventory</h2>
          </div>
          <p className="mt-2 text-sm text-textSecondary">{sourceTypes || "No source types registered yet."}</p>
          <div className="mt-5 grid gap-3">
            {data.knowledgeBases.length ? (
              data.knowledgeBases.map((kb) => {
                const kbId = readText(kb, ["kb_id"]) || "";
                const SourceIcon = sourceIcon(readText(kb, ["source_type"]) || "");

                return (
                  <button
                    key={kbId}
                    type="button"
                    onClick={() => setSelectedKbId(kbId)}
                    className={`rounded-2xl border p-4 text-left transition focus:outline-none focus:ring-2 focus:ring-accent/35 ${
                      selectedKbId === kbId ? "border-accent/60 bg-accent/10" : "border-line bg-white/[0.035] hover:border-accent/35"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-accent/25 bg-accent/10 text-accent">
                        <SourceIcon size={17} aria-hidden="true" />
                      </span>
                      <span className="min-w-0">
                        <span className="block font-semibold text-textPrimary">{readText(kb, ["display_name", "kb_id"])}</span>
                        <span className="mt-1 block text-sm leading-6 text-textSecondary">{readText(kb, ["description"]) || "No description."}</span>
                      </span>
                    </div>
                    <span className="mt-3 block text-xs font-semibold uppercase tracking-[0.12em] text-textSecondary">
                      {joinParts([readText(kb, ["environment"]), sourceTypeLabel(readText(kb, ["source_type"]) || ""), readText(kb, ["status"]) || "draft"])}
                    </span>
                  </button>
                );
              })
            ) : (
              <ComponentRow title="No records" detail="Create the first governed knowledge base." />
            )}
          </div>
        </PlatformSurface>

        <div className="grid gap-5">
          <PlatformSurface tone="sky">
            <h2 className="text-xl font-semibold">Create knowledge base</h2>
            <form className="mt-5 grid gap-3 md:grid-cols-2" onSubmit={submitKnowledgeBase}>
              <input className="field-input" placeholder="kb_id" value={kbForm.kb_id} onChange={(event) => setKbForm({ ...kbForm, kb_id: event.target.value })} />
              <input
                className="field-input"
                placeholder="Display name"
                value={kbForm.display_name}
                onChange={(event) => setKbForm({ ...kbForm, display_name: event.target.value })}
              />
              <input className="field-input" placeholder="Owner" value={kbForm.owner} onChange={(event) => setKbForm({ ...kbForm, owner: event.target.value })} />
              <input className="field-input" placeholder="Domain" value={kbForm.domain} onChange={(event) => setKbForm({ ...kbForm, domain: event.target.value })} />
              <select
                className="field-input"
                value={kbForm.source_type}
                onChange={(event) => setKbForm({ ...kbForm, source_type: event.target.value as SourceType })}
              >
                {sourceTypeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <input
                className="field-input"
                placeholder="Environment"
                value={kbForm.environment}
                onChange={(event) => setKbForm({ ...kbForm, environment: event.target.value })}
              />
              <textarea
                className="field-input min-h-24 resize-y md:col-span-2"
                placeholder="Description"
                value={kbForm.description}
                onChange={(event) => setKbForm({ ...kbForm, description: event.target.value })}
              />
              <button className="inline-flex w-fit items-center gap-2 rounded-full bg-accent px-5 py-3 text-sm font-semibold text-ink transition hover:bg-accent/90" type="submit">
                <UploadCloud size={16} aria-hidden="true" />
                Save KB
              </button>
            </form>
          </PlatformSurface>

          <PlatformSurface tone="emerald">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-xl border border-accent/25 bg-accent/10 text-accent">
                  <SelectedSourceIcon size={18} aria-hidden="true" />
                </span>
                <h2 className="text-xl font-semibold">{selectedKb ? readText(selectedKb, ["display_name", "kb_id"]) : "Select a KB"}</h2>
              </div>
              <button
                className="inline-flex items-center gap-2 rounded-full border border-line px-4 py-2 text-sm font-semibold text-textPrimary transition hover:border-accent/40 hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-50"
                type="button"
                onClick={syncSelectedKb}
                disabled={!selectedKb}
              >
                <RefreshCw size={15} aria-hidden="true" />
                Refresh index
              </button>
            </div>
            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <form className="grid gap-3" onSubmit={submitSource}>
                <select
                  className="field-input"
                  value={sourceForm.source_type}
                  onChange={(event) => setSourceForm({ ...sourceForm, source_type: event.target.value as SourceType })}
                >
                  {sourceTypeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <input
                  className="field-input"
                  placeholder="Source display name"
                  value={sourceForm.display_name}
                  onChange={(event) => setSourceForm({ ...sourceForm, display_name: event.target.value })}
                />
                <input
                  className="field-input"
                  placeholder="URI, path, or vector index name"
                  value={sourceForm.uri || ""}
                  onChange={(event) => setSourceForm({ ...sourceForm, uri: event.target.value })}
                />
                <input
                  className="field-input"
                  placeholder="Content type"
                  value={sourceForm.content_type || ""}
                  onChange={(event) => setSourceForm({ ...sourceForm, content_type: event.target.value })}
                />
                <button className="inline-flex w-fit items-center gap-2 rounded-full bg-accent px-5 py-3 text-sm font-semibold text-ink transition hover:bg-accent/90" type="submit">
                  <UploadCloud size={16} aria-hidden="true" />
                  Add source
                </button>
              </form>
              <div className="grid content-start gap-3">
                {selectedKb ? (
                  <>
                    <ComponentRow
                      title={readText(selectedKb, ["status"]) || "draft"}
                      detail={
                        joinParts([
                          formatCount(numberValue(selectedKb, ["document_count"]), "document"),
                          formatCount(numberValue(selectedKb, ["chunk_count"]), "chunk"),
                        ]) || "No index evidence yet."
                      }
                      meta={readText(selectedKb, ["environment"])}
                    />
                    <ComponentRow
                      title={readText(selectedKb, ["owner"]) || "Unassigned"}
                      detail={joinParts([readText(selectedKb, ["domain"]), readText(selectedKb, ["sensitivity"])]) || "No domain metadata."}
                      meta={sourceTypeLabel(readText(selectedKb, ["source_type"]) || "")}
                    />
                  </>
                ) : (
                  <ComponentRow title="No KB selected" detail="Select or create a KB to manage sources." />
                )}
              </div>
            </div>
          </PlatformSurface>

          <PlatformSurface tone="cyan">
            <div className="flex items-center gap-3">
              <Search className="text-accent" size={20} aria-hidden="true" />
              <h2 className="text-xl font-semibold">Test retrieval</h2>
            </div>
            <form className="mt-5 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]" onSubmit={testQuery}>
              <input className="field-input" placeholder="Ask this knowledge base a question" value={query} onChange={(event) => setQuery(event.target.value)} />
              <button
                className="rounded-full bg-accent px-5 py-3 text-sm font-semibold text-ink transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
                type="submit"
                disabled={!selectedKb || !query.trim()}
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
                    meta={readText(result, ["score"])}
                  />
                ))
              ) : (
                <ComponentRow title="No query results" detail="Run a retrieval test to inspect snippets, scores, and metadata." />
              )}
            </div>
          </PlatformSurface>
        </div>
      </div>
    </section>
  );
}
