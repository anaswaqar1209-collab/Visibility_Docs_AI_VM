"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
    FileText, Upload, Trash2, RefreshCw, Eye, Search, FolderUp, Copy, X, Loader2, Info, Filter, Share2,
} from "lucide-react";
import ClientLayout from "@/components/ClientLayout";
import FilterSelect from "@/components/FilterSelect";
import ClassifyAgentPopup from "@/components/ClassifyAgentPopup";
import LibraryPagination from "@/components/LibraryPagination";
import ShareModal from "@/components/ShareModal";
import { PageHeader, EmptyState } from "@/components/ui";
import { useTheme } from "@/context/ColorContext";
import { apiRequest } from "@/lib/apiClient";
import { AGENT_FILTER_OPTIONS, AGENT_OPTIONS, agentLabel, resolveDocAgent } from "@/lib/documentAgents";
import {
    ACCEPT_ATTR,
    filterAllowedFiles,
    getFileTypeLabel,
} from "@/lib/fileValidation";
import { usePermissions } from "@/context/PermissionsContext";
import { getStoredUser } from "@/lib/authSession";

type DocItem = {
    documentId: string;
    originalFilename: string;
    mimeType: string;
    sizeBytes: number;
    status: string;
    classification?: string | null;
    visibilityScope?: "personal" | "department" | null;
    departmentId?: string | null;
    uploaderIsLeader?: boolean;
    uploadedBy?: string;
    createdAt: string;
    duplicateCount?: number;
    isDuplicate?: boolean;
    pythonDocumentId?: string | null;
    aiProcessingStatus?: string | null;
    aiErrorMessage?: string | null;
    metadata?: { phase3Agent?: string; cvScore?: number } | null;
};

type Pagination = { page: number; limit: number; total: number; totalPages: number };

type PendingFile = { id: string; file: File };

type QueueItemStatus = "queued" | "uploading" | "processing" | "done" | "error";

type QueueItem = {
    id: string;
    name: string;
    size: number;
    mimeType: string;
    status: QueueItemStatus;
    error?: string;
    documentId?: string;
};

const SORT_PRESETS = [
    { value: "newest", label: "Newest first", sortBy: "createdAt", sortOrder: "desc" },
    { value: "oldest", label: "Oldest first", sortBy: "createdAt", sortOrder: "asc" },
    { value: "score_high", label: "Score: high → low", sortBy: "score", sortOrder: "desc" },
    { value: "score_low", label: "Score: low → high", sortBy: "score", sortOrder: "asc" },
    { value: "name", label: "Name A–Z", sortBy: "name", sortOrder: "asc" },
] as const;

const SCORE_FILTER_OPTIONS = [
    { value: "", label: "All scores" },
    { value: "high", label: "High (70+)" },
    { value: "medium", label: "Medium (40–69)" },
    { value: "low", label: "Low (<40)" },
    { value: "scored", label: "Scored only" },
];

function formatBytes(n: number) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function statusBadge(status: string) {
    const s = status.toLowerCase();
    if (s === "ready" || s === "processed" || s === "completed" || s === "complete" || s === "done") {
        return "bg-[var(--success-muted)] text-[var(--success)] border-[rgba(52,211,153,0.25)]";
    }
    if (s === "processing" || s === "uploaded" || s === "queued" || s === "uploading") {
        return "bg-[var(--warning-muted)] text-[var(--warning)] border-[rgba(251,191,36,0.25)]";
    }
    if (s === "failed" || s.includes("fail") || s.includes("error")) {
        return "bg-[var(--error-muted)] text-[var(--error)] border-[rgba(248,113,113,0.25)]";
    }
    return "bg-[var(--surface-3)] text-[var(--foreground-muted)] border-[var(--border)]";
}

const IN_PROGRESS_AI = ["queued", "running", "processing", "ocr", "classify", "extract", "embed", "uploaded", "pending"];

