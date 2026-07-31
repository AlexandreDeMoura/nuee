import { DocumentTextNormalizer } from './document-text.normalizer';
import { PdfJsDocumentTextExtractor } from './pdfjs-document-text.extractor';
import { PdfJsUploadInspector } from './pdfjs-upload.inspector';

/**
 * Exercises both pdfjs adapters against the real parser. The structural
 * interfaces the adapters declare are unchecked casts over an optional
 * dependency, so only a real document proves they still match the library.
 */
describe('pdfjs adapters against the real parser', () => {
  const lines = ['Frozen context stays stable.', 'Second line of the fixture.'];

  it('reports the page count of a text-extractable PDF', async () => {
    const inspection = await new PdfJsUploadInspector().inspect(
      buildTextPdf(lines),
    );

    expect(inspection).toEqual({ page_count: 1 });
  });

  it('extracts readable text in document order', async () => {
    const extractor = new PdfJsDocumentTextExtractor(
      new DocumentTextNormalizer(),
    );

    await expect(
      extractor.extract({
        bytes: buildTextPdf(lines),
        signal: new AbortController().signal,
        limits: { max_output_bytes: 1_024, max_pdf_pages: 10 },
      }),
    ).resolves.toBe(lines.join('\n'));
  });

  it('rejects a file that only claims to be a PDF', async () => {
    await expect(
      new PdfJsUploadInspector().inspect(Buffer.from('%PDF-1.4\nnot a pdf')),
    ).rejects.toHaveProperty('code', 'corrupted');
  });
});

/** Builds a minimal single-page PDF whose text stream is uncompressed. */
function buildTextPdf(lines: string[]): Buffer {
  const content = `BT /F1 18 Tf 72 720 Td 20 TL\n${lines
    .map((line) => `(${line}) Tj T*`)
    .join('\n')}\nET\n`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
      '/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\n` +
      `stream\n${content}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
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
