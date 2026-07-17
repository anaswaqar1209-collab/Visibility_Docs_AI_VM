"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
    ChevronDown,
    ChevronRight,
    Mail,
    Phone,
    Building2,
    RefreshCw,
    UserCheck,
    UserX,
    Users,
    Shield,
} from "lucide-react";
import ClientLayout from "@/components/ClientLayout";
import { PageHeader, EmptyState } from "@/components/ui";
import { useTheme } from "@/context/ColorContext";
import { apiRequest } from "@/lib/apiClient";

type TeamMember = {
    userId: string;
    fullName: string;
    email: string;
    username?: string;
    contactNumber?: string;
    status: string;
    permissions?: Record<string, boolean>;
    createdAt?: string;
    lastLogin?: string;
    createdBy?: string;
};

type OrganizationInfo = {
    organizationId: string;
    organizationName: string;
    status?: string;
    subscriptionPlan?: string;
    contactEmail?: string;
};

type Admin = {
    userId: string;
    fullName: string;
    email: string;
    username?: string;
    contactNumber?: string;
    status: string;
    accountType?: string;
    organizationId?: string | null;
    organization?: OrganizationInfo | null;
    teamMembers?: TeamMember[];
    teamMemberCount?: number;
    createdAt?: string;
    lastLogin?: string;
    emailVerified?: boolean;
};

function statusClass(status: string) {
    return status === "active"
        ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/25"
        : "text-rose-400 bg-rose-500/10 border-rose-500/25";
}

function formatDate(value?: string) {
    if (!value) return "—";
    try {
        return new Date(value).toLocaleString();
    } catch {
        return "—";
    }
}

function permSummary(permissions?: Record<string, boolean>) {
    if (!permissions) return "—";
    const on = Object.entries(permissions)
        .filter(([, v]) => v)
        .map(([k]) => k.replace(/^document\./, "").replace(/^chat\./, "chat ").replace(/^team\./, "team ").replace(/^org\./, "org "));
    return on.length ? on.join(", ") : "none";
}

