/**
 * Client-side PDF extraction (pdf.js, loaded only when the import dialog opens).
 *
 * The PDF never leaves the player's device: APEX reads form fields and page text in the
 * browser and only the values the player confirms in the review screen are sent to the server,
 * where they are validated again (parseSheet). Nothing is uploaded or stored as a file, so a
 * private character document cannot become publicly accessible.
 */
import type { Extracted } from './map';
import { extractWithPdfjs, PdfImportError, type PdfjsLike } from './pdfCore';

export { PdfImportError };

export const MAX_PDF_BYTES = 10 * 1024 * 1024;


/** Checks the real file type (magic bytes), not the file name or the browser's MIME guess. */
export function looksLikePdf(bytes: Uint8Array): boolean {
  // "%PDF-" may be preceded by a few junk bytes; the spec allows it within the first 1024 bytes.
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
  return head.includes('%PDF-');
}

export async function extractPdf(file: File): Promise<Extracted> {
  if (file.size > MAX_PDF_BYTES) throw new PdfImportError(`This file is too large (${(file.size / 1048576).toFixed(1)} MB). The limit is 10 MB.`);
  if (file.size < 64) throw new PdfImportError('This file is empty or damaged.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!looksLikePdf(bytes)) throw new PdfImportError('This is not a PDF file. Please choose a character sheet saved as PDF.');
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return extractWithPdfjs(pdfjs as unknown as PdfjsLike, bytes);
}
