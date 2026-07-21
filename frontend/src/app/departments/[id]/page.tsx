"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { FileText, Loader2, RefreshCw, Search, Filter, X, Info, Eye, Trash2, Share2 } from "lucide-react";
import ClientLayout from "@/components/ClientLayout";
import FilterSelect from "@/components/FilterSelect";
import LibraryPagination from "@/components/LibraryPagination";
import ShareModal from "@/components/ShareModal";
import { PageHeader, EmptyState, Badge, Button } from "@/components/ui";
import { useTheme } from "@/context/ColorContext";
import { usePermissions } from "@/context/PermissionsContext";
import { apiRequest } from "@/lib/apiClient";
import { getStoredUser } from "@/lib/authSession";
import { AGENT_FILTER_OPTIONS, agentLabel, resolveDocAgent } from "@/lib/documentAgents";
import { getFileTypeLabel } from "@/lib/fileValidation";

type Overview = {
    department: {
        departmentId: string;
        name: string;
        description?: string;
        allowedDocumentTypes?: string[];
    };
    members: Array<{
        userId: string;
        user?: { fullName?: string; email?: string } | null;
        role?: { name: string; isLeader: boolean } | null;
    }>;
    leaders: Array<{ user?: { fullName?: string } | null; role?: { name: string } | null }>;
};

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
    createdAt: string;
    duplicateCount?: number;
    isDuplicate?: boolean;
    pythonDocumentId?: string | null;
    aiProcessingStatus?: string | null;
    aiErrorMessage?: string | null;
    metadata?: { phase3Agent?: string; cvScore?: number } | null;
    sharedToDepartment?: boolean;
};

type Pagination = { page: number; limit: number; total: number; totalPages: number };

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

function getDisplayStatus(doc: DocItem): { label: string; isProcessing: boolean; isComplete: boolean } {
    if (doc.status === "failed" || (doc.aiErrorMessage && !doc.pythonDocumentId)) {
        return { label: "Failed", isProcessing: false, isComplete: false };
    }
    if (doc.status === "ready") {
        return { label: "Complete", isProcessing: false, isComplete: true };
    }
    const ai = (doc.aiProcessingStatus || "").toLowerCase();
    if (ai.includes("fail")) {
        return { label: "Failed", isProcessing: false, isComplete: false };
    }
    if (doc.status === "processing" || doc.status === "uploaded") {
        const inProgress = !ai || IN_PROGRESS_AI.some((s) => ai.includes(s));
        if (inProgress) {
            return { label: "Processing", isProcessing: true, isComplete: false };
        }
    }
    if (doc.status === "uploaded") {
        return { label: "Uploaded", isProcessing: false, isComplete: false };
    }
    return { label: doc.status, isProcessing: false, isComplete: false };
}

