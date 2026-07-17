"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type FilterSelectOption = { value: string; label: string };

type FilterSelectProps = {
    label: string;
    value: string;
    onChange: (value: string) => void;
    options: FilterSelectOption[];
    className?: string;
    minWidth?: string;
    menuPlacement?: "top" | "bottom" | "auto";
    hideLabel?: boolean;
};

type MenuPos = { top: number; left: number; width: number; openUp: boolean };

export default function FilterSelect({
    label,
    value,
    onChange,
    options,
    className,
    minWidth = "min-w-[130px]",
    menuPlacement = "auto",
    hideLabel = false,
}: FilterSelectProps) {
    const [open, setOpen] = useState(false);
    const [mounted, setMounted] = useState(false);
    const [pos, setPos] = useState<MenuPos | null>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    const btnRef = useRef<HTMLButtonElement>(null);
    const menuRef = useRef<HTMLUListElement>(null);

    const selected = options.find((o) => o.value === value) || options[0];

    useEffect(() => {
        setMounted(true);
    }, []);

    const updatePos = () => {
        const btn = btnRef.current;
        if (!btn) return;
        const rect = btn.getBoundingClientRect();
        const menuH = Math.min(options.length * 40 + 12, 240);
        const spaceBelow = window.innerHeight - rect.bottom - 12;
        const spaceAbove = rect.top - 12;
        let openUp = false;
        if (menuPlacement === "top") openUp = true;
        else if (menuPlacement === "bottom") openUp = false;
        else openUp = spaceBelow < menuH && spaceAbove > spaceBelow;

        setPos({
            top: openUp ? rect.top - 6 : rect.bottom + 6,
            left: rect.left,
            width: Math.max(rect.width, 160),
            openUp,
        });
    };

    useLayoutEffect(() => {
        if (!open) return;
        updatePos();
        const onScroll = () => updatePos();
        window.addEventListener("resize", onScroll);
        window.addEventListener("scroll", onScroll, true);
        return () => {
            window.removeEventListener("resize", onScroll);
            window.removeEventListener("scroll", onScroll, true);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, options.length, menuPlacement]);

    useEffect(() => {
        if (!open) return;
        const onDocClick = (e: MouseEvent) => {
            const t = e.target as Node;
            if (rootRef.current?.contains(t) || menuRef.current?.contains(t)) return;
            setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") setOpen(false);
        };
        document.addEventListener("mousedown", onDocClick);
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("mousedown", onDocClick);
            document.removeEventListener("keydown", onKey);
        };
    }, [open]);

    const menu =
        open && mounted && pos
            ? createPortal(
                  <ul
                      ref={menuRef}
                      role="listbox"
                      style={{
                          position: "fixed",
                          top: pos.top,
                          left: pos.left,
                          width: pos.width,
                          zIndex: 9999,
                          transform: pos.openUp ? "translateY(-100%)" : undefined,
                      }}
                      className={cn(
                          "rounded-xl border border-[var(--border-strong)] py-1.5 max-h-60 overflow-y-auto shadow-2xl",
                          "bg-[var(--surface-2)] text-[var(--foreground)]"
                      )}
                  >
                      {options.map((opt) => {
                          const active = opt.value === value;
                          return (
                              <li key={opt.value || "__all__"} role="option" aria-selected={active}>
                                  <button
                                      type="button"
                                      onClick={() => {
                                          onChange(opt.value);
                                          setOpen(false);
                                      }}
                                      className={cn(
                                          "w-full text-left px-3.5 py-2.5 text-sm flex items-center justify-between gap-2 transition-colors",
                                          active
                                              ? "bg-[var(--accent-muted)] text-[var(--accent)]"
                                              : "text-[var(--foreground-secondary)] hover:bg-[var(--accent-muted)] hover:text-[var(--foreground)]"
                                      )}
                                  >
                                      <span className="truncate">{opt.label}</span>
                                      {active && <Check size={14} className="text-[var(--accent)] shrink-0" />}
                                  </button>
                              </li>
                          );
                      })}
                  </ul>,
                  document.body
              )
            : null;

    return (
        <div ref={rootRef} className={cn("flex flex-col gap-1", className)}>
            {!hideLabel && label && (
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--foreground-muted)] ml-0.5">
                    {label}
                </span>
            )}
            <div className={cn("relative", minWidth)}>
                <button
                    ref={btnRef}
                    type="button"
                    onClick={() => setOpen((v) => !v)}
                    className={cn(
                        "premium-input w-full rounded-xl py-2.5 pl-3 pr-9 text-sm text-left",
                        "flex items-center justify-between gap-2",
                        open && "border-[var(--accent)] ring-[3px] ring-[var(--accent-ring)]"
                    )}
                    aria-haspopup="listbox"
                    aria-expanded={open}
                    aria-label={label}
                >
                    <span className="truncate">{selected?.label}</span>
                    <ChevronDown
                        size={14}
                        className={cn(
                            "absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--foreground-muted)] transition-transform shrink-0",
                            open && "rotate-180"
                        )}
                    />
                </button>
                {menu}
            </div>
        </div>
    );
}
