import { THEME_BOOT_SCRIPT } from "@perch/ui";
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

// The product is "Perch"; the command, the scopes and `~/.perch` stay lowercase. The title is a
// template because the tab is the only label a local tool gets — with several windows open on
// several databases, "perch" on all of them is not a label at all.
//
// No canonical URL, no Open Graph: this is served from loopback by the user's own machine, so
// there is nothing to link to and nothing to unfurl.
export const metadata: Metadata = {
  title: { default: "Perch", template: "%s · Perch" },
  description: "A fast, local SQL client for Postgres and MySQL.",
  applicationName: "Perch",
  // The tab icon is `icon.svg`, next to this file. File-based metadata outranks an `icons` field
  // here, so declaring it twice would only emit the link twice.
};

/** Matches the app's own surfaces, so the browser chrome does not frame a dark UI in white. */
export const viewport: Viewport = {
  colorScheme: "dark light",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
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