function DepartmentOverviewContent() {
    const params = useParams();
    const departmentId = String(params?.id || "");
    const { theme } = useTheme();
    const colors = theme.colors;
    const { canViewDocs, canDeleteDocs, canShareDocs } = usePermissions();
    const me = getStoredUser<{ userId?: string; orgRole?: { isLeader?: boolean } }>();

    const [overview, setOverview] = useState<Overview | null>(null);
    const [docs, setDocs] = useState<DocItem[]>([]);
    const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 10, total: 0, totalPages: 0 });
    const [loadingOverview, setLoadingOverview] = useState(true);
    const [loadingDocs, setLoadingDocs] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [searchInput, setSearchInput] = useState("");
    const [q, setQ] = useState("");
    const [sortPreset, setSortPreset] = useState<string>("newest");
    const [scoreFilter, setScoreFilter] = useState("");
    const [scopeFilter, setScopeFilter] = useState("");
    const [uploadedByFilter, setUploadedByFilter] = useState("");
    const [typeFilter, setTypeFilter] = useState("");
    const [agentFilter, setAgentFilter] = useState("");
    const [page, setPage] = useState(1);
    const [pageLimit, setPageLimit] = useState(10);
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [sharingDoc, setSharingDoc] = useState<{ documentId: string; filename: string } | null>(null);

    const activeSort = SORT_PRESETS.find((s) => s.value === sortPreset) || SORT_PRESETS[0];
    const hasActiveFilters = Boolean(scoreFilter || agentFilter || scopeFilter || typeFilter || sortPreset !== "newest");

    const loadOverview = useCallback(async () => {
        if (!departmentId) return;
        setLoadingOverview(true);
        try {
            const res = await apiRequest(`/docs/departments/${departmentId}/overview`);
            setOverview(res?.data || null);
        } catch (e: any) {
            setError(e.message || "Failed to load department overview");
            setOverview(null);
        } finally {
            setLoadingOverview(false);
        }
    }, [departmentId]);

    const loadDocs = useCallback(async () => {
        if (!departmentId) return;
        setLoadingDocs(true);
        setError(null);
        try {
            const params = new URLSearchParams({
                page: String(page),
                limit: String(pageLimit),
                sortBy: activeSort.sortBy,
                sortOrder: activeSort.sortOrder,
                departmentId,
            });
            if (q) params.set("q", q);
            if (scoreFilter) params.set("scoreFilter", scoreFilter);
            if (scopeFilter) params.set("scope", scopeFilter);
            if (typeFilter) params.set("classification", typeFilter);
            if (agentFilter) params.set("agent", agentFilter);
            if (uploadedByFilter) {
                if (uploadedByFilter === "me") {
                    params.set("uploadedBy", me?.userId || "");
                } else {
                    params.set("uploadedBy", uploadedByFilter);
                }
            }
            const data = await apiRequest(`/docs/documents?${params}`);
            setDocs(data?.data?.documents || []);
            setPagination(data?.data?.pagination || { page: 1, limit: 10, total: 0, totalPages: 0 });
        } catch (e: any) {
            setError(e.message || "Failed to load documents");
            setDocs([]);
            setPagination({ page, limit: pageLimit, total: 0, totalPages: 0 });
        } finally {
            setLoadingDocs(false);
        }
    }, [departmentId, page, pageLimit, q, activeSort.sortBy, activeSort.sortOrder, scoreFilter, scopeFilter, typeFilter, agentFilter]);

    useEffect(() => {
        loadOverview();
    }, [loadOverview]);

    useEffect(() => {
        loadDocs();
    }, [loadDocs]);

    const applySearch = () => {
        setQ(searchInput);
        setPage(1);
    };

    const filteredDocs = agentFilter ? docs.filter((d) => resolveDocAgent(d) === agentFilter) : docs;

    const clearFilters = () => {
        setSearchInput("");
        setQ("");
        setScoreFilter("");
        setScopeFilter("");
        setTypeFilter("");
        setAgentFilter("");
        setSortPreset("newest");
        setPage(1);
    };

    const removeDocument = async (id: string, name: string) => {
        if (!confirm(`Delete "${name}" permanently?`)) return;
        try {
            await apiRequest(`/docs/documents/${id}`, { method: "DELETE" });
            await loadDocs();
        } catch (e: any) {
            setError(e.message || "Delete failed");
        }
    };

    if (loadingOverview) {
        return (
            <div className="flex justify-center py-20">
                <Loader2 className="h-8 w-8 animate-spin" style={{ color: colors.primary }} />
            </div>
        );
    }

    if (!overview) {
        return (
            <div className="p-8 text-sm" style={{ color: colors.textMuted }}>
                Department not found or access denied.
            </div>
        );
    }

    const uploaderNames = Object.fromEntries(overview.members.map((member) => [member.userId, member.user?.fullName || member.userId]));
    const leaderNames = overview.leaders.map((leader) => leader.user?.fullName).filter(Boolean) as string[];

    return (
        <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
            <PageHeader
                title={overview.department.name}
                subtitle={overview.department.description || "Department document workspace"}
                actions={
                    <Button variant="secondary" onClick={() => { loadOverview(); loadDocs(); }}>
                        <RefreshCw className={`mr-2 h-4 w-4 ${loadingDocs ? "animate-spin" : ""}`} />
                        Refresh
                    </Button>
                }
            />

            <div className="grid gap-4 md:grid-cols-3">
                <div className="surface-card p-5 space-y-3">
                    <div className="text-xs uppercase tracking-[0.2em]" style={{ color: colors.textMuted }}>
                        Members
                    </div>
                    <div className="text-3xl font-semibold" style={{ color: colors.text }}>
                        {overview.members.length}
                    </div>
                    <div className="text-sm" style={{ color: colors.textMuted }}>
                        People in this department
                    </div>
                </div>
                <div className="surface-card p-5 space-y-3">
                    <div className="text-xs uppercase tracking-[0.2em]" style={{ color: colors.textMuted }}>
                        Documents
                    </div>
                    <div className="text-3xl font-semibold" style={{ color: colors.text }}>
                        {pagination.total}
                    </div>
                    <div className="text-sm" style={{ color: colors.textMuted }}>
                        Files uploaded by this department
                    </div>
                </div>
                <div className="surface-card p-5 space-y-3">
                    <div className="text-xs uppercase tracking-[0.2em]" style={{ color: colors.textMuted }}>
                        Leaders
                    </div>
                    <div className="text-lg font-semibold" style={{ color: colors.text }}>
                        {leaderNames.length ? leaderNames.join(", ") : "No leaders yet"}
                    </div>
                    <div className="text-sm" style={{ color: colors.textMuted }}>
                        Department leadership
                    </div>
                </div>
            </div>

            <div className="surface-card">
                <div className={`px-5 py-4 border-b ${colors.borderPrimary} flex flex-wrap items-center justify-between gap-3`}>
                    <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-lg bg-[var(--accent-muted)] text-[var(--accent)] flex items-center justify-center">
                            <FileText size={15} />
                        </div>
                        <div>
                            <h2 className={`text-sm font-semibold ${colors.textPrimary}`}>Department documents</h2>
                            <span className={`text-xs ${colors.textMuted}`}>All documents uploaded by this department.</span>
                        </div>
                    </div>
                    <button type="button" onClick={() => { loadOverview(); loadDocs(); }} className="btn-secondary rounded-xl px-3 py-2 text-sm flex items-center gap-2">
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
                                    label="Uploaded by"
                                    value={uploadedByFilter}
                                    onChange={(v) => { setUploadedByFilter(v); setPage(1); }}
                                    options={
                                        [
                                            { value: "", label: "All" },
                                            { value: "me", label: "Me" },
                                            ...overview.members.map((m) => ({ value: m.userId, label: m.user?.fullName || m.userId })),
                                        ]
                                    }
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
                    {(q || scoreFilter || agentFilter || scopeFilter || typeFilter || sortPreset !== "newest") && (
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
                                onClick={clearFilters}
                                className={`text-[11px] ${colors.textMuted} hover:text-[var(--accent)] underline-offset-2 hover:underline`}
                            >
                                Clear filters
                            </button>
                        </div>
                    )}
                </div>

                {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 text-red-300 px-4 py-3 text-sm">{error}</div>}

                {loadingDocs ? (
                    <div className={`p-8 text-sm ${colors.textMuted}`}>Loading…</div>
                ) : filteredDocs.length === 0 ? (
                    <EmptyState
                        icon={<FileText size={22} />}
                        title="No documents found"
                        description="Adjust your filters to find files uploaded by this department."
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
                                            {doc.metadata?.cvScore != null ? (
                                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase border bg-[var(--accent-muted)] text-[var(--accent)] border-[rgba(45,212,191,0.25)]`}>
                                                    Score: {doc.metadata.cvScore}
                                                </span>
                                            ) : (
                                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase border ${statusBadge(displayStatus)}`}>
                                                    {isProcessing && <Loader2 size={10} className="animate-spin" />}
                                                    {displayStatus}
                                                </span>
                                            )}
                                            {doc.isDuplicate && (
                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase bg-amber-500/15 text-amber-300 border border-amber-500/25">
                                                    Duplicate ×{doc.duplicateCount}
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
                                            <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold mr-2 bg-[var(--accent-muted)] text-[var(--accent)] border border-[rgba(45,212,191,0.2)]">
                                                {getFileTypeLabel(doc.mimeType, doc.originalFilename)}
                                            </span>
                                            {formatBytes(doc.sizeBytes)} · {new Date(doc.createdAt).toLocaleString()}
                                            {doc.classification && ` · ${doc.classification}`}
                                            {doc.metadata?.phase3Agent && ` · ${agentLabel(doc.metadata.phase3Agent)}`}
                                            {/* Score shown above in status position; no duplicate here */}
                                        </p>
                                        {doc.aiErrorMessage && (
                                            <p className="text-xs text-red-400 mt-1">{doc.aiErrorMessage}</p>
                                        )}
                                    </div>
                                    <div className="flex gap-2 flex-wrap w-full sm:w-auto">
                                        <Link href={`/documents/details?doc=${doc.documentId}`} className="btn-secondary rounded-lg px-3 py-2 text-sm flex items-center justify-center gap-1.5 flex-1 sm:flex-initial min-h-10">
                                            <Info size={14} /> Details
                                        </Link>
                                        <Link href={`/documents/${doc.documentId}`} className="btn-secondary rounded-lg px-3 py-2 text-sm flex items-center justify-center gap-1.5 flex-1 sm:flex-initial min-h-10">
                                            <Eye size={14} /> Preview
                                        </Link>
                                        {canDeleteDocs() && (
                                            <button type="button" onClick={() => removeDocument(doc.documentId, doc.originalFilename)} className="btn-ghost rounded-lg px-3 py-2 text-sm flex items-center justify-center gap-1.5 text-red-300 min-h-10">
                                                <Trash2 size={14} /> Delete
                                            </button>
                                        )}
                                        {(canShareDocs() || me?.orgRole?.isLeader) && (
                                            <button
                                                type="button"
                                                onClick={() => setSharingDoc({ documentId: doc.documentId, filename: doc.originalFilename })}
                                                className="btn-secondary rounded-lg px-3 py-2 text-sm flex items-center justify-center gap-1.5 min-h-10"
                                            >
                                                <Share2 size={14} /> Share
                                            </button>
                                        )}
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}

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

            {/* Share Modal */}
            {sharingDoc && (
                <ShareModal
                    documentId={sharingDoc.documentId}
                    filename={sharingDoc.filename}
                    currentDepartmentId={departmentId}
                    open={true}
                    onClose={() => setSharingDoc(null)}
                    onShared={() => { loadDocs(); loadOverview(); }}
                />
            )}
        </div>
    );
}

export default function DepartmentPage() {
    return (
        <ClientLayout>
            <DepartmentOverviewContent />
        </ClientLayout>
    );
}
