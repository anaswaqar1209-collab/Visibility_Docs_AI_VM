"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import Sidebar from "./Sidebar";
import { ToastProvider } from "./Toast";
import { ColorProvider, useTheme } from "@/context/ColorContext";
import { PermissionsProvider, usePermissions } from "@/context/PermissionsContext";
import { GroqLimitProvider } from "./GroqLimitModal";
import { clearAuthState, hasValidAccessToken, canRefreshSession, getAuthValue } from "@/lib/authSession";

const PAGE_TITLES: Record<string, string> = {
    "/documents": "Documents",
    "/chat": "AI Chat",
    "/activity": "Activity",
    "/team": "Team",
    "/admin/admins": "Admins",
    "/admin/documents": "All Documents",
};

function resolvePageTitle(pathname: string | null): string {
    if (!pathname) return "Docs AI";
    if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
    if (pathname.startsWith("/documents")) return "Documents";
    if (pathname.startsWith("/chat")) return "AI Chat";
    if (pathname.startsWith("/activity")) return "Activity";
    if (pathname.startsWith("/team")) return "Team";
    if (pathname.startsWith("/admin")) return "Admin";
    return "Docs AI";
}

function Shell({ children }: { children: React.ReactNode }) {
    const { theme } = useTheme();
    const colors = theme.colors;
    const router = useRouter();
    const pathname = usePathname();
    const { ready, reload } = usePermissions();
    const [navOpen, setNavOpen] = useState(false);

    const closeNav = useCallback(() => setNavOpen(false), []);

    useEffect(() => {
        const token = getAuthValue("accessToken") || getAuthValue("token");
        if (!token || (!hasValidAccessToken() && !canRefreshSession())) {
            clearAuthState();
            router.replace("/login");
        }
    }, [router]);

    useEffect(() => {
        if (ready) reload();
    }, [pathname, ready, reload]);

    useEffect(() => {
        setNavOpen(false);
    }, [pathname]);

    if (!ready) {
        return (
            <div className="min-h-screen flex items-center justify-center app-shell text-[var(--foreground-muted)] relative">
                <div className="flex flex-col items-center gap-3 relative z-[1]">
                    <div className="spinner" />
                    <p className="text-sm">Loading workspace…</p>
                </div>
            </div>
        );
    }

    return (
        <div className={`h-screen flex overflow-hidden app-shell ${colors.textPrimary} relative`}>
            <Sidebar open={navOpen} onClose={closeNav} />
            <div className="flex-1 min-w-0 min-h-0 flex flex-col relative z-[1]">
                <header className="lg:hidden shrink-0 flex items-center gap-3 px-3 sm:px-4 py-2.5 border-b border-[var(--border)] bg-[var(--surface)]/95 backdrop-blur-md">
                    <button
                        type="button"
                        onClick={() => setNavOpen(true)}
                        className="btn-ghost rounded-lg p-2.5 min-h-11 min-w-11 flex items-center justify-center"
                        aria-label="Open menu"
                    >
                        <Menu size={20} />
                    </button>
                    <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold tracking-tight truncate">{resolvePageTitle(pathname)}</p>
                        <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--accent)] font-semibold">
                            Visibility
                        </p>
                    </div>
                </header>
                <main className="flex-1 min-h-0 min-w-0 overflow-y-auto app-main">{children}</main>
            </div>
        </div>
    );
}

export default function ClientLayout({ children }: { children: React.ReactNode }) {
    return (
        <ColorProvider>
            <ToastProvider>
                <PermissionsProvider>
                    <GroqLimitProvider>
                        <Shell>{children}</Shell>
                    </GroqLimitProvider>
                </PermissionsProvider>
            </ToastProvider>
        </ColorProvider>
    );
}
