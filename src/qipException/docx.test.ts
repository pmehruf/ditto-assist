import { test } from 'vitest';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { buildDocument } from './template';
import { docxBytes } from './docx';
import { sampleInputs, sampleAi } from './synthetic';

async function open() {
  const bytes = await docxBytes(buildDocument(sampleInputs(), sampleAi()));
  const zip = await JSZip.loadAsync(bytes);
  return { zip, xml: await zip.file('word/document.xml').async('string') };
}
const text = (xml) => [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join(' ');

test('docx is a valid zip with the expected parts', async () => {
  const { zip } = await open();
  for (const f of ['[Content_Types].xml', 'word/document.xml', 'word/styles.xml', 'word/numbering.xml']) assert.ok(zip.file(f), f);
});
test('docx text has headings in order and the calculated numbers', async () => {
  const { xml } = await open(); const t = text(xml);
  let pos = -1;
  for (const h of ['QIP Exception Request | August 2026', 'Background', 'QIP Analysis Data', 'Individual Analysis and Overview', 'Performance Trend', 'Current Performance', 'Conclusion']) { const p = t.indexOf(h); assert.ok(p > pos, `${h} in order`); pos = p; }
  for (const s of ['28.81% (17/59)', '35.71% (5/14)', '46.15% (6/13)']) assert.ok(t.includes(s), s);
});
test('page is A4 with 1 inch margins; font is Google Sans', async () => {
  const { xml } = await open();
  assert.match(xml, /w:pgSz w:w="11906" w:h="16838"/); assert.match(xml, /w:pgMar[^>]*w:top="1440"/); assert.match(xml, /Google Sans/);
});
test('tables have fixed widths', async () => {
  const { xml } = await open();
  assert.ok((xml.match(/<w:tbl>/g) || []).length >= 4); assert.match(xml, /<w:tblGrid>/);
});
test('bullets use real Word numbering, not typed bullet characters', async () => {
  const { xml } = await open(); assert.match(xml, /<w:numPr>/); assert.ok(!text(xml).includes('•'));
});
