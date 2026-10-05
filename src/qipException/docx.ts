// Turns the document model (from template.mjs) into a Word (.docx) file.
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, ShadingType,
  BorderStyle, HeadingLevel, LevelFormat, AlignmentType
} from 'docx';

export const FONT = 'Google Sans';
const BODY = 22;   // 11 pt
const TABLE = 19;  // 9.5 pt

const runs = (rs, size = BODY) => rs.map((r) => new TextRun({ text: r.text, bold: !!r.bold, italics: !!r.italic, font: FONT, size }));

const border = { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF' };
const borders = { top: border, bottom: border, left: border, right: border };

function makeTable(b) {
  const total = b.widths.reduce((a, x) => a + x, 0);
  const cell = (text, w, head) => new TableCell({
    width: { size: w, type: WidthType.DXA },
    borders,
    shading: head ? { type: ShadingType.CLEAR, fill: 'EFEFEF', color: 'auto' } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({ children: [new TextRun({ text: String(text), bold: head, font: FONT, size: TABLE })] })]
  });
  return new Table({
    width: { size: total, type: WidthType.DXA },
    columnWidths: b.widths,
    rows: [
      new TableRow({ tableHeader: true, cantSplit: true, children: b.headers.map((h, i) => cell(h, b.widths[i], true)) }),
      ...b.rows.map((r) => new TableRow({ cantSplit: true, children: r.map((t, i) => cell(t, b.widths[i], false)) }))
    ]
  });
}

export function buildDocx(model) {
  const children = [];
  for (const b of model.blocks) {
    switch (b.type) {
      case 'title':
        children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 0, after: 160 }, children: [new TextRun({ text: b.text, font: FONT, size: 40 })] }));
        break;
      case 'heading':
        children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, keepNext: true, spacing: { before: 320, after: 120 }, children: [new TextRun({ text: b.text, font: FONT, size: 32 })] }));
        break;
      case 'para':
        children.push(new Paragraph({ keepNext: !!b.keepNext, spacing: { before: 80, after: 80 }, indent: b.indent ? { left: b.indent } : undefined, children: runs(b.runs) }));
        break;
      case 'paras':
        for (const it of b.items) children.push(new Paragraph({ spacing: { before: 80, after: 80 }, children: runs(it.runs) }));
        break;
      case 'bullets':
        for (const it of b.items) children.push(new Paragraph({ numbering: { reference: 'bullets', level: it.level || 0 }, spacing: { before: 40, after: 40 }, children: runs(it.runs) }));
        break;
      case 'table':
        children.push(makeTable(b));
        children.push(new Paragraph({ spacing: { before: 0, after: 120 }, children: [] }));
        break;
      default:
        throw new Error('Unknown block type ' + b.type);
    }
  }

  return new Document({
    creator: 'QIP Exception Tool',
    title: model.blocks[0] && model.blocks[0].text,
    styles: {
      default: { document: { run: { font: FONT, size: BODY } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT, size: 40 }, paragraph: { spacing: { before: 0, after: 160 }, outlineLevel: 0 } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT, size: 32 }, paragraph: { spacing: { before: 320, after: 120 }, outlineLevel: 1 } }
      ]
    },
    numbering: {
      config: [{
        reference: 'bullets',
        levels: [
          { level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
          { level: 1, format: LevelFormat.BULLET, text: '◦', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 1440, hanging: 360 } } } }
        ]
      }]
    },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
      children
    }]
  });
}

// Browser: Blob. Node (tests): Uint8Array.
export async function docxBytes(model) {
  const d = buildDocx(model);
  const buf = await Packer.toArrayBuffer(d);
  return new Uint8Array(buf);
}
export async function docxBlob(model) {
  const bytes = await docxBytes(model);
  return new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}
