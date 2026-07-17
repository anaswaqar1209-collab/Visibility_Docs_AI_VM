import React from "react";
import { cn } from "@/lib/utils";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: ButtonVariant;
    size?: ButtonSize;
};

const variants: Record<ButtonVariant, string> = {
    primary:
        "bg-[var(--accent)] text-[#042f2e] hover:bg-[var(--accent-hover)] shadow-sm hover:shadow-[0_8px_24px_rgba(45,212,191,0.25)] dark:text-[#042f2e] [html[data-theme=light]_&]:text-white",
    secondary:
        "bg-[var(--btn-secondary-bg)] border border-[var(--btn-secondary-border)] text-[var(--btn-secondary-text)] hover:bg-[var(--btn-secondary-hover-bg)] hover:border-[var(--btn-secondary-hover-border)] hover:text-[var(--btn-secondary-hover-text)]",
    ghost:
        "bg-transparent text-[var(--foreground-muted)] hover:bg-[var(--accent-muted)] hover:text-[var(--accent)]",
    danger:
        "bg-[var(--error-muted)] border border-[rgba(248,113,113,0.3)] text-[var(--error)] hover:bg-rose-500/20",
};

const sizes: Record<ButtonSize, string> = {
    sm: "h-8 px-3 text-xs gap-1.5 rounded-[var(--radius-md)]",
    md: "h-10 px-4 text-sm gap-2 rounded-[var(--radius-md)]",
    lg: "h-11 px-5 text-sm gap-2 rounded-[var(--radius-lg)]",
};

export function Button({
    className,
    variant = "primary",
    size = "md",
    type = "button",
    disabled,
    children,
    ...props
}: ButtonProps) {
    return (
        <button
            type={type}
            disabled={disabled}
            className={cn(
                "inline-flex items-center justify-center font-semibold tracking-tight transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none",
                variants[variant],
                sizes[size],
                className
            )}
            {...props}
        >
            {children}
        </button>
    );
}
