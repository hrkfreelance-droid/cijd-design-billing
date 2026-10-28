"use client";

import { parseCambodianPatent, type PatentCandidate } from "./patent-import";

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
    throw new Error("Please choose a PDF file.");
  }
  if (file.size === 0 || file.size > 20 * 1024 * 1024) {
    throw new Error("Choose a PDF between 1 byte and 20 MB.");
  }

  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  try {
    const pdf = await task.promise;
    if (pdf.numPages > 15) throw new Error("This PDF has too many pages (maximum 15).");
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
      throw new Error("No selectable text in this PDF. Please enter details manually; scanned documents need separate OCR.");
    }
    const candidate = parseCambodianPatent(raw);
    if (!candidate.tin || !candidate.enterpriseName) {
      throw new Error("Could not reliably find the company name and Tax ID. Enter them manually.");
    }
    return { file, candidate };
  } finally {
    await task.destroy();
  }
}