function getDisplayStatus(doc: DocItem): { label: string; isProcessing: boolean; subtitle?: string; isComplete: boolean } {
    if (doc.status === "failed" || (doc.aiErrorMessage && !doc.pythonDocumentId)) {
        return { label: "Failed", isProcessing: false, isComplete: false };
    }
    if (doc.status === "ready") {
        return { label: "Complete", isProcessing: false, isComplete: true };
    }
    const ai = (doc.aiProcessingStatus || "").toLowerCase();
    if (ai.includes("fail")) {
        return { label: "Failed", isProcessing: false, subtitle: doc.aiProcessingStatus || undefined, isComplete: false };
    }
    if (doc.status === "processing" || doc.status === "uploaded") {
        const inProgress = !ai || IN_PROGRESS_AI.some((s) => ai.includes(s));
        if (inProgress) {
            return {
                label: "Processing",
                isProcessing: true,
                subtitle: doc.aiProcessingStatus && doc.aiProcessingStatus !== "processing" ? doc.aiProcessingStatus : undefined,
                isComplete: false,
            };
        }
    }
    if (doc.status === "uploaded") {
        return { label: "Uploaded", isProcessing: false, isComplete: false };
    }
    return { label: doc.status, isProcessing: doc.status === "processing", isComplete: false };
}

type ClassifyQueueItem = {
    documentId: string;
    originalFilename: string;
    document_type?: string;
    classification?: string | null;
};

