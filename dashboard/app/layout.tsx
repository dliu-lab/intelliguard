import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { MouseTrail } from "@/components/MouseTrail";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "IntelliGuard | AI Governance Runtime",
  description:
    "Governance wired into AI runtime. Monitor agent actions, evaluate risk, enforce controls, and protect trust.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="scroll-smooth">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                var storedTheme = localStorage.getItem("intelliguard-theme");
                var theme = storedTheme === "light" || storedTheme === "dark"
                  ? storedTheme
                  : (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
                document.documentElement.dataset.theme = theme;
              } catch (error) {
                document.documentElement.dataset.theme = "dark";
              }
            `,
          }}
        />
      </head>
      <body className={`${inter.variable} ${jetbrainsMono.variable} bg-ink text-textPrimary antialiased`}>
        {children}
        <MouseTrail />
      </body>
    </html>
  );
}
