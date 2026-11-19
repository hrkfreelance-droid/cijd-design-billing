"use client";

import { parseCambodianPatent, type PatentCandidate } from "./patent-import";

export class PatentReadError extends Error {
  constructor(public readonly reason: "format" | "size" | "pages" | "scan" | "fields") {
    super(reason);
  }
}

export interface PatentDraft {
  file: File;
  candidate: PatentCandidate;
}

/**
 * Extract selectable text inside the browser. No document is sent to a
 * third-party OCR service. Scanned-only PDF files require manual entry.
 */
export async function inspectPatentPdf(file: File): Promise<PatentDraft> {
  if (!file.name.toLowerCase().endsWith(".pdf") || (file.type && file.type !== "application/pdf")) {
    throw new PatentReadError("format");
  }
  if (file.size === 0 || file.size > 20 * 1024 * 1024) {
    throw new PatentReadError("size");
  }

  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  try {
    const pdf = await task.promise;
    if (pdf.numPages > 15) throw new PatentReadError("pages");
    const pages: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      let value = "";
      for (const item of content.items) {
        if ("str" in item) value += item.str + (item.hasEOL ? "\n" : " ");
      }
      pages.push(value);
    }
    const raw = pages.join("\n");
    if (raw.trim().length < 30) {
      throw new PatentReadError("scan");
    }
    const candidate = parseCambodianPatent(raw);
    if (!candidate.tin || !candidate.enterpriseName) {
      throw new PatentReadError("fields");
    }
    return { file, candidate };
  } finally {
    await task.destroy();
  }
}
