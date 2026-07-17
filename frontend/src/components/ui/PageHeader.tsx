import React from "react";
import { cn } from "@/lib/utils";

export function PageHeader({
    title,
    subtitle,
    actions,
    className,
}: {
    title: string;
    subtitle?: string;
    actions?: React.ReactNode;
    className?: string;
}) {
    return (
        <div className={cn("flex flex-wrap items-start justify-between gap-4", className)}>
            <div className="min-w-0">
                <h1 className="text-2xl font-bold tracking-tight text-[var(--foreground)]">{title}</h1>
                {subtitle && (
                    <p className="text-sm mt-1 text-[var(--foreground-muted)] leading-relaxed">{subtitle}</p>
                )}
            </div>
            {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
        </div>
    );
}

export function EmptyState({
    icon,
    title,
    description,
    action,
    className,
}: {
    icon?: React.ReactNode;
    title: string;
    description?: string;
    action?: React.ReactNode;
    className?: string;
}) {
    return (
        <div className={cn("flex flex-col items-center justify-center text-center py-14 px-6", className)}>
            {icon && (
                <div className="mb-4 w-12 h-12 rounded-2xl bg-[var(--accent-muted)] border border-[rgba(45,212,191,0.2)] flex items-center justify-center text-[var(--accent)]">
                    {icon}
                </div>
            )}
            <p className="text-base font-semibold text-[var(--foreground)]">{title}</p>
            {description && (
                <p className="text-sm mt-1.5 max-w-sm text-[var(--foreground-muted)] leading-relaxed">{description}</p>
            )}
            {action && <div className="mt-5">{action}</div>}
        </div>
    );
}

export function Toolbar({ children, className }: { children: React.ReactNode; className?: string }) {
    return (
        <div
            className={cn(
                "flex flex-wrap items-center gap-2.5 p-4 border-b border-[var(--border)] bg-[var(--surface)]/50",
                className
            )}
        >
            {children}
        </div>
    );
}
