import type { Metadata, Viewport } from "next";
import { Inter, Manrope } from "next/font/google";
import { Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "next-themes";
import { QueryClientProviderWrapper } from "@/components/portal/Providers";

// Inter — body & data typography (highly readable at small sizes, great tabular figures)
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

// Manrope — display face for headings, KPI values and the wordmark
const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Drona Logitech — Centralized MIS",
  description:
    "The centralized Management Information System of Drona Logitech — one connected workspace for operational data, calculation, tracking, analytics and reporting.",
  icons: { icon: "/favicon.svg", apple: "/brand/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${inter.variable} ${manrope.variable} ${geistMono.variable} antialiased bg-background text-foreground font-sans`}
      >
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
          <QueryClientProviderWrapper>
            {children}
            <Toaster richColors position="bottom-right" closeButton />
          </QueryClientProviderWrapper>
        </ThemeProvider>
      </body>
    </html>
  );
}
