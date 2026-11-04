import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { PRODUCT_NAME, PRODUCT_TAGLINE } from "@/components/brand/logo";

import { THEME_SCRIPT } from "@/components/theme/theme";

import "./globals.css";

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: `${PRODUCT_NAME} · ${PRODUCT_TAGLINE}`,
    template: `%s · ${PRODUCT_NAME}`,
  },
  description:
    "Report campus maintenance problems once, have them routed to the right department, and follow every step until they are fixed.",
  applicationName: PRODUCT_NAME,
  // Coursework prototype: keep it out of search engines.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  // Light first: the browser chrome matches the canvas whatever the operating system prefers.
  themeColor: "#f8faf9",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The theme script may set data-theme before React hydrates, hence suppressHydrationWarning.
    <html
      lang="en"
      className={`${geist.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
