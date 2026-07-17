"use client";

import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, Plus, RefreshCw, UserCheck, UserX } from "lucide-react";
import ClientLayout from "@/components/ClientLayout";
import { useToast } from "@/components/Toast";
import { PageHeader } from "@/components/ui";
import { useTheme } from "@/context/ColorContext";
import { apiRequest } from "@/lib/apiClient";
import { enrichUserFromToken } from "@/lib/auth";
import { getAuthValue, getStoredUser } from "@/lib/authSession";
import { DEFAULT_TEAM_PERMS, TEAM_PERM_LABELS } from "@/lib/permissions";

type Member = {
    userId: string;
    fullName: string;
    email: string;
    status: string;
    permissions?: Record<string, boolean>;
};

function TeamContent() {
    const { theme } = useTheme();
    const colors = theme.colors;
    const { showToast } = useToast();
    const [members, setMembers] = useState<Member[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [showForm, setShowForm] = useState(false);
    const [creating, setCreating] = useState(false);
    const [form, setForm] = useState({ fullName: "", email: "", password: "" });
    const [editingPerms, setEditingPerms] = useState<string | null>(null);
    const [permDraft, setPermDraft] = useState<Record<string, boolean> | null>(null);
    const [savingPerms, setSavingPerms] = useState(false);
    const [hasOrganization, setHasOrganization] = useState(true);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await apiRequest("/docs/team/members");
            setMembers(data?.data?.members || []);
            setError(null);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        const token = getAuthValue("accessToken") || getAuthValue("token");
        const stored = getStoredUser<any>();
        const user = enrichUserFromToken(stored, token);
        setHasOrganization(!!user?.organizationId);

        (async () => {
            try {
                const me = await apiRequest("/auth/me");
                const orgId = me?.data?.user?.organizationId;
                if (orgId !== undefined) setHasOrganization(!!orgId);
            } catch {
                // keep stored-user fallback
            }
        })();
    }, []);

    useEffect(() => { load(); }, [load]);

    const createMember = async (e: React.FormEvent) => {
        e.preventDefault();
        setCreating(true);
        setError(null);
        setSuccess(null);
        try {
            const data = await apiRequest("/docs/team/members", { method: "POST", body: JSON.stringify(form) });
            setForm({ fullName: "", email: "", password: "" });
            setShowForm(false);
            const msg = data?.message
                || (data?.data?.openRemoteSynced
                    ? "Member created in OpenRemote and database"
                    : "Member created in database only (OpenRemote unavailable)");
            setSuccess(msg);
            showToast(msg, "success");
            await load();
        } catch (e: any) {
            const msg = e.message || "Failed to create team member";
            setError(msg);
            showToast(msg, "error");
        } finally {
            setCreating(false);
        }
    };

    const toggleStatus = async (userId: string, status: string) => {
        const next = status === "active" ? "blocked" : "active";
        await apiRequest(`/docs/team/members/${userId}/status`, { method: "PATCH", body: JSON.stringify({ status: next }) });
        await load();
    };

    const openPermissions = (m: Member) => {
        if (editingPerms === m.userId) {
            setEditingPerms(null);
            setPermDraft(null);
            return;
        }
        const draft: Record<string, boolean> = {};
        for (const { key } of TEAM_PERM_LABELS) {
            draft[key] =
                typeof m.permissions?.[key] === "boolean"
                    ? m.permissions[key]
                    : (DEFAULT_TEAM_PERMS[key] ?? true);
        }
        setPermDraft(draft);
        setEditingPerms(m.userId);
    };

    const savePermissions = async (userId: string) => {
        if (!permDraft) return;
        setSavingPerms(true);
        setError(null);
        try {
            const data = await apiRequest(`/docs/team/members/${userId}/permissions`, {
                method: "PATCH",
                body: JSON.stringify({ permissions: permDraft }),
            });
            const updated = data?.data?.member;
            if (updated) {
                setMembers((prev) =>
                    prev.map((m) => (m.userId === userId ? { ...m, permissions: updated.permissions } : m))
                );
            }
            setSuccess("Permissions saved.");
            showToast("Permissions saved", "success");
            setEditingPerms(null);
            setPermDraft(null);
        } catch (e: any) {
            const msg = e.message || "Failed to save permissions";
            setError(msg);
            showToast(msg, "error");
        } finally {
            setSavingPerms(false);
        }
    };

    const removeMember = async (userId: string) => {
        if (!confirm("Remove this team member?")) return;
        await apiRequest(`/docs/team/members/${userId}`, { method: "DELETE" });
        await load();
    };

    return (
        <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto space-y-6 animate-fade-in-up">
            <PageHeader
                title="Team"
                subtitle="Add members and set permissions"
                actions={
                    <div className="flex gap-2">
                        <button type="button" onClick={load} className="btn-secondary rounded-xl px-4 py-2 text-sm"><RefreshCw size={14} className="inline mr-1" />Refresh</button>
                        <button type="button" onClick={() => setShowForm(!showForm)} className="btn-gradient rounded-xl px-4 py-2 text-sm" disabled={!hasOrganization}><Plus size={14} className="inline mr-1" />Add member</button>
                    </div>
                }
            />

            {!hasOrganization && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200 flex items-start gap-2">
                    <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                    <div>
                        <p className="font-medium">No organization linked to this admin account</p>
                        <p className="text-amber-200/80 mt-1">
                            Team members cannot be created until an organization is assigned. Run the seed script or contact a super admin.
                        </p>
                    </div>
                </div>
            )}

            {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 text-red-300 px-4 py-3 text-sm">{error}</div>}
            {success && <div className="rounded-xl border border-green-500/30 bg-green-500/10 text-green-300 px-4 py-3 text-sm">{success}</div>}

            {showForm && hasOrganization && (
                <form onSubmit={createMember} className="surface-card p-6 space-y-4">
                    <div className="flex flex-col gap-1">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 ml-0.5">Full name</span>
                        <input
                            className="w-full premium-input rounded-xl px-4 py-3 text-sm h-[42px]"
                            placeholder="Jane Doe"
                            value={form.fullName}
                            onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                            autoComplete="name"
                            required
                        />
                    </div>
                    <div className="flex flex-col gap-1">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 ml-0.5">Email</span>
                        <input
                            className="w-full premium-input rounded-xl px-4 py-3 text-sm h-[42px]"
                            placeholder="member@company.com"
                            type="email"
                            value={form.email}
                            onChange={(e) => setForm({ ...form, email: e.target.value })}
                            autoComplete="off"
                            required
                        />
                    </div>
                    <div className="flex flex-col gap-1">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 ml-0.5">Password</span>
                        <input
                            className="w-full premium-input rounded-xl px-4 py-3 text-sm h-[42px]"
                            placeholder="Temporary password"
                            type="password"
                            value={form.password}
                            onChange={(e) => setForm({ ...form, password: e.target.value })}
                            autoComplete="new-password"
                            required
                        />
                    </div>
                    <button
                        type="submit"
                        disabled={creating}
                        className="btn-gradient rounded-xl px-4 py-2.5 text-sm inline-flex items-center gap-2 disabled:opacity-50"
                    >
                        {creating && <Loader2 size={14} className="animate-spin" />}
                        {creating ? "Creating…" : "Create team member"}
                    </button>
                </form>
            )}

            <div className="surface-card overflow-hidden">
                {loading ? <div className={`p-8 text-sm ${colors.textMuted}`}>Loading…</div> : (
                    <ul className="divide-y divide-white/5">
                        {members.map((m) => (
                            <li key={m.userId} className="p-5 space-y-3">
                                <div className="flex flex-wrap justify-between gap-3">
                                    <div className="min-w-0 flex-1">
                                        <p className={`font-semibold ${colors.textPrimary}`}>{m.fullName}</p>
                                        <p className={`text-sm ${colors.textMuted} break-words`}>{m.email} · <span className={m.status === "active" ? "text-green-400" : "text-red-400"}>{m.status}</span></p>
                                    </div>
                                    <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                                        <button type="button" onClick={() => toggleStatus(m.userId, m.status)} className="btn-secondary rounded-lg px-3 py-2 text-sm min-h-10">
                                            {m.status === "active" ? <><UserX size={14} className="inline" /> Deactivate</> : <><UserCheck size={14} className="inline" /> Activate</>}
                                        </button>
                                        <button type="button" onClick={() => openPermissions(m)} className="btn-secondary rounded-lg px-3 py-2 text-sm min-h-10">Permissions</button>
                                        <button type="button" onClick={() => removeMember(m.userId)} className="btn-ghost text-red-300 rounded-lg px-3 py-2 text-sm min-h-10">Remove</button>
                                    </div>
                                </div>
                                {editingPerms === m.userId && permDraft && (
                                    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 space-y-3">
                                        <p className={`text-xs ${colors.textMuted}`}>
                                            Toggle permissions below, then click Save. Unchecked features are hidden for that team member.
                                        </p>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                            {TEAM_PERM_LABELS.map(({ key, label, hint }) => (
                                                <label
                                                    key={key}
                                                    className={`flex items-start gap-2.5 rounded-lg px-3 py-2.5 border border-white/10 cursor-pointer hover:bg-white/5 ${colors.textSecondary}`}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        className="mt-0.5 accent-teal-500"
                                                        checked={permDraft[key] ?? false}
                                                        onChange={(e) =>
                                                            setPermDraft((prev) =>
                                                                prev ? { ...prev, [key]: e.target.checked } : prev
                                                            )
                                                        }
                                                    />
                                                    <span>
                                                        <span className={`block text-sm font-medium ${colors.textPrimary}`}>{label}</span>
                                                        {hint && <span className={`block text-[11px] ${colors.textMuted}`}>{hint}</span>}
                                                    </span>
                                                </label>
                                            ))}
                                        </div>
                                        <div className="flex gap-2 pt-1">
                                            <button
                                                type="button"
                                                disabled={savingPerms}
                                                onClick={() => savePermissions(m.userId)}
                                                className="btn-gradient rounded-lg px-4 py-2 text-sm inline-flex items-center gap-2 disabled:opacity-50"
                                            >
                                                {savingPerms && <Loader2 size={14} className="animate-spin" />}
                                                {savingPerms ? "Saving…" : "Save permissions"}
                                            </button>
                                            <button
                                                type="button"
                                                disabled={savingPerms}
                                                onClick={() => {
                                                    setEditingPerms(null);
                                                    setPermDraft(null);
                                                }}
                                                className="btn-secondary rounded-lg px-4 py-2 text-sm"
                                            >
                                                Cancel
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}

export default function TeamPage() {
    return <ClientLayout><TeamContent /></ClientLayout>;
}