function AdminsContent() {
    const { theme } = useTheme();
    const colors = theme.colors;
    const [admins, setAdmins] = useState<Admin[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await apiRequest("/docs/super-admin/admins");
            setAdmins(data?.data?.admins || []);
            setError(null);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    const toggleStatus = async (userId: string, status: string) => {
        const next = status === "active" ? "blocked" : "active";
        await apiRequest(`/docs/super-admin/admins/${userId}/status`, {
            method: "PATCH",
            body: JSON.stringify({ status: next }),
        });
        await load();
    };

    const toggleExpand = (userId: string) => {
        setExpanded((prev) => ({ ...prev, [userId]: !prev[userId] }));
    };

    return (
        <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto space-y-6 animate-fade-in-up">
            <PageHeader
                title="Admins"
                subtitle="Full admin profiles with their organization and team members"
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
            {error && <div className="text-rose-400 text-sm">{error}</div>}

            <div className="surface-card overflow-hidden">
                {loading ? (
                    <div className={`p-8 text-sm ${colors.textMuted}`}>Loading admins…</div>
                ) : admins.length === 0 ? (
                    <div className="p-8">
                        <EmptyState
                            icon={<Shield size={28} className="text-[var(--accent)]" />}
                            title="No admins yet"
                            description="Company admins will appear here with their team details."
                        />
                    </div>
                ) : (
                    <ul className="divide-y divide-[var(--border)]">
                        {admins.map((a) => {
                            const open = !!expanded[a.userId];
                            const members = a.teamMembers || [];
                            return (
                                <li key={a.userId} className={`${colors.bgHover}`}>
                                    <div className="px-4 sm:px-5 py-4 flex flex-col gap-3">
                                        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                                            <button
                                                type="button"
                                                onClick={() => toggleExpand(a.userId)}
                                                className="flex items-start gap-3 text-left min-w-0 flex-1"
                                            >
                                                <span className="mt-1 shrink-0 text-[var(--foreground-muted)]">
                                                    {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                                                </span>
                                                <div className="min-w-0 space-y-1.5">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <p className={`font-semibold text-base ${colors.textPrimary}`}>
                                                            {a.fullName}
                                                        </p>
                                                        <span
                                                            className={`text-[10px] uppercase font-semibold tracking-wider px-2 py-0.5 rounded-full border ${statusClass(a.status)}`}
                                                        >
                                                            {a.status}
                                                        </span>
                                                        <span className="text-[10px] uppercase font-semibold tracking-wider px-2 py-0.5 rounded-full border border-[var(--border)] text-[var(--accent)] bg-[var(--accent-muted)]">
                                                            Admin
                                                        </span>
                                                    </div>
                                                    <p className={`text-sm ${colors.textMuted} break-words flex flex-wrap items-center gap-x-3 gap-y-1`}>
                                                        <span className="inline-flex items-center gap-1">
                                                            <Mail size={12} /> {a.email}
                                                        </span>
                                                        {a.contactNumber && (
                                                            <span className="inline-flex items-center gap-1">
                                                                <Phone size={12} /> {a.contactNumber}
                                                            </span>
                                                        )}
                                                    </p>
                                                    <p className={`text-xs ${colors.textMuted} flex flex-wrap items-center gap-x-3 gap-y-1`}>
                                                        <span className="inline-flex items-center gap-1">
                                                            <Building2 size={12} />
                                                            {a.organization?.organizationName ||
                                                                a.organizationId ||
                                                                "No organization"}
                                                        </span>
                                                        <span className="inline-flex items-center gap-1">
                                                            <Users size={12} />
                                                            {a.teamMemberCount ?? members.length} team member
                                                            {(a.teamMemberCount ?? members.length) === 1 ? "" : "s"}
                                                        </span>
                                                    </p>
                                                </div>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => toggleStatus(a.userId, a.status)}
                                                className="btn-secondary rounded-lg px-3 py-2 text-sm min-h-10 w-full sm:w-auto shrink-0"
                                            >
                                                {a.status === "active" ? (
                                                    <>
                                                        <UserX size={14} className="inline" /> Deactivate
                                                    </>
                                                ) : (
                                                    <>
                                                        <UserCheck size={14} className="inline" /> Activate
                                                    </>
                                                )}
                                            </button>
                                        </div>

                                        {open && (
                                            <div className="ml-0 sm:ml-8 space-y-4 pt-1">
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                                                    <Detail label="Username" value={a.username || "—"} muted={colors.textMuted} primary={colors.textPrimary} />
                                                    <Detail label="User ID" value={a.userId} muted={colors.textMuted} primary={colors.textPrimary} mono />
                                                    <Detail label="Account type" value={a.accountType || "—"} muted={colors.textMuted} primary={colors.textPrimary} />
                                                    <Detail label="Email verified" value={a.emailVerified ? "Yes" : "No"} muted={colors.textMuted} primary={colors.textPrimary} />
                                                    <Detail label="Created" value={formatDate(a.createdAt)} muted={colors.textMuted} primary={colors.textPrimary} />
                                                    <Detail label="Last login" value={formatDate(a.lastLogin)} muted={colors.textMuted} primary={colors.textPrimary} />
                                                    <Detail
                                                        label="Organization ID"
                                                        value={a.organizationId || "—"}
                                                        muted={colors.textMuted}
                                                        primary={colors.textPrimary}
                                                        mono
                                                    />
                                                    <Detail
                                                        label="Org plan"
                                                        value={a.organization?.subscriptionPlan || "—"}
                                                        muted={colors.textMuted}
                                                        primary={colors.textPrimary}
                                                    />
                                                    <Detail
                                                        label="Org status"
                                                        value={a.organization?.status || "—"}
                                                        muted={colors.textMuted}
                                                        primary={colors.textPrimary}
                                                    />
                                                    <Detail
                                                        label="Org contact"
                                                        value={a.organization?.contactEmail || "—"}
                                                        muted={colors.textMuted}
                                                        primary={colors.textPrimary}
                                                    />
                                                </div>

                                                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)]/50 overflow-hidden">
                                                    <div className="px-4 py-3 border-b border-[var(--border)] flex items-center gap-2">
                                                        <Users size={14} className="text-[var(--accent)]" />
                                                        <p className={`text-sm font-semibold ${colors.textPrimary}`}>
                                                            Team members ({members.length})
                                                        </p>
                                                    </div>
                                                    {members.length === 0 ? (
                                                        <p className={`px-4 py-5 text-sm ${colors.textMuted}`}>
                                                            No team members in this organization yet.
                                                        </p>
                                                    ) : (
                                                        <ul className="divide-y divide-[var(--border)]">
                                                            {members.map((m) => (
                                                                <li key={m.userId} className="px-4 py-3 space-y-1.5">
                                                                    <div className="flex flex-wrap items-center gap-2">
                                                                        <p className={`text-sm font-medium ${colors.textPrimary}`}>
                                                                            {m.fullName}
                                                                        </p>
                                                                        <span
                                                                            className={`text-[10px] uppercase font-semibold tracking-wider px-2 py-0.5 rounded-full border ${statusClass(m.status)}`}
                                                                        >
                                                                            {m.status}
                                                                        </span>
                                                                        <span className="text-[10px] uppercase font-semibold tracking-wider px-2 py-0.5 rounded-full border border-[var(--border)] text-[var(--foreground-muted)]">
                                                                            Team
                                                                        </span>
                                                                    </div>
                                                                    <p className={`text-xs ${colors.textMuted} break-words`}>
                                                                        {m.email}
                                                                        {m.username ? ` · @${m.username}` : ""}
                                                                        {m.contactNumber ? ` · ${m.contactNumber}` : ""}
                                                                    </p>
                                                                    <p className={`text-[11px] ${colors.textMuted} break-words`}>
                                                                        ID: <span className="font-mono">{m.userId}</span>
                                                                        {" · "}Created {formatDate(m.createdAt)}
                                                                        {" · "}Last login {formatDate(m.lastLogin)}
                                                                    </p>
                                                                    <p className={`text-[11px] ${colors.textMuted} break-words`}>
                                                                        Permissions: {permSummary(m.permissions)}
                                                                    </p>
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
        </div>
    );
}

function Detail({
    label,
    value,
    muted,
    primary,
    mono,
}: {
    label: string;
    value: string;
    muted: string;
    primary: string;
    mono?: boolean;
}) {
    return (
        <div className="rounded-lg border border-[var(--border)] px-3 py-2.5 bg-[var(--surface)]/40 min-w-0">
            <p className={`text-[10px] uppercase tracking-wider font-semibold ${muted}`}>{label}</p>
            <p className={`text-sm mt-0.5 break-all ${primary} ${mono ? "font-mono text-xs" : ""}`}>{value}</p>
        </div>
    );
}

export default function AdminsPage() {
    return (
        <ClientLayout>
            <AdminsContent />
        </ClientLayout>
    );
}
