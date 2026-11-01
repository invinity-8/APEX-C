/**
 * Client-side PDF extraction (pdf.js, loaded only when the import dialog opens).
 *
 * The PDF never leaves the player's device: APEX reads form fields and page text in the
 * browser and only the values the player confirms in the review screen are sent to the server,
 * where they are validated again (parseSheet). Nothing is uploaded or stored as a file, so a
 * private character document cannot become publicly accessible.
 */
import type { Extracted } from './map';

export const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAX_PAGES = 30;

export class PdfImportError extends Error {}

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

  const task = pdfjs.getDocument({ data: bytes, enableXfa: false, disableAutoFetch: true, stopAtErrors: false, useSystemFonts: false });
  let doc;
  try {
    doc = await task.promise;
  } catch (e) {
    const name = (e as { name?: string }).name ?? '';
    void task.destroy();
    if (name === 'PasswordException') throw new PdfImportError('This PDF is password-protected. Please remove the protection and try again.');
    throw new PdfImportError('This PDF could not be read. It may be damaged.');
  }
  try {
    const fields: Record<string, string> = {};
    const add = (name: unknown, value: unknown) => {
      if (typeof name !== 'string' || !name || name in fields) return;
      const v = Array.isArray(value) ? value.join(', ') : value;
      if (typeof v === 'string' || typeof v === 'number') fields[name] = String(v);
    };
    // Form fields (AcroForm). Values are read from the document, not computed by scripts.
    try {
      const objs = (await doc.getFieldObjects()) as unknown;
      const entries: Array<[string, unknown]> = objs instanceof Map ? [...objs.entries()] : objs && typeof objs === 'object' ? Object.entries(objs) : [];
      for (const [name, list] of entries) {
        for (const o of (Array.isArray(list) ? list : []) as Array<Record<string, unknown>>) {
          if (o.type === 'checkbox' || o.type === 'radiobutton' || o.type === 'button') continue;
          add(name, o.value ?? o.fieldValue);
        }
      }
    } catch {
      /* no form */
    }

    const pages = Math.min(doc.numPages, MAX_PAGES);
    const parts: string[] = [];
    for (let p = 1; p <= pages; p++) {
      const page = await doc.getPage(p);
      // Widget annotations as a fallback for forms pdf.js does not expose through getFieldObjects.
      try {
        for (const a of (await page.getAnnotations()) as Array<Record<string, unknown>>) {
          if (a.subtype === 'Widget' && a.fieldType === 'Tx') add(a.fieldName, a.fieldValue);
        }
      } catch {
        /* ignore */
      }
      const tc = await page.getTextContent();
      let line = '';
      for (const item of tc.items as Array<{ str?: string; hasEOL?: boolean }>) {
        if (typeof item.str !== 'string') continue;
        line += item.str;
        if (item.hasEOL) {
          parts.push(line);
          line = '';
        } else line += ' ';
      }
      if (line.trim()) parts.push(line);
      parts.push('');
    }
    const text = parts
      .map((l) => l.replace(/[ \t]+/g, ' ').trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .slice(0, 200_000);
    return { fields, text, pages: doc.numPages };
  } finally {
    void task.destroy();
  }
}
