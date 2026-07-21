"use client";

import React, { useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import {
    FileText,
    MessageSquare,
    LogOut,
    Moon,
    Sun,
    Shield,
    FolderOpen,
    Activity,
    X,
    Building2,
    ChevronDown,
    Settings,
} from "lucide-react";
import { useTheme } from "@/context/ColorContext";
import { usePermissions } from "@/context/PermissionsContext";
import { clearAuthState, getStoredUser } from "@/lib/authSession";
import { apiRequest } from "@/lib/apiClient";
import SiteLogo from "@/assets/Logo/Logo Visibility Live_pixian_ai.png";
import { cn } from "@/lib/utils";

type StoredUser = {
    fullName?: string;
    email?: string;
    username?: string;
    role?: string;
};

type DeptNav = { departmentId: string; name: string };

type SidebarProps = {
    open?: boolean;
    onClose?: () => void;
};

export default function Sidebar({ open = false, onClose }: SidebarProps) {
    const pathname = usePathname();
    const router = useRouter();
    const { theme, toggleTheme } = useTheme();
    const colors = theme.colors;
    const isDark = theme.name === "dark";
    const user = getStoredUser<StoredUser>();
    const { role: permRole, canChat, canUpload, canViewDocs, hasPermission } = usePermissions();
    const role = permRole || user?.role || "team";

    const [deptOpen, setDeptOpen] = React.useState(true);
    const [departments, setDepartments] = React.useState<DeptNav[]>([]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await apiRequest("/docs/departments");
                if (!cancelled) setDepartments(res?.data?.departments || []);
            } catch {
                if (!cancelled) setDepartments([]);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [role]);

    const isSuperAdmin = role === "superAdmin";
    const canSeeDepts =
        role === "admin" ||
        isSuperAdmin ||
        hasPermission("department.view") ||
        hasPermission("department.manage");

    const nav: {
        href: string;
        label: string;
        icon: React.ElementType;
        roles: string[];
        allow?: () => boolean;
    }[] = [
        {
            href: "/documents",
            label: "Documents",
            icon: FileText,
            roles: ["superAdmin", "admin", "team", "service_account"],
            allow: () => canViewDocs() || canUpload() || role === "admin" || role === "superAdmin",
        },
        {
            href: "/admin/documents",
            label: "All Documents",
            icon: FolderOpen,
            roles: ["superAdmin"],
        },
        {
            href: "/activity",
            label: "Activity",
            icon: Activity,
            roles: ["superAdmin", "admin", "team"],
        },
        { href: "/admin/admins", label: "Admins", icon: Shield, roles: ["superAdmin"] },
        {
            href: "/chat",
            label: "AI Chat",
            icon: MessageSquare,
            roles: ["superAdmin", "admin", "team", "service_account"],
            allow: () => canChat(),
        },
        {
            href: "/admin/departments",
            label: "Departments",
            icon: Building2,
            roles: ["admin", "superAdmin"],
            allow: () => role === "admin" || role === "superAdmin" || hasPermission("department.manage"),
        },
        {
            href: "/admin/settings",
            label: "AI Settings",
            icon: Settings,
            roles: ["admin", "superAdmin"],
            allow: () => role === "admin" || role === "superAdmin",
        },
    ];

    const visibleNav = nav
        .filter((n) => n.roles.includes(role) && (n.allow ? n.allow() : true))
        .filter((n) =>
            !isSuperAdmin || ["/admin/documents", "/chat", "/activity", "/admin/admins", "/admin/settings"].includes(n.href)
        );

    const logout = () => {
        clearAuthState();
        router.replace("/login");
    };

    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose?.();
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [open, onClose]);

    return (
        <>
            <button
                type="button"
                className={cn(
                    "lg:hidden fixed inset-0 z-40 bg-black/50 backdrop-blur-sm transition-opacity",
                    open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
                )}
                aria-label="Close menu"
                onClick={onClose}
                tabIndex={open ? 0 : -1}
            />

            <aside
                className={cn(
                    "w-64 h-full border-r border-[var(--border)] app-sidebar flex flex-col overflow-hidden",
                    "shadow-[4px_0_24px_rgba(0,0,0,0.2)] relative",
                    "fixed inset-y-0 left-0 z-50 transition-transform duration-200 ease-out",
                    "lg:static lg:z-10 lg:translate-x-0 lg:shrink-0",
                    open ? "translate-x-0" : "-translate-x-full"
                )}
            >
                <div className="absolute inset-0 pointer-events-none bg-gradient-to-b from-teal-500/[0.06] via-transparent to-cyan-500/[0.04]" />
                <div className="px-5 py-5 border-b border-[var(--border)] relative z-[1] flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="rounded-xl p-2 bg-white shadow-sm ring-1 ring-black/5 shrink-0">
                            <Image src={SiteLogo} alt="Visibility" className="h-8 w-auto" priority />
                        </div>
                        <div className="min-w-0">
                            <p className="text-sm font-bold tracking-tight text-[var(--foreground)]">Docs AI</p>
                            <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--accent)] font-semibold">
                                Visibility
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="lg:hidden btn-ghost rounded-lg p-2.5 min-h-11 min-w-11 flex items-center justify-center shrink-0"
                        aria-label="Close menu"
                    >
                        <X size={18} />
                    </button>
                </div>

                <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto relative z-[1]">
                    {visibleNav.map(({ href, label, icon: Icon }) => {
                        const active = pathname === href || pathname?.startsWith(`${href}/`);
                        const showDeptDropdown = href === "/documents" && canSeeDepts && departments.length > 0;
                        return (
                            <div key={href}>
                                <div className="flex items-center gap-1">
                                    <Link
                                        href={href}
                                        onClick={() => onClose?.()}
                                        className={`flex-1 flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 min-h-11 ${
                                            active && !pathname?.startsWith("/departments/")
                                                ? colors.sidebarItemActive
                                                : colors.sidebarItemInactive
                                        }`}
                                    >
                                        <span
                                            className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${
                                                active && !pathname?.startsWith("/departments/")
                                                    ? colors.sidebarIconBgActive
                                                    : colors.sidebarIconBgInactive
                                            }`}
                                        >
                                            <Icon size={15} />
                                        </span>
                                        {label}
                                    </Link>
                                    {showDeptDropdown && (
                                        <button
                                            type="button"
                                            onClick={() => setDeptOpen((o) => !o)}
                                            className="p-2 rounded-lg min-h-11 min-w-11 flex items-center justify-center"
                                            style={{ color: "var(--foreground-muted)" }}
                                            aria-label="Toggle departments"
                                        >
                                            <ChevronDown
                                                size={16}
                                                className={cn("transition-transform", deptOpen ? "rotate-180" : "")}
                                            />
                                        </button>
                                    )}
                                </div>
                                {showDeptDropdown && deptOpen && (
                                    <div className="ml-4 pl-3 border-l border-[var(--border)] space-y-0.5 mb-1">
                                        {departments.map((d) => {
                                            const dActive = pathname === `/departments/${d.departmentId}`;
                                            return (
                                                <Link
                                                    key={d.departmentId}
                                                    href={`/departments/${d.departmentId}`}
                                                    onClick={() => onClose?.()}
                                                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium min-h-9 ${
                                                        dActive ? colors.sidebarItemActive : colors.sidebarItemInactive
                                                    }`}
                                                >
                                                    <Building2 size={12} className="shrink-0 opacity-70" />
                                                    <span className="truncate">{d.name}</span>
                                                </Link>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </nav>

                <div className="px-3 py-4 border-t border-[var(--border)] space-y-2 relative z-[1]">
                    <button
                        type="button"
                        onClick={toggleTheme}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors min-h-11 ${colors.sidebarItemInactive}`}
                    >
                        {isDark ? (
                            <Sun size={15} className="text-[var(--accent)]" />
                        ) : (
                            <Moon size={15} className="text-[var(--accent)]" />
                        )}
                        {isDark ? "Light mode" : "Dark mode"}
                    </button>
                    <div className="px-3 py-2.5 rounded-xl bg-[var(--surface-2)] border border-[var(--border)]">
                        <p className="text-xs font-semibold text-[var(--foreground)] truncate">
                            {user?.fullName || user?.username}
                        </p>
                        <p className="text-[11px] text-[var(--foreground-muted)] truncate mt-0.5">{user?.email}</p>
                        <p className="mt-1.5 text-[10px] uppercase tracking-[0.12em] font-mono text-[var(--accent)]">
                            {role}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={logout}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-rose-400 hover:bg-rose-500/10 transition-colors min-h-11"
                    >
                        <LogOut size={15} />
                        Sign out
                    </button>
                </div>
            </aside>
        </>
    );
}
