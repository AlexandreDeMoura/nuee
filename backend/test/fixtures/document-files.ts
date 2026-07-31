export const plainTextDocumentFixture = Buffer.from(
  'First paragraph.\r\n\r\nSecond paragraph.',
  'utf8',
);

export const markdownDocumentFixture = Buffer.from(
  '# Finding\n\nThe launch remains reversible.',
  'utf8',
);

export const unsafeTextDocumentFixture = Buffer.from(
  'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!',
  'ascii',
);

export function textPdfDocumentFixture(lines: readonly string[]): Buffer {
  const content = `BT /F1 18 Tf 72 720 Td 20 TL\n${lines
    .map((line) => `(${escapePdfText(line)}) Tj T*`)
    .join('\n')}\nET\n`;

  return buildPdf(content, true);
}

export function noTextPdfDocumentFixture(): Buffer {
  return buildPdf('q\nQ\n', false);
}

function buildPdf(content: string, includeFont: boolean): Buffer {
  const resources = includeFont
    ? '/Resources << /Font << /F1 5 0 R >> >> '
    : '';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ${resources}/Contents 4 0 R >>`,
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}endstream`,
    ...(includeFont
      ? ['<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
      : []),
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];

  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const startxref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  pdf +=
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
    `startxref\n${startxref}\n%%EOF\n`;

  return Buffer.from(pdf, 'latin1');
}

function escapePdfText(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('(', '\\(')
    .replaceAll(')', '\\)');
}
