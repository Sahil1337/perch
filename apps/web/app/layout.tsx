import { THEME_BOOT_SCRIPT } from "@perch/ui";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "perch",
  description: "A small SQL client for Postgres and MySQL.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      className={`${geistSans.variable} ${geistMono.variable} dark h-full antialiased`}
      lang="en"
      // The boot script may take `dark` off before React hydrates, which is the point of it.
      suppressHydrationWarning
    >
      <head>
        {/* Blocking, and first: a theme applied after the first paint is a flash, not a theme. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="h-full overflow-hidden bg-background text-foreground">{children}</body>
    </html>
  );
}
