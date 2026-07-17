"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
    Activity,
    RefreshCw,
    Search,
    FileText,
    MessageSquare,
    Users,
    Shield,
    LogIn,
    AlertCircle,
} from "lucide-react";
import ClientLayout from "@/components/ClientLayout";
import { PageHeader, EmptyState } from "@/components/ui";
import { useTheme } from "@/context/ColorContext";
import { usePermissions } from "@/context/PermissionsContext";
import { getStoredUser } from "@/lib/authSession";
import { apiRequest } from "@/lib/apiClient";

type ActivityItem = {
    logId: string;
    actorUserId: string;
    actorRole: string;
    actorEmail?: string;
    actorName?: string;
    organizationId?: string | null;
    action: string;
    category: string;
    resourceType?: string;
    resourceId?: string;
    outcome: "success" | "failure";
    message?: string;
    metadata?: Record<string, unknown>;
    createdAt: string;
};

type ActorOption = {
    userId: string;
    fullName?: string;
    email?: string;
    role?: string;
};

const CATEGORIES = [
    { value: "", label: "All categories" },
    { value: "auth", label: "Auth" },
    { value: "document", label: "Documents" },
    { value: "chat", label: "Chat" },
    { value: "team", label: "Team" },
    { value: "admin", label: "Admin" },
];

function categoryIcon(category: string) {
    switch (category) {
        case "document":
            return FileText;
        case "chat":
            return MessageSquare;
        case "team":
            return Users;
        case "admin":
            return Shield;
        case "auth":
            return LogIn;
        default:
            return Activity;
    }
}

function roleSubtitle(role: string | undefined) {
    if (role === "superAdmin") return "Your activity, all admins, and their team members";
    if (role === "admin") return "Your activity and your team members";
    return "Your own activity only";
}

