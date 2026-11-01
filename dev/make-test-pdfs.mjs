/**
 * Generates the PDF fixtures used by the import tests (dev/fixtures/*.pdf):
 *  - sinna-5e-fillable.pdf  AcroForm with the field names of the official D&D 5e sheet
 *  - aster-text.pdf         plain text only (like a flattened export)
 *  - scanned-image.pdf      graphics only, no text (like a scan)
 *  - not-a-pdf.pdf          a text file with a .pdf name
 * Usage: node dev/make-test-pdfs.mjs
 */
import { writeFileSync } from 'node:fs';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const out = new URL('./fixtures/', import.meta.url);

async function fillable() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('Character sheet (test fixture)', { x: 40, y: 760, size: 14, font });
  const form = doc.getForm();
  const fields = {
    CharacterName: 'Sinna',
    ClassLevel: 'Sorcerer 3',
    Background: 'Street Urchin',
    'Race ': 'Half-Elf',
    Alignment: 'Chaotic Good',
    STR: '8', STRmod: '-1', DEX: '14', 'DEXmod ': '+2', CON: '12', CONmod: '+1',
    INT: '10', INTmod: '+0', WIS: '13', WISmod: '+1', CHA: '17', CHamod: '+3',
    AC: '12', Initiative: '+2', Speed: '30 ft', ProfBonus: '+2',
    HPMax: '20', HPCurrent: '17', HPTemp: '0',
    Arcana: '+5', Persuasion: '+5', 'Stealth ': '+2', 'ST Charisma': '+5',
    'Features and Traits': 'Wild Magic Surge\nTides of Chaos',
    'Wpn Name': 'Dagger', 'Wpn1 AtkBonus': '+4', 'Wpn1 Damage': '1d4+2 piercing',
    GP: '15', SP: '7',
    Equipment: 'Bedroll\nRope (50 ft)\nVoluntas Vial',
    MysteryField: 'Custom table value',
  };
  let y = 720;
  for (const [name, value] of Object.entries(fields)) {
    const tf = form.createTextField(name);
    tf.setText(value);
    tf.addToPage(page, { x: 200, y, width: 300, height: 14 });
    y -= 18;
  }
  const cb = form.createCheckBox('Check Box 11');
  cb.check();
  cb.addToPage(page, { x: 520, y: 720, width: 10, height: 10 });
  writeFileSync(new URL('sinna-5e-fillable.pdf', out), await doc.save());
}

async function text() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const lines = ['Character Name: Aster', 'Fighter 5', 'Strength 16 (+3)', 'Dexterity 12 (+1)', 'Constitution 15 (+2)', 'Armor Class 18', 'Hit Point Maximum 44', 'Speed 30 ft.', '', 'Retired legionary with a scutum and a gladius.'];
  lines.forEach((l, i) => page.drawText(l, { x: 50, y: 740 - i * 20, size: 12, font }));
  writeFileSync(new URL('aster-text.pdf', out), await doc.save());
}

async function image() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  for (let i = 0; i < 20; i++) page.drawRectangle({ x: 40 + (i % 5) * 100, y: 100 + Math.floor(i / 5) * 150, width: 80, height: 120, color: rgb(0.2 + i * 0.03, 0.2, 0.2) });
  writeFileSync(new URL('scanned-image.pdf', out), await doc.save());
}

await fillable();
await text();
await image();
writeFileSync(new URL('not-a-pdf.pdf', out), 'This is just text pretending to be a PDF. '.repeat(10));
console.log('fixtures written to dev/fixtures/');
