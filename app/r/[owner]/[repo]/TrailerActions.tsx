"use client";

import { useState } from "react";
import { Check, Copy, Download, Share2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface TrailerActionsProps {
  /** URL absoluta a compartir (página /r/owner/repo). */
  shareUrl: string;
  /** URL del MP4 para descargar. */
  mp4Url: string;
  /** "owner/repo", usado para el nombre del archivo y el texto a compartir. */
  repo: string;
}

/**
 * Acciones del tráiler: descargar MP4 + compartir (Web Share API con
 * fallback a copiar el enlace al portapapeles).
 */
export function TrailerActions({ shareUrl, mp4Url, repo }: TrailerActionsProps) {
  const [copied, setCopied] = useState(false);

  const fileName = `reporeel-${repo.replace("/", "-")}.mp4`;

  async function onShare() {
    const shareData = {
      title: `Tráiler de ${repo} · RepoReel`,
      text: `Mira el tráiler de ${repo}, generado con RepoReel:`,
      url: shareUrl,
    };
    // Web Share API (móvil) si está disponible.
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share(shareData);
        return;
      } catch {
        // Cancelado o no soportado → cae al copiado.
      }
    }
    await copyLink();
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Sin permiso de portapapeles: no rompemos la UI.
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-center gap-3">
      <a
        href={mp4Url}
        download={fileName}
        className={cn(
          buttonVariants({ size: "lg" }),
          "gap-2 bg-brand text-brand-foreground hover:bg-brand/85",
        )}
      >
        <Download className="size-4" aria-hidden="true" />
        Descargar MP4
      </a>

      <Button type="button" variant="outline" size="lg" onClick={onShare} className="gap-2">
        <Share2 className="size-4" aria-hidden="true" />
        Compartir
      </Button>

      <Button
        type="button"
        variant="ghost"
        size="lg"
        onClick={copyLink}
        className="gap-2"
        aria-live="polite"
      >
        {copied ? (
          <>
            <Check className="size-4 text-brand" aria-hidden="true" />
            ¡Enlace copiado!
          </>
        ) : (
          <>
            <Copy className="size-4" aria-hidden="true" />
            Copiar enlace
          </>
        )}
      </Button>
    </div>
  );
}
