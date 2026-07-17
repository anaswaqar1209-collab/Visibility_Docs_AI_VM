"use client";

import React from "react";
import { Loader2, Send } from "lucide-react";
import { cn } from "@/lib/utils";

type ChatComposerProps = {
    value: string;
    onChange: (value: string) => void;
    onSend: () => void;
    sending?: boolean;
    placeholder?: string;
    className?: string;
};

export default function ChatComposer({
    value,
    onChange,
    onSend,
    sending = false,
    placeholder = "Ask about your documents…",
    className,
}: ChatComposerProps) {
    return (
        <div
            className={cn(
                "rounded-full border border-[var(--border)] bg-[var(--surface)] p-1.5 pl-5 flex items-center gap-2 shadow-[0_12px_40px_rgba(0,0,0,0.25)]",
                "focus-within:border-[var(--accent)] focus-within:ring-[3px] focus-within:ring-[var(--accent-ring)] transition-all",
                className
            )}
        >
            <textarea
                value={value}
                onChange={(e) => onChange(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        onSend();
                    }
                }}
                rows={1}
                disabled={sending}
                placeholder={placeholder}
                className="flex-1 bg-transparent border-0 outline-none resize-none text-sm text-[var(--foreground)] placeholder:text-[var(--foreground-muted)] py-2.5 min-h-[40px] max-h-32 disabled:opacity-60"
            />
            <button
                type="button"
                onClick={onSend}
                disabled={sending || !value.trim()}
                className="btn-gradient rounded-full h-10 w-10 flex items-center justify-center shrink-0 disabled:opacity-50"
                aria-label="Send message"
            >
                {sending ? <Loader2 size={17} className="animate-spin" /> : <Send size={17} />}
            </button>
        </div>
    );
}
