"use client";

import React from "react";
import Image from "next/image";
import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { useTheme } from "@/context/ColorContext";
import SiteLogo from "@/assets/Logo/Logo Visibility Live_pixian_ai.png";

interface AuthLayoutProps {
    children: React.ReactNode;
    onBack?: () => void;
    showBack?: boolean;
    wide?: boolean;
}

export default function AuthLayout({ children, onBack, showBack = false, wide = false }: AuthLayoutProps) {
    const { theme } = useTheme();
    const isDark = theme.name === "dark";

    return (
        <div className="min-h-screen w-full flex flex-col p-4 sm:p-6 lg:p-8 relative overflow-x-hidden overflow-y-auto app-shell text-[var(--foreground)]">
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <motion.div
                    animate={{ opacity: [0.18, 0.28, 0.18], scale: [1, 1.1, 1] }}
                    transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
                    className="absolute -top-[25%] left-1/2 -translate-x-1/2 w-[85%] h-[55%] rounded-full blur-[120px] bg-teal-400/25"
                />
                <motion.div
                    animate={{ opacity: [0.1, 0.18, 0.1] }}
                    transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
                    className="absolute -bottom-[10%] -right-[5%] w-[50%] h-[50%] rounded-full blur-[100px] bg-cyan-500/20"
                />
                <motion.div
                    animate={{ opacity: [0.06, 0.12, 0.06] }}
                    transition={{ duration: 16, repeat: Infinity, ease: "easeInOut" }}
                    className="absolute top-[40%] -left-[10%] w-[40%] h-[40%] rounded-full blur-[90px] bg-sky-600/15"
                />
                <div
                    className="absolute inset-0 opacity-[0.04]"
                    style={{
                        backgroundImage:
                            "linear-gradient(rgba(255,255,255,0.45) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.45) 1px, transparent 1px)",
                        backgroundSize: "48px 48px",
                    }}
                />
            </div>

            <div className={`w-full relative z-10 m-auto py-4 ${wide ? "max-w-7xl" : "max-w-md"}`}>
                <div className="mb-6 text-center relative flex flex-col items-center">
                    <motion.div
                        initial={{ opacity: 0, y: -12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ type: "spring", stiffness: 120, delay: 0.05 }}
                    >
                        <div
                            className={`rounded-2xl p-3 border backdrop-blur-xl ${
                                isDark
                                    ? "bg-white/95 border-white/20 shadow-[0_20px_50px_rgba(0,0,0,0.4)]"
                                    : "bg-white border-slate-200 shadow-[0_12px_30px_rgba(15,23,42,0.1)]"
                            }`}
                        >
                            <Image src={SiteLogo} alt="Visibility Live" className="h-11 w-auto" priority />
                        </div>
                    </motion.div>

                    <motion.p
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.2 }}
                        className="mt-3 text-[10px] font-bold uppercase tracking-[0.22em] text-[var(--accent)]"
                    >
                        Visibility Docs AI
                    </motion.p>
                    <motion.p
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.28 }}
                        className="mt-1 text-xs text-[var(--foreground-muted)]"
                    >
                        Understand · Search · Automate
                    </motion.p>

                    {showBack && (
                        <motion.button
                            initial={{ opacity: 0, x: -8 }}
                            animate={{ opacity: 1, x: 0 }}
                            onClick={onBack}
                            className="absolute left-0 top-2 text-[var(--foreground-muted)] hover:text-[var(--accent)] transition-colors group flex items-center gap-2"
                        >
                            <div className="h-8 w-8 rounded-lg border border-[var(--border)] flex items-center justify-center group-hover:border-[var(--accent)] group-hover:bg-[var(--accent-muted)]">
                                <ArrowLeft size={14} />
                            </div>
                            <span className="text-[9px] font-bold uppercase tracking-[0.2em] hidden sm:block">Back</span>
                        </motion.button>
                    )}
                </div>

                <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1], delay: 0.1 }}
                    className="p-5 sm:p-7 rounded-2xl border border-[var(--border)] bg-[var(--gradient-surface)] backdrop-blur-xl shadow-[0_24px_60px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.06)]"
                    suppressHydrationWarning
                >
                    {children}
                </motion.div>

                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.4 }}
                    className="mt-5 text-center text-[var(--foreground-muted)] font-medium text-[9px] uppercase tracking-[0.22em]"
                >
                    Visibility Bots — Document Intelligence © 2026
                </motion.div>
            </div>
        </div>
    );
}
