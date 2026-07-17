import React from "react";
import { cn } from "@/lib/utils";

type BadgeVariant = "default" | "accent" | "success" | "warning" | "error" | "muted";

const variants: Record<BadgeVariant, string> = {
    default: "bg-[var(--surface-3)] text-[var(--foreground-secondary)] border-[var(--border)]",
    accent: "bg-[var(--accent-muted)] text-[var(--accent)] border-[rgba(45,212,191,0.25)]",
    success: "bg-[var(--success-muted)] text-[var(--success)] border-[rgba(52,211,153,0.25)]",
    warning: "bg-[var(--warning-muted)] text-[var(--warning)] border-[rgba(251,191,36,0.25)]",
    error: "bg-[var(--error-muted)] text-[var(--error)] border-[rgba(248,113,113,0.25)]",
    muted: "bg-white/[0.04] text-[var(--foreground-muted)] border-[var(--border)]",
};

export function Badge({
    className,
    variant = "default",
    children,
}: {
    className?: string;
    variant?: BadgeVariant;
    children: React.ReactNode;
}) {
    return (
        <span
            className={cn(
                "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border whitespace-nowrap",
                variants[variant],
                className
            )}
        >
            {children}
        </span>
    );
}

export function StatusBadge({
    status,
    className,
}: {
    status: string;
    className?: string;
}) {
    const s = status.toLowerCase();
    let variant: BadgeVariant = "muted";
    if (s === "ready" || s === "processed" || s === "completed" || s === "complete" || s === "active") {
        variant = "success";
    } else if (s === "processing" || s === "uploaded" || s === "queued" || s === "running" || s === "pending") {
        variant = "warning";
    } else if (s === "failed" || s.includes("fail") || s.includes("error") || s === "inactive") {
        variant = "error";
    }
    return (
        <Badge variant={variant} className={className}>
            {status}
        </Badge>
    );
}
