"use client";

import React, { useEffect } from "react";
import { CheckSquare, Square, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type ChatScope = "all" | "selected";
export type DocStatusFilter = "" | "ready" | "processing" | "failed";

export type ScopeLibraryDoc = {
    documentId: string;
    originalFilename: string;
    status: string;
    pythonDocumentId?: string | null;
    cv_score?: number | null;
};

type ChatScopePanelProps = {
    open: boolean;
    onClose: () => void;
    chatScope: ChatScope;
    onChatScopeChange: (scope: ChatScope) => void;
    filteredDocs: ScopeLibraryDoc[];
    selectedDocIds: string[];
    onToggleDoc: (id: string) => void;
    onSelectAll: () => void;
    onClearSelection: () => void;
    docSearch: string;
    onDocSearchChange: (v: string) => void;
    docStatusFilter: DocStatusFilter;
    onDocStatusFilterChange: (v: DocStatusFilter) => void;
    unprocessedCount: number;
    libraryCount: number;
    selectableCount: number;
    textPrimary: string;
    textMuted: string;
    textSecondary: string;
    bgHover: string;
};

export default function ChatScopePanel({
    open,
    onClose,
    chatScope,
    onChatScopeChange,
    filteredDocs,
    selectedDocIds,
    onToggleDoc,
    onSelectAll,
    onClearSelection,
    docSearch,
    onDocSearchChange,
    docStatusFilter,
    onDocStatusFilterChange,
    unprocessedCount,
    libraryCount,
    selectableCount,
    textPrimary,
    textMuted,
    textSecondary,
    bgHover,
}: ChatScopePanelProps) {
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [open, onClose]);

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-50 flex justify-end">
            <button
                type="button"
                className="absolute inset-0 bg-black/50 backdrop-blur-sm"
                aria-label="Close document scope"
                onClick={onClose}
            />
            <aside
                className={cn(
                    "relative z-10 h-full w-full max-w-md flex flex-col",
                    "border-l border-[var(--border)]",
                    "bg-[var(--surface)]",
                    "shadow-[-12px_0_40px_rgba(0,0,0,0.2)]",
                    "animate-fade-in-up"
                )}
                role="dialog"
                aria-modal="true"
                aria-labelledby="chat-scope-title"
            >
                <div className="px-5 py-4 border-b border-[var(--border)] flex items-start justify-between gap-3">
                    <div>
                        <h2 id="chat-scope-title" className={`text-base font-semibold ${textPrimary}`}>
                            Document scope
                        </h2>
                        <p className={`text-xs mt-1 ${textMuted}`}>
                            Choose which library files this chat can use.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="btn-ghost rounded-lg p-2 shrink-0"
                        aria-label="Close"
                    >
                        <X size={16} />
                    </button>
                </div>

                <div className="px-5 py-4 space-y-3 border-b border-[var(--border)]">
                    <label className="flex items-center gap-2.5 cursor-pointer text-sm">
                        <input
                            type="radio"
                            name="chatScopePanel"
                            checked={chatScope === "all"}
                            onChange={() => onChatScopeChange("all")}
                            className="accent-teal-500"
                        />
                        <span className={textPrimary}>
                            All documents
                            <span className={`block text-[11px] ${textMuted}`}>{libraryCount} in library</span>
                        </span>
                    </label>
                    <label className="flex items-center gap-2.5 cursor-pointer text-sm">
                        <input
                            type="radio"
                            name="chatScopePanel"
                            checked={chatScope === "selected"}
                            onChange={() => onChatScopeChange("selected")}
                            className="accent-teal-500"
                        />
                        <span className={textPrimary}>
                            Selected only
                            <span className={`block text-[11px] ${textMuted}`}>
                                {selectedDocIds.length} of {selectableCount} processed
                            </span>
                        </span>
                    </label>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-3">
                    {chatScope === "all" ? (
                        <p className={`text-sm ${textMuted} leading-relaxed`}>
                            Answers will search across all processed documents in your library.
                            Switch to <span className={textPrimary}>Selected only</span> to narrow the set.
                        </p>
                    ) : (
                        <>
                            <div className="relative">
                                <Search size={14} className={`absolute left-3 top-1/2 -translate-y-1/2 ${textMuted}`} />
                                <input
                                    value={docSearch}
                                    onChange={(e) => onDocSearchChange(e.target.value)}
                                    placeholder="Search filename…"
                                    className="w-full premium-input rounded-xl py-2.5 pl-9 pr-3 text-sm"
                                />
                            </div>
                            <select
                                value={docStatusFilter}
                                onChange={(e) => onDocStatusFilterChange(e.target.value as DocStatusFilter)}
                                className="w-full premium-input rounded-xl py-2.5 px-3 text-sm"
                            >
                                <option value="">All statuses</option>
                                <option value="ready">Ready</option>
                                <option value="processing">Processing</option>
                                <option value="failed">Failed</option>
                            </select>
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={onSelectAll}
                                    className="btn-secondary rounded-xl px-3 py-2 text-xs flex-1"
                                >
                                    Select all ({filteredDocs.length})
                                </button>
                                <button
                                    type="button"
                                    onClick={onClearSelection}
                                    className="btn-ghost rounded-xl px-3 py-2 text-xs flex-1"
                                >
                                    Clear
                                </button>
                            </div>
                            <p className={`text-[11px] ${textMuted}`}>
                                {selectedDocIds.length} of {filteredDocs.length} shown selected
                            </p>

                            {filteredDocs.length === 0 ? (
                                <p className={`text-sm ${textMuted}`}>No matching processed documents.</p>
                            ) : (
                                <div className="space-y-1">
                                    {filteredDocs.map((doc) => {
                                        const checked = selectedDocIds.includes(doc.documentId);
                                        return (
                                            <button
                                                key={doc.documentId}
                                                type="button"
                                                onClick={() => onToggleDoc(doc.documentId)}
                                                className={cn(
                                                    "w-full flex items-start gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm border border-transparent",
                                                    checked
                                                        ? "bg-[var(--accent-muted)] border-[rgba(45,212,191,0.25)]"
                                                        : bgHover
                                                )}
                                            >
                                                {checked ? (
                                                    <CheckSquare size={16} className="text-teal-400 shrink-0 mt-0.5" />
                                                ) : (
                                                    <Square size={16} className={`${textMuted} shrink-0 mt-0.5`} />
                                                )}
                                                <span className={`${textSecondary} line-clamp-2`}>
                                                    {doc.originalFilename}
                                                    {doc.cv_score !== undefined && doc.cv_score !== null && (
                                                        <span className="ml-2 inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-semibold text-amber-500 border border-amber-500/20 shrink-0">
                                                            ⭐ Score: {doc.cv_score}/100
                                                        </span>
                                                    )}
                                                    <span className={`block text-[11px] mt-0.5 ${textMuted}`}>
                                                        {doc.status}
                                                    </span>
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}

                            {unprocessedCount > 0 && (
                                <p className={`text-[11px] ${textMuted} pt-1`}>
                                    {unprocessedCount} document(s) not yet processed by AI are hidden.
                                </p>
                            )}
                        </>
                    )}
                </div>

                <div className="px-5 py-4 border-t border-[var(--border)]">
                    <button type="button" onClick={onClose} className="btn-gradient w-full rounded-xl py-2.5 text-sm">
                        Done
                    </button>
                </div>
            </aside>
        </div>
    );
}
