"use client";

import React, { createContext, useState, useContext, useEffect, ReactNode } from "react";

type ThemeColors = {
  textMuted: string;
  textPrimary: string;
  textSecondary: string;
  borderPrimary: string;
  [key: string]: string;
};

type Theme = {
  name: "dark" | "light";
  colors: ThemeColors;
};

type ColorContextValue = {
  theme: Theme;
  toggleTheme: () => void;
};

const themes: Record<"dark" | "light", Theme> = {
  dark: {
    name: "dark",
    colors: {
      bgPrimary: "bg-[var(--canvas)]",
      bgSecondary: "bg-[var(--surface-2)]",
      bgAppBar: "bg-[var(--surface)]",
      bgSidebar: "bg-[var(--surface)]",
      bgCard: "bg-[var(--surface)]",
      bgHover: "hover:bg-[var(--accent-muted)]",
      bgActive: "bg-[var(--accent)]",
      bgButton: "bg-[var(--surface-2)]",
      bgButtonHover: "hover:bg-[var(--surface-3)]",
      bgNotification: "bg-[var(--surface-2)]",
      bgProfile: "bg-[var(--surface-2)]",
      bgDialog: "bg-[var(--surface)]",

      textPrimary: "text-[var(--foreground)]",
      textSecondary: "text-[var(--foreground-secondary)]",
      textMuted: "text-[var(--foreground-muted)]",
      textInactive: "text-[var(--foreground-muted)]",
      textActive: "text-[#042f2e]",

      borderPrimary: "border-[var(--border)]",
      borderSecondary: "border-[var(--border)]",
      borderLight: "border-[var(--border)]",
      borderHover: "hover:border-[var(--border-strong)]",
      borderActive: "border-[var(--accent)]",
      borderActive1: "border-[var(--border-strong)]",

      gradientPrimary: "from-teal-300 via-teal-400 to-teal-500",
      gradientSecondary: "from-[var(--canvas)] via-[var(--surface)] to-[var(--canvas)]",
      gradientButton: "from-teal-400 via-teal-500 to-teal-600",

      iconPrimary: "text-[var(--foreground)]",
      iconSecondary: "text-[var(--foreground-muted)]",
      iconActive: "text-[#042f2e]",

      sidebarItemActive: "bg-gradient-to-r from-teal-500/20 to-cyan-500/10 text-[var(--accent)] border border-[rgba(45,212,191,0.3)] shadow-[0_0_20px_rgba(45,212,191,0.12)]",
      sidebarItemInactive: "text-[var(--foreground-secondary)] hover:bg-gradient-to-r hover:from-white/[0.04] hover:to-transparent hover:text-[var(--foreground)] border border-transparent",
      sidebarIconBgActive: "bg-gradient-to-br from-teal-400 to-teal-600 text-[#042f2e] shadow-sm shadow-teal-500/30",
      sidebarIconBgInactive: "bg-[var(--surface-2)] text-[var(--foreground-secondary)] border border-[var(--border)]",

      bgDarkPanel: "bg-[var(--surface)]",
      bgDarkPanelHover: "hover:bg-[var(--surface-2)]",
      bgGlassDark: "from-[var(--surface)] via-[var(--surface-2)] to-[var(--surface)]",
      bgGlassHeader: "from-[var(--surface-2)] via-[var(--surface)] to-[var(--surface-2)]",
      borderTransparent: "border-[var(--border)]",
      textGradientBlue: "from-teal-300 to-cyan-200",
      textGradientPurple: "from-teal-400 to-teal-200",
      statusIndicator: "text-[var(--foreground-secondary)]",
      chartGridColor: "stroke-slate-700",
      chartAxisColor: "stroke-slate-500",

      bgDarkPanel1: "bg-[var(--surface-2)]",
      bgDarkPanel2: "bg-[var(--surface-3)]",
      bgDarkPanel3: "bg-[var(--canvas)]",
      bgDarkPanel4: "bg-[var(--surface)]",
      groupHoverPrimary: "group-hover:text-[var(--accent)]",

      bgGlassPanel: "bg-[var(--surface)]/80",
      backdropBlur: "backdrop-blur-md",
      bgGradientCircle: "bg-gradient-to-br from-teal-500/10 via-transparent to-transparent",

      bgButtonDisabled: "bg-teal-500/15",
      bgButtonDisabledRed: "bg-rose-500/15",
      bgButtonEnabled: "bg-gradient-to-br from-teal-500/25 via-teal-500/15 to-transparent",
      bgButtonEnabledRed: "bg-gradient-to-br from-rose-500/25 via-rose-500/15 to-transparent",
      bgButtonHoverBlue: "hover:bg-teal-500/20",
      bgButtonHoverRed: "hover:bg-rose-500/20",
      textButtonDisabled: "text-teal-300/60",
      textButtonDisabledRed: "text-rose-300/60",
      textButtonEnabled: "text-teal-100",
      textButtonEnabledRed: "text-rose-100",
      borderBlue: "border-teal-500/30",
      borderRed: "border-rose-500/30",
      borderBlueInner: "border-teal-400/30",
      borderRedInner: "border-rose-400/30",
      bgIconBlue: "bg-teal-500/15",
      bgIconRed: "bg-rose-500/15",
      bgIconGreen: "bg-emerald-500/15",
      textStatusGreen: "text-emerald-400",
      textStatusRed: "text-rose-400",
      textBlue: "text-teal-300",
      textRed: "text-rose-300",
      bgGradientBlue: "bg-gradient-to-br from-teal-400/10 via-transparent to-transparent",
      bgGradientRed: "bg-gradient-to-br from-rose-400/10 via-transparent to-transparent",
      bgCardDark: "bg-[var(--surface)]",
      textError: "text-rose-400",
      textSuccess: "text-emerald-400",
      bgButtonSuccess: "bg-emerald-900/40",
      bgButtonError: "bg-rose-900/40",
      textButtonSuccess: "text-emerald-300",
      textButtonError: "text-rose-300",
      accent: "text-[var(--accent)]",
      accentBg: "bg-[var(--accent)]",
      accentMuted: "bg-[var(--accent-muted)]",
    },
  },
  light: {
    name: "light",
    colors: {
      bgPrimary: "bg-[var(--canvas)]",
      bgSecondary: "bg-[var(--surface-2)]",
      bgAppBar: "bg-[var(--surface)]",
      bgSidebar: "bg-[var(--surface)]",
      bgCard: "bg-[var(--surface)]",
      bgHover: "hover:bg-[var(--accent-muted)]",
      bgActive: "bg-[var(--accent)]",
      bgButton: "bg-[var(--surface-2)]",
      bgButtonHover: "hover:bg-[var(--surface-3)]",
      bgNotification: "bg-[var(--surface)]",
      bgProfile: "bg-[var(--surface)]",
      bgDialog: "bg-[var(--surface)]",

      textPrimary: "text-[var(--foreground)]",
      textSecondary: "text-[var(--foreground-secondary)]",
      textMuted: "text-[var(--foreground-muted)]",
      textInactive: "text-[var(--foreground-muted)]",
      textActive: "text-white",

      borderPrimary: "border-[var(--border)]",
      borderSecondary: "border-[var(--border)]",
      borderLight: "border-[var(--border)]",
      borderHover: "hover:border-[var(--border-strong)]",
      borderActive: "border-[var(--accent)]",
      borderActive1: "border-[var(--border-strong)]",

      gradientPrimary: "from-teal-600 via-teal-700 to-teal-800",
      gradientSecondary: "from-white via-slate-50 to-white",
      gradientButton: "from-teal-500 via-teal-600 to-teal-700",

      iconPrimary: "text-[var(--foreground)]",
      iconSecondary: "text-[var(--foreground-muted)]",
      iconActive: "text-white",

      sidebarItemActive: "bg-gradient-to-r from-teal-50 to-cyan-50 text-[var(--accent)] border border-[rgba(13,148,136,0.25)] shadow-sm",
      sidebarItemInactive: "text-[var(--foreground-secondary)] hover:bg-slate-100 border border-transparent",
      sidebarIconBgActive: "bg-gradient-to-br from-teal-500 to-teal-700 text-white shadow-sm",
      sidebarIconBgInactive: "bg-teal-50 text-teal-700 border border-teal-100",

      bgDarkPanel: "bg-[var(--surface)]",
      bgDarkPanelHover: "hover:bg-[var(--surface-2)]",
      bgGlassDark: "from-white via-slate-50 to-white",
      bgGlassHeader: "from-white via-slate-50 to-white",
      borderTransparent: "border-[var(--border)]",
      textGradientBlue: "from-teal-600 to-cyan-500",
      textGradientPurple: "from-teal-700 to-teal-500",
      statusIndicator: "text-[var(--foreground-secondary)]",
      chartGridColor: "stroke-slate-300",
      chartAxisColor: "stroke-slate-400",

      bgDarkPanel1: "bg-[var(--surface-2)]",
      bgDarkPanel2: "bg-[var(--surface-3)]",
      bgDarkPanel3: "bg-[var(--canvas)]",
      bgDarkPanel4: "bg-[var(--surface)]",
      groupHoverPrimary: "group-hover:text-[var(--accent)]",

      bgGlassPanel: "bg-white/80",
      backdropBlur: "backdrop-blur-md",
      bgGradientCircle: "bg-gradient-to-br from-teal-500/10 via-transparent to-transparent",

      bgButtonDisabled: "bg-teal-100",
      bgButtonDisabledRed: "bg-rose-100",
      bgButtonEnabled: "bg-gradient-to-br from-teal-100 via-teal-50 to-transparent",
      bgButtonEnabledRed: "bg-gradient-to-br from-rose-100 via-rose-50 to-transparent",
      bgButtonHoverBlue: "hover:bg-teal-100",
      bgButtonHoverRed: "hover:bg-rose-100",
      textButtonDisabled: "text-teal-500",
      textButtonDisabledRed: "text-rose-500",
      textButtonEnabled: "text-teal-800",
      textButtonEnabledRed: "text-rose-800",
      borderBlue: "border-teal-300",
      borderRed: "border-rose-300",
      borderBlueInner: "border-teal-400",
      borderRedInner: "border-rose-400",
      bgIconBlue: "bg-teal-100",
      bgIconRed: "bg-rose-100",
      bgIconGreen: "bg-emerald-100",
      textStatusGreen: "text-emerald-600",
      textStatusRed: "text-rose-600",
      textBlue: "text-teal-700",
      textRed: "text-rose-600",
      bgGradientBlue: "bg-gradient-to-br from-teal-200/30 via-transparent to-transparent",
      bgGradientRed: "bg-gradient-to-br from-rose-200/30 via-transparent to-transparent",
      bgCardDark: "bg-[var(--surface)]",
      textError: "text-rose-600",
      textSuccess: "text-emerald-600",
      bgButtonSuccess: "bg-emerald-100",
      bgButtonError: "bg-rose-100",
      textButtonSuccess: "text-emerald-700",
      textButtonError: "text-rose-700",
      accent: "text-[var(--accent)]",
      accentBg: "bg-[var(--accent)]",
      accentMuted: "bg-[var(--accent-muted)]",
    },
  },
};

