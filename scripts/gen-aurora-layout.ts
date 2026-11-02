/**
 * Generates src/sheetImport/auroraLayout.json from the fillable Aurora sample (tests/fixtures/sinna.pdf):
 * per template page the static label lines (to recognise the page) and every form field's rectangle.
 * Used to read printed / flattened Aurora PDFs, which contain the values only as positioned page text.
 * Run: npx tsx scripts/gen-aurora-layout.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync('tests/fixtures/sinna.pdf')), verbosity: 0 }).promise;
const SKIP = /^(card_|hidden_layout_helper|background_portrait_image)/;
const pages: Array<{ labels: Array<[string, number, number]>; fields: Array<[string, number, number, number, number, 0 | 1]> }> = [];
const r1 = (n: number) => Math.round(n * 10) / 10;
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p);
  const ann = (await page.getAnnotations()) as Array<Record<string, any>>;
  const fields = ann
    .filter((a) => a.subtype === 'Widget' && typeof a.fieldName === 'string' && !SKIP.test(a.fieldName) && (a.fieldType === 'Tx' || (a.fieldType === 'Btn' && a.checkBox)))
    .map((a) => [a.fieldName, ...a.rect.map(r1), a.fieldType === 'Tx' ? 0 : 1] as [string, number, number, number, number, 0 | 1]);
  if (!fields.length) continue;
  const tc = await page.getTextContent();
  const labels = (tc.items as Array<{ str: string; transform: number[] }>)
    .filter((i) => i.str.trim().length > 0)
    .map((i) => [i.str.trim(), r1(i.transform[4]), r1(i.transform[5])] as [string, number, number]);
  pages.push({ labels, fields });
}
writeFileSync('src/sheetImport/auroraLayout.json', JSON.stringify({ source: 'Aurora Builder sheet (tests/fixtures/sinna.pdf)', pages }));
console.log(pages.map((p) => `${p.fields.length} fields, ${p.labels.length} labels`).join('\n'));
