"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Eye, RefreshCw, Search, FileText, Copy } from "lucide-react";
import ClientLayout from "@/components/ClientLayout";
import FilterSelect from "@/components/FilterSelect";
import LibraryPagination from "@/components/LibraryPagination";
import { useTheme } from "@/context/ColorContext";
import { apiRequest } from "@/lib/apiClient";
import { FILE_TYPE_MIME, FILE_TYPE_OPTIONS, getFileTypeLabel } from "@/lib/fileValidation";
import { PageHeader } from "@/components/ui";

type DocItem = {
    documentId: string;
    originalFilename: string;
    mimeType?: string;
    sizeBytes: number;
    status: string;
    organizationId?: string;
    uploadedBy: string;
    createdAt: string;
    duplicateCount?: number;
    isDuplicate?: boolean;
};

const DUPLICATE_OPTIONS = [
    { value: "", label: "All files" },
    { value: "true", label: "Duplicates only" },
];

function AdminDocumentsContent() {
    const { theme } = useTheme();
    const colors = theme.colors;
    const isDark = theme.name === "dark";
    const [docs, setDocs] = useState<DocItem[]>([]);
    const [page, setPage] = useState(1);
    const [pageLimit, setPageLimit] = useState(15);
    const [totalPages, setTotalPages] = useState(1);
    const [total, setTotal] = useState(0);
    const [q, setQ] = useState("");
    const [searchInput, setSearchInput] = useState("");
    const [fileTypeFilter, setFileTypeFilter] = useState("");
    const [duplicatesOnly, setDuplicatesOnly] = useState("");
    const [loading, setLoading] = useState(true);

    const applySearch = () => {
        setQ(searchInput);
        setPage(1);
    };

    const load = useCallback(async () => {
        setLoading(true);
        const params = new URLSearchParams({ page: String(page), limit: String(pageLimit) });
        if (q) params.set("q", q);
        if (fileTypeFilter && FILE_TYPE_MIME[fileTypeFilter]) {
            params.set("mimeType", FILE_TYPE_MIME[fileTypeFilter]);
        }
        if (duplicatesOnly === "true") params.set("duplicatesOnly", "true");
        const data = await apiRequest(`/docs/super-admin/documents?${params}`);
        setDocs(data?.data?.documents || []);
        setTotalPages(data?.data?.pagination?.totalPages || 1);
        setTotal(data?.data?.pagination?.total || 0);
        setLoading(false);
    }, [page, pageLimit, q, fileTypeFilter, duplicatesOnly]);

    useEffect(() => { load(); }, [load]);

    return (
        <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto space-y-6 animate-fade-in-up">
            <PageHeader
                title="All Documents"
                subtitle="Platform-wide document library"
            />

            <div className="surface-card">
                <div className={`px-5 py-4 border-b ${colors.borderPrimary} flex flex-wrap items-center justify-between gap-3`}>
                    <div className="flex items-center gap-2">
                        <FileText size={16} className={colors.textMuted} />
                        <h2 className={`text-sm font-semibold ${colors.textPrimary}`}>Library</h2>
                        <span className={`text-xs ${colors.textMuted}`}>({total})</span>
                    </div>
                    <button type="button" onClick={load} className="btn-secondary rounded-xl px-3 py-2 text-sm">
                        <RefreshCw size={14} className="inline mr-1" />Refresh
                    </button>
                </div>

                <div className={`px-4 sm:px-5 py-4 border-b ${colors.borderPrimary} bg-white/[0.02]`}>
                    <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-end gap-3">
                        <div className="flex flex-col gap-1 flex-1 min-w-0 w-full sm:min-w-[200px]">
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 ml-0.5">Search</span>
                            <div className="relative">
                                <Search size={16} className={`absolute left-3 top-1/2 -translate-y-1/2 ${colors.textMuted}`} />
                                <input
                                    value={searchInput}
                                    onChange={(e) => setSearchInput(e.target.value)}
                                    onKeyDown={(e) => e.key === "Enter" && applySearch()}
                                    placeholder="Search filename…"
                                    className="w-full premium-input rounded-xl py-2.5 pl-10 pr-4 text-sm"
                                />
                            </div>
                        </div>
                        <FilterSelect
                            label="File type"
                            value={fileTypeFilter}
                            onChange={(v) => { setFileTypeFilter(v); setPage(1); }}
                            options={[...FILE_TYPE_OPTIONS]}
                            minWidth="w-full sm:min-w-[150px] sm:w-auto"
                        />
                        <FilterSelect
                            label="Duplicates"
                            value={duplicatesOnly}
                            onChange={(v) => { setDuplicatesOnly(v); setPage(1); }}
                            options={DUPLICATE_OPTIONS}
                            minWidth="w-full sm:min-w-[140px] sm:w-auto"
                        />
                        <button type="button" onClick={applySearch} className="btn-gradient rounded-xl px-4 py-2.5 text-sm h-[42px] w-full sm:w-auto sm:self-end">
                            Search
                        </button>
                    </div>
                </div>

                <div className="overflow-hidden rounded-b-2xl">
                {loading ? (
                    <div className={`p-8 text-sm ${colors.textMuted}`}>Loading…</div>
                ) : docs.length === 0 ? (
                    <div className={`p-8 text-sm ${colors.textMuted}`}>No documents found.</div>
                ) : (
                    <ul className="divide-y divide-white/5">
                        {docs.map((doc) => (
                            <li key={doc.documentId} className="px-4 sm:px-5 py-4 flex flex-col sm:flex-row sm:flex-wrap justify-between gap-3">
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <p className={`font-medium truncate min-w-0 ${colors.textPrimary}`}>{doc.originalFilename}</p>
                                        {doc.isDuplicate && (
                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase bg-amber-500/15 text-amber-300 border border-amber-500/25">
                                                <Copy size={10} /> Duplicate ×{doc.duplicateCount}
                                            </span>
                                        )}
                                    </div>
                                    <p className={`text-xs ${colors.textMuted} break-words`}>
                                        <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase mr-2 bg-[var(--accent-muted)] text-[var(--accent)] border border-[rgba(45,212,191,0.2)]">
                                            {getFileTypeLabel(doc.mimeType, doc.originalFilename)}
                                        </span>
                                        org: {doc.organizationId || "—"} · by {doc.uploadedBy}
                                    </p>
                                </div>
                                <Link href={`/documents/${doc.documentId}`} className="btn-secondary rounded-lg px-3 py-2 text-sm flex items-center justify-center gap-1 min-h-10 w-full sm:w-auto">
                                    <Eye size={14} /> Preview
                                </Link>
                            </li>
                        ))}
                    </ul>
                )}
                </div>

                <LibraryPagination
                    page={page}
                    limit={pageLimit}
                    total={total}
                    totalPages={totalPages}
                    onPageChange={setPage}
                    onLimitChange={(limit) => { setPageLimit(limit); setPage(1); }}
                    borderClass={colors.borderPrimary}
                    textMutedClass={colors.textMuted}
                />
            </div>
        </div>
    );
}

export default function AdminDocumentsPage() {
    return <ClientLayout><AdminDocumentsContent /></ClientLayout>;
}
