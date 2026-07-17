"use client";

import React, { useEffect, useState } from "react";
import { Loader2, Star, Trash2 } from "lucide-react";
import { apiRequest } from "@/lib/apiClient";
import { inferDocTypeFromFilename } from "@/lib/documentAgents";
import { appendAuthToken } from "@/lib/documents";

type DocRecord = {
    documentId: string;
    originalFilename: string;
    mimeType?: string;
    sizeBytes: number;
    status: string;
    storagePath?: string;
    pythonDocumentId?: string | null;
    classification?: string | null;
    pageCount?: number;
    createdAt: string;
    metadata?: { cvScore?: number; phase3Agent?: string } | null;
};

function scoreColor(score: number) {
    if (score >= 70) return "bg-emerald-500/15 text-emerald-300 border-emerald-500/25";
    if (score >= 40) return "bg-amber-500/15 text-amber-300 border-amber-500/25";
    return "bg-red-500/15 text-red-300 border-red-500/25";
}

function barColor(pct: number) {
    if (pct >= 70) return "bg-emerald-500";
    if (pct >= 40) return "bg-amber-500";
    return "bg-red-500";
}

function statusBadgeClass(status: string) {
    const s = status.toLowerCase();
    if (s === "ready" || s === "processed") return "bg-green-500/15 text-green-300 border-green-500/25";
    if (s === "failed" || s === "error") return "bg-red-500/15 text-red-300 border-red-500/25";
    if (s === "processing" || s === "uploaded") return "bg-amber-500/15 text-amber-300 border-amber-500/25";
    return "bg-slate-500/15 text-slate-300 border-slate-500/25";
}

function typeBadgeClass(docType: string) {
    const t = docType.toLowerCase();
    if (t === "resume" || t === "cv") return "bg-cyan-500/15 text-cyan-300 border-cyan-500/25";
    if (t === "invoice") return "bg-[var(--accent-muted)] text-[var(--accent)] border-[rgba(45,212,191,0.25)]";
    if (t === "contract") return "bg-teal-500/15 text-teal-300 border-teal-500/25";
    return "bg-slate-500/15 text-slate-300 border-slate-500/25";
}

function statusLabel(status: string) {
    if (status === "ready") return "processed";
    if (status === "uploaded") return "processing";
    return status;
}

function hasModelData(ai?: Record<string, unknown> | null) {
    if (!ai) return false;
    if (ai.cv_score != null) return true;
    if (ai.cv_extraction_data && typeof ai.cv_extraction_data === "object") return true;
    if (ai.extracted_data && typeof ai.extracted_data === "object" && Object.keys(ai.extracted_data as object).length) return true;
    if (typeof ai.raw_text === "string" && ai.raw_text.length > 50) return true;
    return false;
}

function isAnalysisFinished(
    ai?: Record<string, unknown> | null,
    job?: Record<string, unknown> | null,
    docStatus?: string
) {
    const aiStatus = String(ai?.status || "").toLowerCase();
    if (["processed", "ready", "completed", "failed", "error"].includes(aiStatus)) return true;
    if (docStatus === "ready" || docStatus === "failed") return true;
    const jobStatus = String(job?.status || "").toLowerCase();
    const jobStage = String(job?.stage || "").toLowerCase();
    if (jobStatus === "completed" || jobStatus === "failed") return true;
    if (jobStage === "completed") return true;
    return false;
}

function DetailSkeleton() {
    return (
        <div className="space-y-5 w-full max-w-4xl animate-fade-in-up">
            <div className="space-y-3">
                <div className="h-8 w-2/3 max-w-md rounded-lg bg-white/5 animate-shimmer" />
                <div className="flex gap-2">
                    <div className="h-6 w-16 rounded-full bg-white/5 animate-shimmer" />
                    <div className="h-6 w-20 rounded-full bg-white/5 animate-shimmer" />
                    <div className="h-6 w-14 rounded-full bg-white/5 animate-shimmer" />
                </div>
            </div>
            <div className="surface-card !rounded-xl overflow-hidden min-h-[50vh]">
                <div className="px-5 py-4 border-b border-[var(--border)] flex items-center gap-2">
                    <div className="h-4 w-4 rounded bg-amber-400/30 animate-pulse" />
                    <div className="h-4 w-32 rounded bg-white/5 animate-shimmer" />
                    <div className="ml-auto h-6 w-24 rounded-full bg-white/5 animate-shimmer" />
                </div>
                <div className="p-5 sm:p-6 space-y-5">
                    {[1, 2, 3, 4].map((i) => (
                        <div key={i} className="space-y-2">
                            <div className="flex justify-between">
                                <div className="h-3 w-24 rounded bg-white/5 animate-shimmer" />
                                <div className="h-3 w-12 rounded bg-white/5 animate-shimmer" />
                            </div>
                            <div className="h-2.5 w-full rounded-full bg-white/5 overflow-hidden">
                                <div
                                    className="h-full rounded-full bg-gradient-to-r from-teal-500/30 via-teal-400/50 to-teal-500/30 animate-shimmer"
                                    style={{ width: `${55 + i * 8}%` }}
                                />
                            </div>
                        </div>
                    ))}
                    <div className="pt-2 space-y-2">
                        <div className="h-3 w-20 rounded bg-white/5 animate-shimmer" />
                        <div className="flex flex-wrap gap-2">
                            {[1, 2, 3].map((i) => (
                                <div key={i} className="h-7 w-20 rounded-lg bg-white/5 animate-shimmer" />
                            ))}
                        </div>
                    </div>
                </div>
            </div>
            <p className="text-center text-xs text-[var(--foreground-muted)] flex items-center justify-center gap-2">
                <Loader2 size={12} className="animate-spin text-[var(--accent)]" />
                Loading evaluation…
            </p>
        </div>
    );
}

