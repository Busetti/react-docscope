#!/usr/bin/env node
/**
 * Generates large, uncommitted fixtures (tests/fixtures/large/) for the
 * playground's "Large documents" scenario, e2e and performance tests.
 * Pure Node — no external tools required. Skips files that already exist.
 */
import { existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync, strToU8 } from 'fflate';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures', 'large');
mkdirSync(root, { recursive: true });
const force = process.argv.includes('--force');

function write(name, producer) {
  const file = join(root, name);
  if (existsSync(file) && !force) return;
  const t = performance.now();
  const data = producer();
  writeFileSync(file, data);
  console.log(`${name.padEnd(18)} ${(statSync(file).size / 1024 / 1024).toFixed(1).padStart(6)} MB  ${(performance.now() - t).toFixed(0)} ms`);
}

/* ---------------------------------------------------------------- PDF */
function pdf(pages) {
  const objs = [];
  const add = (body) => {
    objs.push(body);
    return objs.length;
  };
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add('PAGES_PLACEHOLDER');
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const kids = [];
  for (let p = 1; p <= pages; p += 1) {
    const lines = [
      `BT /F1 22 Tf 60 780 Td (Large document - page ${p} of ${pages}) Tj ET`,
      ...Array.from({ length: 30 }, (_, i) => {
        const word = i === 7 ? 'invoice' : 'record';
        return `BT /F1 11 Tf 60 ${740 - i * 22} Td (Line ${i + 1}: ${word} ${p}-${i + 1} lorem ipsum dolor sit amet consectetur) Tj ET`;
      }),
    ].join('\n');
    const content = add(`<< /Length ${Buffer.byteLength(lines)} >>\nstream\n${lines}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${pages} >>`;
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return out;
}

/* ---------------------------------------------------------------- XLSX */
function colName(i) {
  let n = i + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function xlsx(rows, cols) {
  const head = Array.from({ length: cols }, (_, c) => `<c r="${colName(c)}1" t="inlineStr" s="1"><is><t>Column ${c + 1}</t></is></c>`).join('');
  const body = [];
  body.push(`<row r="1">${head}</row>`);
  for (let r = 2; r <= rows; r += 1) {
    let cells = `<c r="A${r}" t="inlineStr"><is><t>${r % 997 === 0 ? 'needle' : `Item ${r}`}</t></is></c>`;
    for (let c = 1; c < cols; c += 1) cells += `<c r="${colName(c)}${r}" s="2"><v>${(r * (c + 1) * 1.5).toFixed(2)}</v></c>`;
    body.push(`<row r="${r}">${cells}</row>`);
  }
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="1" width="18" customWidth="1"/></cols><sheetData>${body.join('')}</sheetData></worksheet>`;
  const files = {
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
    ),
    '_rels/.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    ),
    'xl/workbook.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>',
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    ),
    'xl/styles.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0"/></cellXfs></styleSheet>',
    ),
    'xl/worksheets/sheet1.xml': strToU8(sheet),
  };
  return Buffer.from(zipSync(files, { level: 6 }));
}

/* ---------------------------------------------------------------- text formats */
const cities = ['Bengaluru', 'Pune', 'Chennai', 'Hyderabad', 'Mumbai', 'Delhi'];

write('large.pdf', () => pdf(400));
write('large.csv', () => {
  const lines = ['id,name,email,city,amount,status'];
  for (let i = 1; i <= 200_000; i += 1) {
    lines.push(`${i},Customer ${i},customer${i}@example.com,${cities[i % 6]},${(i * 3.7).toFixed(2)},${i % 1234 === 0 ? 'needle' : 'ok'}`);
  }
  return `${lines.join('\n')}\n`;
});
write('large.xlsx', () => xlsx(20_000, 12));
write('large.txt', () => {
  const lines = [];
  for (let i = 1; i <= 200_000; i += 1) lines.push(`${String(i).padStart(6, '0')} INFO request id=${i * 7919} path=/api/items/${i % 500} took=${i % 97}ms${i % 5000 === 0 ? ' needle' : ''}`);
  return `${lines.join('\n')}\n`;
});
write('large.json', () =>
  JSON.stringify({
    generated: true,
    items: Array.from({ length: 20_000 }, (_, i) => ({ id: i, name: `Item ${i}`, tags: ['a', 'b', i % 1000 === 0 ? 'needle' : 'c'], price: i * 1.25, active: i % 2 === 0 })),
  }),
);
write('large.xml', () => {
  const items = Array.from({ length: 20_000 }, (_, i) => `  <item id="${i}" active="${i % 2 === 0}"><name>Item ${i}</name><price>${(i * 1.25).toFixed(2)}</price>${i % 1000 === 0 ? '<note>needle</note>' : ''}</item>`);
  return `<?xml version="1.0"?>\n<items>\n${items.join('\n')}\n</items>\n`;
});
console.log(`Large fixtures ready in ${root}`);