function ActivityContent() {
    const { theme } = useTheme();
    const colors = theme.colors;
    const { role: permRole } = usePermissions();
    const stored = getStoredUser<{ role?: string; fullName?: string }>();
    const role = permRole || stored?.role || "team";

    const [logs, setLogs] = useState<ActivityItem[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [limit] = useState(30);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [category, setCategory] = useState("");
    const [actorUserId, setActorUserId] = useState("");
    const [q, setQ] = useState("");
    const [searchInput, setSearchInput] = useState("");
    const [actors, setActors] = useState<ActorOption[]>([]);

    const totalPages = Math.max(1, Math.ceil(total / limit));
    const canFilterActors = role === "admin" || role === "superAdmin";

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams({
                page: String(page),
                limit: String(limit),
            });
            if (category) params.set("category", category);
            if (actorUserId) params.set("actorUserId", actorUserId);
            if (q) params.set("q", q);
            const data = await apiRequest(`/docs/activity?${params.toString()}`);
            setLogs(data?.data?.logs || []);
            setTotal(data?.data?.total || 0);
        } catch (e: any) {
            setError(e.message || "Failed to load activity");
            setLogs([]);
        } finally {
            setLoading(false);
        }
    }, [page, limit, category, actorUserId, q]);

    const loadActors = useCallback(async () => {
        if (!canFilterActors) return;
        try {
            const data = await apiRequest("/docs/activity/actors");
            setActors(data?.data?.actors || []);
        } catch {
            setActors([]);
        }
    }, [canFilterActors]);

    useEffect(() => {
        load();
    }, [load]);

    useEffect(() => {
        loadActors();
    }, [loadActors]);

    const applySearch = () => {
        setPage(1);
        setQ(searchInput.trim());
    };

    const subtitle = useMemo(() => roleSubtitle(role), [role]);

    return (
        <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto space-y-6 animate-fade-in-up">
            <PageHeader
                title="Activity"
                subtitle={subtitle}
                actions={
                    <button
                        type="button"
                        onClick={load}
                        className="btn-secondary rounded-xl px-4 py-2 text-sm inline-flex items-center gap-2 min-h-10"
                    >
                        <RefreshCw size={14} /> Refresh
                    </button>
                }
            />

            <div className="surface-card overflow-hidden">
                <div className={`px-4 sm:px-5 py-4 border-b border-[var(--border)] bg-white/[0.02]`}>
                    <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3 items-stretch sm:items-end">
                        <div className="flex flex-col gap-1 flex-1 min-w-0">
                            <span className={`text-[10px] font-semibold uppercase tracking-wider ${colors.textMuted}`}>
                                Search
                            </span>
                            <div className="relative">
                                <Search
                                    size={16}
                                    className={`absolute left-3 top-1/2 -translate-y-1/2 ${colors.textMuted}`}
                                />
                                <input
                                    value={searchInput}
                                    onChange={(e) => setSearchInput(e.target.value)}
                                    onKeyDown={(e) => e.key === "Enter" && applySearch()}
                                    placeholder="Message, email, action…"
                                    className="w-full premium-input rounded-xl py-2.5 pl-10 pr-4 text-sm"
                                />
                            </div>
                        </div>
                        <div className="flex flex-col gap-1 w-full sm:w-auto">
                            <span className={`text-[10px] font-semibold uppercase tracking-wider ${colors.textMuted}`}>
                                Category
                            </span>
                            <select
                                value={category}
                                onChange={(e) => {
                                    setCategory(e.target.value);
                                    setPage(1);
                                }}
                                className="premium-input rounded-xl py-2.5 px-3 text-sm w-full sm:min-w-[160px]"
                            >
                                {CATEGORIES.map((c) => (
                                    <option key={c.value || "all"} value={c.value}>
                                        {c.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                        {canFilterActors && (
                            <div className="flex flex-col gap-1 w-full sm:w-auto">
                                <span className={`text-[10px] font-semibold uppercase tracking-wider ${colors.textMuted}`}>
                                    Person
                                </span>
                                <select
                                    value={actorUserId}
                                    onChange={(e) => {
                                        setActorUserId(e.target.value);
                                        setPage(1);
                                    }}
                                    className="premium-input rounded-xl py-2.5 px-3 text-sm w-full sm:min-w-[200px]"
                                >
                                    <option value="">Everyone you can see</option>
                                    {actors.map((a) => (
                                        <option key={a.userId} value={a.userId}>
                                            {a.fullName || a.email} ({a.role})
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}
                        <button
                            type="button"
                            onClick={applySearch}
                            className="btn-gradient rounded-xl px-4 py-2.5 text-sm min-h-[42px] w-full sm:w-auto"
                        >
                            Search
                        </button>
                    </div>
                </div>

                {error && (
                    <div className="px-5 py-3 text-sm text-rose-400 flex items-center gap-2">
                        <AlertCircle size={14} /> {error}
                    </div>
                )}

                {loading ? (
                    <div className={`p-8 text-sm ${colors.textMuted}`}>Loading activity…</div>
                ) : logs.length === 0 ? (
                    <div className="p-8">
                        <EmptyState
                            icon={<Activity size={28} className="text-[var(--accent)]" />}
                            title="No activity yet"
                            description="Actions like login, uploads, chat, and team changes will appear here."
                        />
                    </div>
                ) : (
                    <ul className="divide-y divide-[var(--border)]">
                        {logs.map((log) => {
                            const Icon = categoryIcon(log.category);
                            const failed = log.outcome === "failure";
                            return (
                                <li
                                    key={log.logId}
                                    className={`px-4 sm:px-5 py-4 flex gap-3 ${colors.bgHover}`}
                                >
                                    <div
                                        className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 border ${
                                            failed
                                                ? "bg-rose-500/10 border-rose-500/25 text-rose-300"
                                                : "bg-[var(--accent-muted)] border-[rgba(45,212,191,0.25)] text-[var(--accent)]"
                                        }`}
                                    >
                                        <Icon size={16} />
                                    </div>
                                    <div className="min-w-0 flex-1 space-y-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <p className={`text-sm font-semibold ${colors.textPrimary}`}>
                                                {log.message || log.action}
                                            </p>
                                            {failed && (
                                                <span className="text-[10px] uppercase font-semibold tracking-wider px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-300 border border-rose-500/25">
                                                    Failed
                                                </span>
                                            )}
                                        </div>
                                        <p className={`text-xs ${colors.textMuted} break-words`}>
                                            <span className="font-medium text-[var(--foreground-secondary)]">
                                                {log.actorName || log.actorEmail || log.actorUserId}
                                            </span>
                                            {" · "}
                                            <span className="uppercase tracking-wide">{log.actorRole}</span>
                                            {" · "}
                                            <span className="font-mono">{log.action}</span>
                                        </p>
                                        <p className={`text-[11px] ${colors.textMuted}`}>
                                            {log.createdAt
                                                ? new Date(log.createdAt).toLocaleString()
                                                : ""}
                                        </p>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}

                {total > limit && (
                    <div
                        className={`px-4 sm:px-5 py-3 border-t border-[var(--border)] flex flex-wrap items-center justify-between gap-2 text-sm ${colors.textMuted}`}
                    >
                        <span>
                            Page {page} of {totalPages} · {total} events
                        </span>
                        <div className="flex gap-2">
                            <button
                                type="button"
                                disabled={page <= 1}
                                onClick={() => setPage((p) => Math.max(1, p - 1))}
                                className="btn-secondary rounded-lg px-3 py-2 text-sm disabled:opacity-40"
                            >
                                Previous
                            </button>
                            <button
                                type="button"
                                disabled={page >= totalPages}
                                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                                className="btn-secondary rounded-lg px-3 py-2 text-sm disabled:opacity-40"
                            >
                                Next
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default function ActivityPage() {
    return (
        <ClientLayout>
            <ActivityContent />
        </ClientLayout>
    );
}
