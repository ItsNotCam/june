// author: Cam
import type { Metadata } from "next";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { ThemeToggleClient } from "@/components/theme/ThemeToggleClient";
import "./globals.css";
import { poppins, geistMono } from "@/app/typography";

export const metadata: Metadata = {
  title: "june.",
  description: "Your unified developer knowledge platform.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${poppins.variable} ${geistMono.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem themes={["light", "dark"]} scriptProps={{ suppressHydrationWarning: true }}>
          <div className="fixed top-3 right-3 z-50">
            <ThemeToggleClient />
          </div>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