function DocumentsContent() {
    const { theme } = useTheme();
    const colors = theme.colors;
    const isDark = theme.name === "dark";
    const containerRef = useRef<HTMLDivElement>(null);
    const { canUpload, canViewDocs, canDeleteDocs } = usePermissions();
    const me = getStoredUser<{ userId?: string }>();

    const [docs, setDocs] = useState<DocItem[]>([]);
    const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 10, total: 0, totalPages: 0 });
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [dragOver, setDragOver] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
    const [queueItems, setQueueItems] = useState<QueueItem[]>([]);

    const [q, setQ] = useState("");
    const [searchInput, setSearchInput] = useState("");
    const [sortPreset, setSortPreset] = useState<string>("newest");
    const [scoreFilter, setScoreFilter] = useState("");
    const [scopeFilter, setScopeFilter] = useState("");
    const [typeFilter, setTypeFilter] = useState("");
    const [page, setPage] = useState(1);
    const [pageLimit, setPageLimit] = useState(10);
    const [agentFilter, setAgentFilter] = useState("");
    const [preferredAgent, setPreferredAgent] = useState("");
    const [classifyQueue, setClassifyQueue] = useState<ClassifyQueueItem[]>([]);
    const [toast, setToast] = useState<string | null>(null);
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [sharingDoc, setSharingDoc] = useState<{ documentId: string; filename: string } | null>(null);

    const activeSort = SORT_PRESETS.find((s) => s.value === sortPreset) || SORT_PRESETS[0];

    const applySearch = () => {
        setQ(searchInput);
        setPage(1);
    };

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams({
                page: String(page),
                limit: String(pageLimit),
                sortBy: activeSort.sortBy,
                sortOrder: activeSort.sortOrder,
            });
            if (q) params.set("q", q);
            if (scoreFilter) params.set("scoreFilter", scoreFilter);
            if (scopeFilter) params.set("scope", scopeFilter);
            if (typeFilter) params.set("classification", typeFilter);
            const data = await apiRequest(`/docs/documents?${params}`);
            setDocs(data?.data?.documents || []);
            setPagination(data?.data?.pagination || { page: 1, limit: 10, total: 0, totalPages: 0 });
        } catch (e: any) {
            setError(e.message || "Failed to load documents");
        } finally {
            setLoading(false);
        }
    }, [page, pageLimit, q, activeSort.sortBy, activeSort.sortOrder, scoreFilter, scopeFilter, typeFilter]);

    useEffect(() => { load(); }, [load]);

    useEffect(() => {
        if (!toast) return;
        const t = setTimeout(() => setToast(null), 4000);
        return () => clearTimeout(t);
    }, [toast]);

    const queueClassifyPopup = async (documentId: string) => {
        try {
            const data = await apiRequest(`/docs/documents/${documentId}/intelligence`);
            const doc = data?.data?.document;
            const ai = data?.data?.aiDocument;
            const docType = ai?.document_type || doc?.classification;
            if (!docType) return;
            setClassifyQueue((prev) => {
                if (prev.some((p) => p.documentId === documentId)) return prev;
                return [
                    ...prev,
                    {
                        documentId,
                        originalFilename: doc?.originalFilename || "Document",
                        document_type: String(docType),
                        classification: doc?.classification,
                    },
                ];
            });
        } catch {
            /* ignore */
        }
    };

    const handleAgentConfirm = async (documentId: string, documentType: string, phase3Agent: string) => {
        try {
            await apiRequest(`/docs/documents/${documentId}/ai-settings`, {
                method: "PATCH",
                body: JSON.stringify({ documentType, phase3Agent }),
            });
            setClassifyQueue((prev) => prev.filter((p) => p.documentId !== documentId));
            setToast(`Agent set to ${agentLabel(phase3Agent)}`);
            await load();
        } catch (e: any) {
            setError(e.message || "Failed to save agent");
        }
    };

    const filteredDocs = agentFilter
        ? docs.filter((d) => resolveDocAgent(d) === agentFilter)
        : docs;

    const processingDocIds = docs
        .filter((d) => d.status === "processing" || d.status === "uploaded")
        .map((d) => d.documentId);

    useEffect(() => {
        if (!processingDocIds.length) return;
        const interval = setInterval(async () => {
            let changed = false;
            const updates: Record<string, Partial<DocItem>> = {};
            await Promise.all(
                processingDocIds.map(async (id) => {
                    try {
                        const data = await apiRequest(`/docs/documents/${id}/processing`);
                        const proc = data?.data;
                        if (proc) {
                            updates[id] = {
                                status: proc.status,
                                aiProcessingStatus: proc.aiProcessingStatus,
                            };
                            changed = true;
                        }
                    } catch {
                        /* ignore poll errors */
                    }
                })
            );
            if (changed) {
                setDocs((prev) =>
                    prev.map((d) => (updates[d.documentId] ? { ...d, ...updates[d.documentId] } : d))
                );
            }
        }, 3000);
        return () => clearInterval(interval);
    }, [processingDocIds.join(",")]);

    const pollUntilTerminal = async (documentId: string): Promise<"done" | "error"> => {
        const maxAttempts = 120;
        for (let i = 0; i < maxAttempts; i++) {
            try {
                const data = await apiRequest(`/docs/documents/${documentId}/processing`);
                const status = data?.data?.status;
                if (status === "ready") return "done";
                if (status === "failed") return "error";
            } catch {
                /* retry */
            }
            await new Promise((r) => setTimeout(r, 3000));
        }
        return "error";
    };

    const addFilesToQueue = (fileList: FileList | File[]) => {
        const { allowed, rejected } = filterAllowedFiles(fileList);
        if (rejected.length) {
            setError(`Rejected unsupported files: ${rejected.join(", ")}`);
        }
        if (!allowed.length) return;
        const newItems: PendingFile[] = allowed.map((file) => ({
            id: `pf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            file,
        }));
        setPendingFiles((prev) => [...prev, ...newItems]);
    };

    useEffect(() => {
        const onPaste = (e: ClipboardEvent) => {
            const files = e.clipboardData?.files;
            if (!files?.length) return;
            e.preventDefault();
            addFilesToQueue(files);
        };
        const el = containerRef.current;
        el?.addEventListener("paste", onPaste as any);
        return () => el?.removeEventListener("paste", onPaste as any);
    });

    const removeFromQueue = (id: string) => {
        setPendingFiles((prev) => prev.filter((p) => p.id !== id));
    };

    const clearQueue = () => setPendingFiles([]);

    const uploadQueue = async () => {
        if (!pendingFiles.length || uploading) return;
        setUploading(true);
        setError(null);

        const filesToUpload = [...pendingFiles];
        const items: QueueItem[] = filesToUpload.map((p) => ({
            id: p.id,
            name: p.file.name,
            size: p.file.size,
            mimeType: p.file.type,
            status: "queued",
        }));
        setQueueItems(items);
        setPendingFiles([]);

        const processingIds: string[] = [];

        for (let i = 0; i < filesToUpload.length; i++) {
            const pf = filesToUpload[i];
            setQueueItems((prev) =>
                prev.map((q) => (q.id === pf.id ? { ...q, status: "uploading" } : q))
            );
            try {
                const form = new FormData();
                form.append("file", pf.file);
                if (preferredAgent) form.append("phase3Agent", preferredAgent);
                const data = await apiRequest("/docs/documents", { method: "POST", body: form });
                const doc = data?.data?.document;
                const aiMsg = data?.data?.aiModelResponse?.message;
                const failed = doc?.status === "failed" || !!doc?.aiErrorMessage;
                if (doc?.documentId && !failed) {
                    processingIds.push(doc.documentId);
                }
                setQueueItems((prev) =>
                    prev.map((q) =>
                        q.id === pf.id
                            ? {
                                  ...q,
                                  status: failed ? "error" : "processing",
                                  documentId: doc?.documentId,
                                  error: doc?.aiErrorMessage || (failed ? "Upload to model failed" : undefined),
                              }
                            : q
                    )
                );
                if (!failed && aiMsg) {
                    setQueueItems((prev) =>
                        prev.map((q) =>
                            q.id === pf.id ? { ...q, error: undefined } : q
                        )
                    );
                }
            } catch (e: any) {
                setQueueItems((prev) =>
                    prev.map((q) =>
                        q.id === pf.id ? { ...q, status: "error", error: e.message } : q
                    )
                );
            }
        }

        if (processingIds.length) {
            await Promise.all(
                processingIds.map(async (docId) => {
                    const result = await pollUntilTerminal(docId);
                    setQueueItems((prev) =>
                        prev.map((q) =>
                            q.documentId === docId
                                ? { ...q, status: result === "done" ? "done" : "error" }
                                : q
                        )
                    );
                    if (result === "done") {
                        await queueClassifyPopup(docId);
                    }
                })
            );
        }

        await load();
        setUploading(false);
        setTimeout(() => setQueueItems([]), 8000);
    };

    const onDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files?.length) addFilesToQueue(e.dataTransfer.files);
    };

    const remove = async (id: string, name: string) => {
        if (!confirm(`Delete "${name}" and its folder permanently?`)) return;
        try {
            await apiRequest(`/docs/documents/${id}`, { method: "DELETE" });
            await load();
        } catch (e: any) {
            setError(e.message || "Delete failed");
        }
    };

    const allowUpload = canUpload();
    const allowView = canViewDocs();
    const allowDelete = canDeleteDocs();
    const showStaging = pendingFiles.length > 0 || queueItems.length > 0;
    const hasActiveFilters = Boolean(scoreFilter || agentFilter || scopeFilter || typeFilter || sortPreset !== "newest");

    return (
        <div ref={containerRef} tabIndex={0} className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-6xl mx-auto outline-none animate-fade-in-up">
            <PageHeader
                title="Documents"
                subtitle={
                    allowUpload
                        ? "Add files to queue, review, then upload. Files go to server then AI model automatically."
                        : "Browse documents available to your account."
                }
                // actions={
                //     allowView ? (
                //         <Link
                //             href="/documents/details"
                //             className="text-sm font-medium text-[var(--accent)] hover:underline underline-offset-4"
                //         >
                //             View all file details →
                //         </Link>
                //     ) : undefined
                // }
            />

            {!allowUpload && !allowView && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-200 px-4 py-3 text-sm">
                    You do not have permission to view or upload documents. Ask your admin to update your permissions.
                </div>
            )}

            {allowUpload && (
            <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                className={`surface-card p-8 border-2 border-dashed transition-all ${dragOver ? "border-[var(--accent)] bg-[var(--accent-muted)]" : "border-[var(--border-strong)]"}`}
            >
                <div className="flex flex-col items-center text-center gap-3">
                    <div className="h-14 w-14 rounded-2xl flex items-center justify-center bg-[var(--accent-muted)] text-[var(--accent)] border border-[rgba(45,212,191,0.25)]">
                        <Upload size={24} />
                    </div>
                    <p className={`font-semibold ${colors.textPrimary}`}>
                        {uploading ? "Uploading…" : "Drag & drop files or folder"}
                    </p>
                    <p className={`text-sm ${colors.textMuted}`}>
                        PDF, images, DOCX, XLSX, PPTX — max 50 MB each · paste with Ctrl+V
                    </p>
                    <div className="flex flex-wrap gap-2 justify-center">
                        <label className="btn-gradient rounded-xl px-5 py-2.5 text-sm cursor-pointer inline-flex items-center gap-2">
                            <Upload size={14} /> Browse files
                            <input
                                type="file"
                                className="hidden"
                                accept={ACCEPT_ATTR}
                                multiple
                                disabled={uploading}
                                onChange={(e) => {
                                    if (e.target.files?.length) addFilesToQueue(e.target.files);
                                    e.target.value = "";
                                }}
                            />
                        </label>
                        <label className="btn-secondary rounded-xl px-5 py-2.5 text-sm cursor-pointer inline-flex items-center gap-2">
                            <FolderUp size={14} /> Upload folder
                            <input
                                type="file"
                                className="hidden"
                                accept={ACCEPT_ATTR}
                                multiple
                                {...({ webkitdirectory: "", directory: "" } as any)}
                                disabled={uploading}
                                onChange={(e) => {
                                    if (e.target.files?.length) addFilesToQueue(e.target.files);
                                    e.target.value = "";
                                }}
                            />
                        </label>
                    </div>
                </div>
            </div>
            )}

            {toast && (
                <div className="rounded-xl border border-green-500/30 bg-green-500/10 text-green-200 px-4 py-3 text-sm">
                    {toast}
                </div>
            )}

            {allowUpload && classifyQueue.length > 0 && (
                <ClassifyAgentPopup
                    doc={classifyQueue[0]}
                    queueLen={classifyQueue.length}
                    defaultAgent={preferredAgent || undefined}
                    onConfirm={handleAgentConfirm}
                    onDismiss={() => setClassifyQueue((prev) => prev.slice(1))}
                />
            )}

            {allowUpload && showStaging && (
                <div className="surface-card overflow-visible">
                    <div className={`px-5 py-4 border-b ${colors.borderPrimary} flex flex-wrap items-center justify-between gap-3`}>
                        <div>
                            <h2 className={`text-sm font-semibold ${colors.textPrimary}`}>
                                {uploading ? "Uploading queue" : `Ready to upload (${pendingFiles.length})`}
                            </h2>
                            <p className={`text-xs mt-0.5 ${colors.textMuted}`}>
                                Review files, pick extraction agent, then click Upload
                            </p>
                        </div>
                        <div className="flex gap-2">
                            {!uploading && pendingFiles.length > 0 && (
                                <button type="button" onClick={clearQueue} className="btn-ghost rounded-xl px-3 py-2 text-sm">
                                    Clear all
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={uploadQueue}
                                disabled={uploading || pendingFiles.length === 0}
                                className="btn-gradient rounded-xl px-5 py-2.5 text-sm inline-flex items-center gap-2 disabled:opacity-50"
                            >
                                {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                                Upload {pendingFiles.length || queueItems.length} file(s)
                            </button>
                        </div>
                    </div>
                    {!uploading && pendingFiles.length > 0 && (
                        <div className={`px-5 py-3 border-b ${colors.borderPrimary} bg-white/[0.02]`}>
                            <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block mb-1">
                                Extraction agent (optional)
                            </label>
                            <select
                                value={preferredAgent}
                                onChange={(e) => setPreferredAgent(e.target.value)}
                                className="premium-input rounded-xl py-2.5 px-3 text-sm w-full sm:min-w-[240px]"
                            >
                                {AGENT_OPTIONS.map((o) => (
                                    <option key={o.value || "auto"} value={o.value}>{o.label}</option>
                                ))}
                            </select>
                        </div>
                    )}
                    <ul className="divide-y divide-[var(--border)]">
                        {(queueItems.length ? queueItems : pendingFiles.map((p) => ({
                            id: p.id,
                            name: p.file.name,
                            size: p.file.size,
                            mimeType: p.file.type,
                            status: "queued" as QueueItemStatus,
                            error: undefined as string | undefined,
                        }))).map((item) => (
                            <li key={item.id} className={`px-5 py-3 flex flex-wrap items-center justify-between gap-3 ${colors.bgHover}`}>
                                <div className="min-w-0 flex-1">
                                    <p className={`font-medium truncate text-sm ${colors.textPrimary}`}>{item.name}</p>
                                    <p className={`text-xs mt-0.5 ${colors.textMuted}`}>
                                        {formatBytes(item.size)}
                                        {"mimeType" in item && item.mimeType && (
                                            <span className="ml-2">{getFileTypeLabel(item.mimeType, item.name)}</span>
                                        )}
                                    </p>
                                </div>
                                <div className="flex items-center gap-2">
                                    {"status" in item && item.status !== "queued" && (
                                        <span className={`text-xs px-2 py-0.5 rounded-full border ${statusBadge(item.status)}`}>
                                            {item.status}
                                            {item.error ? `: ${item.error}` : ""}
                                        </span>
                                    )}
                                    {!uploading && pendingFiles.some((p) => p.id === item.id) && (
                                        <button
                                            type="button"
                                            onClick={() => removeFromQueue(item.id)}
                                            className="btn-ghost rounded-lg p-2 text-red-300"
                                            aria-label="Remove from queue"
                                        >
                                            <X size={14} />
                                        </button>
                                    )}
                                </div>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 text-red-300 px-4 py-3 text-sm">{error}</div>}

            {allowView && (
            <div className="surface-card">
                <div className={`px-5 py-4 border-b ${colors.borderPrimary} flex flex-wrap items-center justify-between gap-3`}>
                    <div className="flex items-center gap-2">
                        <div className="h-8 w-8 rounded-lg bg-[var(--accent-muted)] text-[var(--accent)] flex items-center justify-center">
                            <FileText size={15} />
                        </div>
                        <h2 className={`text-sm font-semibold ${colors.textPrimary}`}>Library</h2>
                        <span className={`text-xs font-mono ${colors.textMuted}`}>({pagination.total})</span>
                    </div>
                    <button type="button" onClick={load} className="btn-secondary rounded-xl px-3 py-2 text-sm flex items-center gap-2">
                        <RefreshCw size={14} /> Refresh
                    </button>
                </div>

                <div className={`px-5 py-4 border-b ${colors.borderPrimary} relative z-20`}>
                    <div className="flex flex-col gap-3">
                        <div className="flex flex-col sm:flex-row gap-2 sm:items-stretch">
                            <div className="relative flex-1 min-w-0">
                                <Search size={16} className={`absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none ${colors.textMuted}`} />
                                <input
                                    value={searchInput}
                                    onChange={(e) => setSearchInput(e.target.value)}
                                    onKeyDown={(e) => e.key === "Enter" && applySearch()}
                                    placeholder="Search by filename…"
                                    className="w-full premium-input rounded-xl py-2.5 pl-10 pr-4 text-sm h-[44px]"
                                />
                            </div>
                            <button
                                type="button"
                                onClick={applySearch}
                                className="btn-gradient rounded-xl px-5 text-sm font-medium h-[44px] shrink-0 sm:w-auto w-full"
                            >
                                Search
                            </button>
                            <button
                                type="button"
                                onClick={() => setFiltersOpen((v) => !v)}
                                className={`rounded-xl px-4 text-sm font-medium h-[44px] shrink-0 inline-flex items-center justify-center gap-2 border transition-colors ${
                                    filtersOpen || hasActiveFilters
                                        ? "bg-[var(--accent-muted)] border-[rgba(45,212,191,0.35)] text-[var(--accent)]"
                                        : "btn-secondary"
                                }`}
                                aria-expanded={filtersOpen}
                            >
                                <Filter size={15} />
                                Filters
                                {hasActiveFilters && (
                                    <span className="h-5 min-w-5 px-1 rounded-full bg-[var(--accent)] text-[#042f2e] text-[10px] font-bold flex items-center justify-center">
                                        {[scoreFilter, agentFilter, scopeFilter, typeFilter, sortPreset !== "newest"].filter(Boolean).length}
                                    </span>
                                )}
                            </button>
                        </div>
                        {filtersOpen && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 pt-1 animate-fade-in-up">
                                <FilterSelect
                                    label="Scope"
                                    value={scopeFilter}
                                    onChange={(v) => { setScopeFilter(v); setPage(1); }}
                                    options={[
                                        { value: "", label: "All scopes" },
                                        { value: "department", label: "Department" },
                                        { value: "personal", label: "Personal" },
                                    ]}
                                    minWidth="w-full"
                                />
                                <FilterSelect
                                    label="Doc type"
                                    value={typeFilter}
                                    onChange={(v) => { setTypeFilter(v); setPage(1); }}
                                    options={[
                                        { value: "", label: "All types" },
                                        { value: "resume", label: "Resume / CV" },
                                        { value: "invoice", label: "Invoice" },
                                        { value: "purchase_order", label: "Purchase order" },
                                        { value: "contract", label: "Contract" },
                                        { value: "quotation", label: "Quotation" },
                                        { value: "hr_document", label: "HR document" },
                                        { value: "other", label: "Other" },
                                    ]}
                                    minWidth="w-full"
                                />
                                <FilterSelect
                                    label="Score"
                                    value={scoreFilter}
                                    onChange={(v) => { setScoreFilter(v); setPage(1); }}
                                    options={SCORE_FILTER_OPTIONS}
                                    minWidth="w-full"
                                />
                                <FilterSelect
                                    label="Sort"
                                    value={sortPreset}
                                    onChange={(v) => { setSortPreset(v); setPage(1); }}
                                    options={SORT_PRESETS.map((s) => ({ value: s.value, label: s.label }))}
                                    minWidth="w-full"
                                />
                                <FilterSelect
                                    label="Agent"
                                    value={agentFilter}
                                    onChange={(v) => { setAgentFilter(v); setPage(1); }}
                                    options={AGENT_FILTER_OPTIONS}
                                    minWidth="w-full"
                                />
                            </div>
                        )}
                    </div>
                    {(scoreFilter || agentFilter || scopeFilter || typeFilter || sortPreset !== "newest" || q) && (
                        <div className="flex flex-wrap items-center gap-2 mt-3">
                            {q && (
                                <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-slate-300">
                                    “{q}”
                                    <button type="button" onClick={() => { setSearchInput(""); setQ(""); setPage(1); }} className="hover:text-white" aria-label="Clear search">
                                        <X size={11} />
                                    </button>
                                </span>
                            )}
                            {scoreFilter && (
                                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] text-emerald-300">
                                    {SCORE_FILTER_OPTIONS.find((o) => o.value === scoreFilter)?.label}
                                    <button type="button" onClick={() => { setScoreFilter(""); setPage(1); }} className="hover:text-white" aria-label="Clear score">
                                        <X size={11} />
                                    </button>
                                </span>
                            )}
                            {agentFilter && (
                                <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-1 text-[11px] text-cyan-300">
                                    {agentLabel(agentFilter)}
                                    <button type="button" onClick={() => { setAgentFilter(""); setPage(1); }} className="hover:text-white" aria-label="Clear agent">
                                        <X size={11} />
                                    </button>
                                </span>
                            )}
                            <button
                                type="button"
                                onClick={() => {
                                    setSearchInput("");
                                    setQ("");
                                    setScoreFilter("");
                                    setScopeFilter("");
                                    setTypeFilter("");
                                    setAgentFilter("");
                                    setSortPreset("newest");
                                    setPage(1);
                                }}
                                className={`text-[11px] ${colors.textMuted} hover:text-[var(--accent)] underline-offset-2 hover:underline`}
                            >
                                Clear filters
                            </button>
                        </div>
                    )}
                </div>

                <div className="rounded-b-2xl">
                {loading ? (
                    <div className={`p-8 text-sm ${colors.textMuted}`}>Loading…</div>
                ) : filteredDocs.length === 0 ? (
                    <EmptyState
                        icon={<FileText size={22} />}
                        title="No documents found"
                        description="Upload files above or adjust your filters to see documents here."
                    />
                ) : (
                    <ul className="divide-y divide-[var(--border)]">
                        {filteredDocs.map((doc) => {
                            const { label: displayStatus, isProcessing, isComplete } = getDisplayStatus(doc);
                            const rowWarnClass = !isComplete ? 'border-l-4 border-red-500/20' : '';
                            return (
                            <li key={doc.documentId} className={`px-4 sm:px-5 py-4 flex flex-col sm:flex-row sm:flex-wrap sm:items-center justify-between gap-3 ${colors.bgHover} ${rowWarnClass}`}>
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <p className={`font-medium truncate min-w-0 ${colors.textPrimary}`}>{doc.originalFilename}</p>
                                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase border ${statusBadge(displayStatus)}`}>
                                            {isProcessing && <Loader2 size={10} className="animate-spin" />}
                                            {displayStatus}
                                        </span>
                                        {doc.isDuplicate && (
                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase bg-amber-500/15 text-amber-300 border border-amber-500/25">
                                                <Copy size={10} /> Duplicate ×{doc.duplicateCount}
                                            </span>
                                        )}
                                        {doc.visibilityScope === "department" && (
                                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase bg-[var(--accent-muted)] text-[var(--accent)] border border-[rgba(45,212,191,0.25)]">
                                                Department
                                            </span>
                                        )}
                                        {doc.visibilityScope === "personal" && (
                                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase bg-white/5 text-[var(--foreground-muted)] border border-[var(--border)]">
                                                Personal
                                            </span>
                                        )}
                                        {doc.uploaderIsLeader && (
                                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase bg-amber-500/15 text-amber-300 border border-amber-500/25">
                                                Leader
                                            </span>
                                        )}
                                    </div>
                                    <p className={`text-xs mt-1 ${colors.textMuted}`}>
                                        <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase mr-2 bg-[var(--accent-muted)] text-[var(--accent)] border border-[rgba(45,212,191,0.2)]`}>
                                            {getFileTypeLabel(doc.mimeType, doc.originalFilename)}
                                        </span>
                                        {formatBytes(doc.sizeBytes)} · {new Date(doc.createdAt).toLocaleString()}
                                        {doc.classification && ` · ${doc.classification}`}
                                        {doc.metadata?.phase3Agent && ` · ${agentLabel(doc.metadata.phase3Agent)}`}
                                            {/* Score moved to status position; no duplicate here */}
                                    </p>
                                    {doc.aiErrorMessage && (
                                        <p className="text-xs text-red-400 mt-1">{doc.aiErrorMessage}</p>
                                    )}
                                </div>
                                <div className="flex gap-2 flex-wrap w-full sm:w-auto">
                                    {allowView && (
                                        <Link href={`/documents/details?doc=${doc.documentId}`} className="btn-secondary rounded-lg px-3 py-2 text-sm flex items-center justify-center gap-1.5 flex-1 sm:flex-initial min-h-10">
                                            <Info size={14} /> Details
                                        </Link>
                                    )}
                                    {allowView && (
                                        <Link href={`/documents/${doc.documentId}`} className="btn-secondary rounded-lg px-3 py-2 text-sm flex items-center justify-center gap-1.5 flex-1 sm:flex-initial min-h-10">
                                            <Eye size={14} /> Preview
                                        </Link>
                                    )}
                                    {allowDelete && (
                                        <button type="button" onClick={() => remove(doc.documentId, doc.originalFilename)}
                                            className="btn-ghost rounded-lg px-3 py-2 text-sm flex items-center justify-center gap-1.5 text-red-300 min-h-10">
                                            <Trash2 size={14} /> Delete
                                        </button>
                                    )}
                                    {allowView && doc.uploadedBy === me?.userId && (
                                        <button type="button" onClick={() => setSharingDoc({ documentId: doc.documentId, filename: doc.originalFilename })}
                                            className="btn-secondary rounded-lg px-3 py-2 text-sm flex items-center justify-center gap-1.5 min-h-10">
                                            <Share2 size={14} /> Share
                                        </button>
                                    )}
                                </div>
                            </li>
                        );})}
                    </ul>
                )}
                </div>

                <LibraryPagination
                    page={pagination.page}
                    limit={pagination.limit}
                    total={pagination.total}
                    totalPages={pagination.totalPages}
                    onPageChange={setPage}
                    onLimitChange={(limit) => { setPageLimit(limit); setPage(1); }}
                    borderClass={colors.borderPrimary}
                    textMutedClass={colors.textMuted}
                />
            </div>
            )}

            {/* Share Modal */}
            {sharingDoc && (
                <ShareModal
                    documentId={sharingDoc.documentId}
                    filename={sharingDoc.filename}
                    open={true}
                    onClose={() => setSharingDoc(null)}
                    onShared={() => load()}
                />
            )}
        </div>
    );
}

export default function DocumentsPage() {
    return (
        <ClientLayout>
            <DocumentsContent />
        </ClientLayout>
    );
}
