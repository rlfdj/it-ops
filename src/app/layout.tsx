import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Outfit } from "next/font/google";
import { getTheme } from "@/lib/preferences";
import { APP_NAME } from "@/lib/config";
import { getWorkspaceSettings } from "@/lib/queries/settings";
import "./globals.css";

const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

export async function generateMetadata(): Promise<Metadata> {
  let name = APP_NAME;
  try {
    name = (await getWorkspaceSettings()).workspaceName;
  } catch {
    // The default name keeps pages loading if settings cannot be read.
  }
  return {
    title: { default: name, template: `%s — ${name}` },
    description: "IT procurement, stock, license and on/offboarding operations.",
    robots: { index: false, follow: false },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F7F6F3" },
    { media: "(prefers-color-scheme: dark)", color: "#111214" },
  ],
};

// Applies the system preference before first paint when no theme cookie is set.
const systemThemeScript = `(function(){try{var d=document.documentElement;if(!d.classList.contains('light')&&!d.classList.contains('dark')&&window.matchMedia('(prefers-color-scheme: dark)').matches){d.classList.add('dark')}}catch(e){}})()`;

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const theme = await getTheme();
  return (
    <html
      lang="en-GB"
      className={`${geist.variable} ${geistMono.variable} ${outfit.variable} antialiased ${theme ?? ""}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: systemThemeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
