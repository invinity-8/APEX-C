/**
 * PDF extraction core, independent of how pdf.js is loaded – the browser (extract.ts) and the
 * Node regression tests (tests/aurora.test.ts with the real sinna.pdf) run exactly this code.
 */
import type { Extracted, PositionedText } from './map';

const MAX_PAGES = 30;
const MAX_ITEMS_PER_PAGE = 5000;

/** Minimal surface of pdf.js that we use (keeps this module free of a hard pdf.js import). */
export interface PdfjsLike {
  getDocument(src: Record<string, unknown>): { promise: Promise<PdfDoc>; destroy(): Promise<void> | void };
}
interface PdfDoc {
  numPages: number;
  getFieldObjects(): Promise<unknown>;
  getPage(n: number): Promise<{
    getAnnotations(): Promise<unknown[]>;
    getTextContent(): Promise<{ items: unknown[] }>;
  }>;
}

export class PdfImportError extends Error {}

export async function extractWithPdfjs(pdfjs: PdfjsLike, bytes: Uint8Array): Promise<Extracted> {
  const task = pdfjs.getDocument({ data: bytes, enableXfa: false, disableAutoFetch: true, stopAtErrors: false, useSystemFonts: false, verbosity: 0 });
  let doc: PdfDoc;
  try {
    doc = await task.promise;
  } catch (e) {
    void task.destroy();
    if ((e as { name?: string }).name === 'PasswordException') throw new PdfImportError('This PDF is password-protected. Please remove the protection and try again.');
    throw new PdfImportError('This PDF could not be read. It may be damaged.');
  }
  try {
    const fields: Record<string, string> = {};
    const checkboxes: Record<string, boolean> = {};
    const add = (name: unknown, value: unknown) => {
      if (typeof name !== 'string' || !name || name in fields) return;
      const v = Array.isArray(value) ? value.join(', ') : value;
      if (typeof v === 'string' || typeof v === 'number') fields[name] = String(v);
    };
    // Form fields (AcroForm) – the actual data. Checkbox states are kept separately (proficiencies, prepared spells …).
    try {
      const objs = await doc.getFieldObjects();
      const entries: Array<[string, unknown]> = objs instanceof Map ? [...objs.entries()] : objs && typeof objs === 'object' ? Object.entries(objs) : [];
      for (const [name, list] of entries) {
        for (const o of (Array.isArray(list) ? list : []) as Array<Record<string, unknown>>) {
          if (o.type === 'checkbox' || o.type === 'radiobutton') {
            const v = String(o.value ?? '');
            if (!(name in checkboxes) || v !== 'Off') checkboxes[name] = v !== '' && v !== 'Off' && v !== 'false';
            continue;
          }
          if (o.type === 'button') continue;
          add(name, o.value ?? o.fieldValue);
        }
      }
    } catch {
      /* no form */
    }

    const pages = Math.min(doc.numPages, MAX_PAGES);
    const pageTexts: string[] = [];
    const positioned: PositionedText[][] = [];
    for (let p = 1; p <= pages; p++) {
      const page = await doc.getPage(p);
      try {
        for (const a of (await page.getAnnotations()) as Array<Record<string, unknown>>) {
          if (a.subtype === 'Widget' && a.fieldType === 'Tx') add(a.fieldName, a.fieldValue);
        }
      } catch {
        /* ignore */
      }
      const tc = await page.getTextContent();
      const lines: string[] = [];
      const placed: PositionedText[] = [];
      let line = '';
      for (const item of tc.items as Array<{ str?: string; hasEOL?: boolean; transform?: number[]; width?: number; height?: number }>) {
        if (typeof item.str !== 'string') continue;
        // Position of every text run (page coordinates) – lets printed / flattened Aurora sheets be read by layout.
        if (!item.str.trim() && item.hasEOL && placed.length) placed[placed.length - 1].eol = true;
        else if (item.str.trim() && Array.isArray(item.transform) && placed.length < MAX_ITEMS_PER_PAGE)
          placed.push({ str: item.str, x: item.transform[4], y: item.transform[5], w: item.width ?? 0, h: item.height || Math.abs(item.transform[3]) || 8, eol: !!item.hasEOL });
        line += item.str;
        if (item.hasEOL) {
          lines.push(line);
          line = '';
        } else line += ' ';
      }
      if (line.trim()) lines.push(line);
      positioned.push(placed);
      pageTexts.push(lines.map((l) => l.replace(/[ \t]+/g, ' ').trim()).join('\n').slice(0, 60_000));
    }
    const text = pageTexts.join('\n\n').replace(/\n{3,}/g, '\n\n').slice(0, 200_000);
    return { fields, checkboxes, text, pageTexts, positioned, pages: doc.numPages };
  } finally {
    void task.destroy();
  }
}
