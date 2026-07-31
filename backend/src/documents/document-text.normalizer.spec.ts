import { DocumentTextNormalizer } from './document-text.normalizer';
import { DocumentTextExtractionError } from './document.types';
import {
  MarkdownDocumentTextExtractor,
  PlainTextDocumentTextExtractor,
} from './utf8-document-text.extractors';

describe('document text extraction normalization', () => {
  const normalizer = new DocumentTextNormalizer();
  const limits = {
    max_output_bytes: 1_024,
    max_pdf_pages: 10,
  };

  function expectNormalizationError(
    value: string,
    maximumBytes: number,
    code: DocumentTextExtractionError['code'],
  ): void {
    try {
      normalizer.normalize(value, maximumBytes);
      throw new Error('Expected normalization to fail.');
    } catch (error) {
      expect(error).toBeInstanceOf(DocumentTextExtractionError);
      expect(error).toHaveProperty('code', code);
    }
  }

  it.each([
    new PlainTextDocumentTextExtractor(normalizer),
    new MarkdownDocumentTextExtractor(normalizer),
  ])('decodes UTF-8 and preserves normalized paragraphs', async (extractor) => {
    const result = await extractor.extract({
      bytes: Buffer.from(
        '\ufeffCafe\u0301\r\nfirst line  \r\n\r\n\r\nsecond paragraph\fthird section',
        'utf8',
      ),
      signal: new AbortController().signal,
      limits,
    });

    expect(result).toBe('Café\nfirst line\n\nsecond paragraph\nthird section');
  });

  it('rejects absent, invalid, and over-complex output without truncating', () => {
    expectNormalizationError(' \r\n\t ', 100, 'no_text');
    expectNormalizationError('Unsafe\u0000text', 100, 'corrupted');
    expectNormalizationError('éé', 3, 'too_complex');
  });

  it('stops before decoding when processing is aborted', async () => {
    const controller = new AbortController();
    controller.abort(new Error('deadline'));
    const extractor = new PlainTextDocumentTextExtractor(normalizer);

    await expect(
      extractor.extract({
        bytes: Buffer.from('Source'),
        signal: controller.signal,
        limits,
      }),
    ).rejects.toBeInstanceOf(DocumentTextExtractionError);
    await expect(
      extractor.extract({
        bytes: Buffer.from('Source'),
        signal: controller.signal,
        limits,
      }),
    ).rejects.toHaveProperty('code', 'processing_unavailable');
  });
});
