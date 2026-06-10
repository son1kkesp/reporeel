import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "RepoReel — Convierte cualquier repo de GitHub en un tráiler",
    template: "%s · RepoReel",
  },
  description:
    "Pega un repo de GitHub y genera un tráiler vertical 9:16 listo para TikTok, Reels y Shorts. En un clic. Open source, por Cronhaus.",
  applicationName: "RepoReel",
  keywords: [
    "GitHub",
    "tráiler",
    "repo",
    "vídeo vertical",
    "9:16",
    "TikTok",
    "Reels",
    "Shorts",
    "open source",
    "Cronhaus",
  ],
  openGraph: {
    type: "website",
    title: "RepoReel — Convierte cualquier repo en un tráiler",
    description:
      "Pega un repo de GitHub y genera un tráiler vertical 9:16 en un clic.",
    siteName: "RepoReel",
    url: siteUrl,
  },
  twitter: {
    card: "summary_large_image",
    title: "RepoReel — Convierte cualquier repo en un tráiler",
    description:
      "Pega un repo de GitHub y genera un tráiler vertical 9:16 en un clic.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}