const ColorContext = createContext<ColorContextValue | null>(null);

export const useTheme = (): ColorContextValue => {
  const context = useContext(ColorContext);
  if (!context) {
    throw new Error("useTheme must be used within a ColorProvider");
  }
  return context;
};

export const ColorProvider = ({ children }: { children: ReactNode }) => {
  const [currentTheme, setCurrentTheme] = useState<Theme>(themes.light);

  useEffect(() => {
    const savedTheme = typeof window !== "undefined" ? localStorage.getItem("theme") : null;
    if (savedTheme === "dark") {
      setCurrentTheme(themes.dark);
    } else {
      setCurrentTheme(themes.light);
      if (!savedTheme) localStorage.setItem("theme", "light");
    }
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const isDark = currentTheme.name === "dark";
      document.documentElement.classList.toggle("dark", isDark);
      document.documentElement.setAttribute("data-theme", currentTheme.name);
    }
  }, [currentTheme]);

  const toggleTheme = () => {
    const newTheme = currentTheme.name === "dark" ? themes.light : themes.dark;
    setCurrentTheme(newTheme);
    localStorage.setItem("theme", newTheme.name);
  };

  return (
    <ColorContext.Provider value={{ theme: currentTheme, toggleTheme }}>
      {children}
    </ColorContext.Provider>
  );
};

export default ColorContext;
