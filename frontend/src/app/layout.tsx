import type { Metadata } from "next";
import { Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const plusJakarta = Plus_Jakarta_Sans({
    subsets: ["latin"],
    variable: "--font-plus-jakarta",
    display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
    subsets: ["latin"],
    variable: "--font-jetbrains",
    display: "swap",
});

export const metadata: Metadata = {
    title: "Visibility Docs AI",
    description:
        "Enterprise Document Intelligence Platform — Visibility Bots. Upload, understand, search, and chat with your documents.",
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html
            lang="en"
            data-theme="light"
            className={`${plusJakarta.variable} ${jetbrainsMono.variable}`}
            suppressHydrationWarning
        >
            <body className="antialiased font-sans" suppressHydrationWarning>
                {children}
            </body>
        </html>
    );
}