export default function DocumentDetailPanel({
    doc,
    ai,
    colors,
    onDelete,
    showDelete = false,
    analyzing = false,
}: {
    doc: DocRecord;
    ai?: Record<string, unknown> | null;
    isDark?: boolean;
    colors: { textMuted: string; textPrimary: string };
    onDelete?: () => void;
    showDelete?: boolean;
    analyzing?: boolean;
}) {
    const [descFileUrl, setDescFileUrl] = useState("");

    const inferredType = inferDocTypeFromFilename(doc.originalFilename);
    const docType = String(ai?.document_type || doc.classification || inferredType || "unknown");
    const cvScore = Number(ai?.cv_score ?? doc.metadata?.cvScore ?? NaN);
    const cvData = (ai?.cv_extraction_data || null) as Record<string, unknown> | null;
    const rawText = typeof ai?.raw_text === "string" ? ai.raw_text : "";
    const extracted = (ai?.extracted_data || null) as Record<string, unknown> | null;
    const displayStatus = statusLabel(String(ai?.status || doc.status));
    const finished = isAnalysisFinished(ai, undefined, doc.status);
    const isProcessing = analyzing && !finished && (displayStatus === "processing" || doc.status === "processing");
    const showCv = docType === "resume" || inferredType === "resume";
    const showSkeleton = isProcessing || (analyzing && !hasModelData(ai));

    useEffect(() => {
        if (!doc.documentId || !hasModelData(ai)) {
            setDescFileUrl("");
            return;
        }
        apiRequest(`/docs/documents/${doc.documentId}/images`)
            .then((d) => setDescFileUrl(d?.data?.descriptions_file || ""))
            .catch(() => setDescFileUrl(""));
    }, [doc.documentId, ai]);

    const cardClass = "surface-card !rounded-xl";

    if (showSkeleton) {
        return <DetailSkeleton />;
    }

    return (
        <div className="space-y-5 w-full max-w-4xl animate-fade-in-up">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <h2 className={`text-xl sm:text-2xl font-bold tracking-tight break-all ${colors.textPrimary}`}>{doc.originalFilename}</h2>
                    <div className="flex flex-wrap gap-2 mt-2">
                        <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold border ${typeBadgeClass(docType)}`}>
                            {docType}
                        </span>
                        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${statusBadgeClass(displayStatus)}`}>
                            {displayStatus}
                        </span>
                        {showCv && !Number.isNaN(cvScore) && (
                            <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold border ${scoreColor(cvScore)}`}>
                                Score: {cvScore}
                            </span>
                        )}
                    </div>
                </div>
                {showDelete && onDelete && (
                    <button type="button" onClick={onDelete} className="btn-ghost rounded-lg px-2 py-2 text-red-300 hover:bg-red-500/10 shrink-0 min-h-11 min-w-11 flex items-center justify-center" title="Delete">
                        <Trash2 size={16} />
                    </button>
                )}
            </div>

            {finished && !hasModelData(ai) && (
                <div className="surface-card px-4 py-3 text-sm text-[var(--foreground-secondary)] border border-[var(--border)]">
                    Analysis finished but scores are not available yet. Try re-opening this document in a moment.
                </div>
            )}

            {rawText && (
                <details className={`${cardClass} overflow-hidden group`}>
                    <summary className={`px-5 py-4 text-sm font-semibold cursor-pointer list-none flex items-center justify-between gap-3 ${colors.textPrimary}`}>
                        <span>OCR Preview ({rawText.length.toLocaleString()} chars)</span>
                        <span className="flex items-center gap-3 shrink-0">
                            {descFileUrl && (
                                <a
                                    href={appendAuthToken(descFileUrl)}
                                    target="_blank"
                                    rel="noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="text-xs font-medium text-[var(--accent)] hover:underline"
                                >
                                    Download All Descriptions
                                </a>
                            )}
                            <span className="text-[var(--foreground-muted)] text-xs group-open:rotate-180 transition-transform">▼</span>
                        </span>
                    </summary>
                    <div className={`max-h-96 overflow-y-auto px-5 pb-5 text-xs font-mono leading-relaxed whitespace-pre-wrap border-t border-[var(--border)] pt-4 ${colors.textMuted}`}>
                        {rawText.slice(0, 10000)}
                        {rawText.length > 10000 && "…"}
                    </div>
                </details>
            )}

            {showCv && cvData && (
                <div className={`${cardClass} overflow-hidden min-h-[60vh]`}>
                    <div className={`px-5 py-4 flex items-center gap-2 border-b border-[var(--border)] ${colors.textPrimary}`}>
                        <Star size={16} className="text-amber-400" />
                        <span className="text-base font-semibold">CV Evaluation</span>
                        {!Number.isNaN(cvScore) && (
                            <span className={`ml-auto inline-flex px-2.5 py-1 rounded-full text-xs font-semibold border ${scoreColor(cvScore)}`}>
                                Score: {cvScore}/100
                            </span>
                        )}
                    </div>
                    <div className="p-5 sm:p-6 space-y-5">
                        {(["skills_score", "experience_score", "education_score", "completeness_score"] as const).map((key) => {
                            const val = cvData[key];
                            if (val == null) return null;
                            const pct = Math.min(100, Math.max(0, Number(val)));
                            return (
                                <div key={key}>
                                    <div className={`flex justify-between text-sm mb-2 ${colors.textMuted}`}>
                                        <span className="capitalize font-medium">{key.replace(/_score$/, "")} Score</span>
                                        <span className="font-mono tabular-nums">{pct}/100</span>
                                    </div>
                                    <div className="w-full h-2.5 bg-white/10 rounded-full overflow-hidden">
                                        <div
                                            className={`h-full rounded-full transition-all duration-700 ease-out ${barColor(pct)}`}
                                            style={{ width: `${pct}%` }}
                                        />
                                    </div>
                                </div>
                            );
                        })}

                        {Array.isArray(cvData.strengths) && cvData.strengths.length > 0 && (
                            <div>
                                <p className={`text-sm font-semibold mb-2 ${colors.textPrimary}`}>Strengths</p>
                                <div className="flex flex-wrap gap-2">
                                    {(cvData.strengths as string[]).map((s, i) => (
                                        <span key={i} className="px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-300 text-sm border border-emerald-500/20">
                                            {s}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}

                        {Array.isArray(cvData.areas_for_improvement) && cvData.areas_for_improvement.length > 0 && (
                            <div>
                                <p className={`text-sm font-semibold mb-2 ${colors.textPrimary}`}>Areas for Improvement</p>
                                <div className="flex flex-wrap gap-2">
                                    {(cvData.areas_for_improvement as string[]).map((a, i) => (
                                        <span key={i} className="px-3 py-1.5 rounded-lg bg-amber-500/10 text-amber-300 text-sm border border-amber-500/20">
                                            {a}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}

                        {typeof cvData.recommendation === "string" && cvData.recommendation && (
                            <div>
                                <p className={`text-sm font-semibold mb-2 ${colors.textPrimary}`}>Recommendation</p>
                                <p className={`text-sm rounded-xl p-4 bg-[var(--accent-muted)] border border-[rgba(45,212,191,0.2)] ${colors.textPrimary} leading-relaxed`}>
                                    {cvData.recommendation}
                                </p>
                            </div>
                        )}

                        {typeof cvData.evaluation_summary === "string" && cvData.evaluation_summary && (
                            <div>
                                <p className={`text-sm font-semibold mb-2 ${colors.textPrimary}`}>Evaluation Summary</p>
                                <p className={`text-sm rounded-xl p-4 bg-white/[0.03] border border-[var(--border)] ${colors.textMuted} leading-relaxed`}>
                                    {cvData.evaluation_summary}
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {extracted && Object.keys(extracted).length > 0 && !showCv && (
                <div className={`${cardClass} p-5 min-h-[40vh]`}>
                    <p className={`text-sm font-semibold mb-3 ${colors.textPrimary}`}>Extracted Data</p>
                    <pre className={`text-xs overflow-x-auto max-h-[60vh] font-mono ${colors.textMuted}`}>{JSON.stringify(extracted, null, 2)}</pre>
                </div>
            )}

            {showCv && !cvData && finished && (
                <div className="surface-card px-5 py-8 text-center text-sm text-[var(--foreground-muted)]">
                    No CV evaluation data available for this document.
                </div>
            )}
        </div>
    );
}

export { hasModelData, isAnalysisFinished };
