import { DocumentTextNormalizer } from './document-text.normalizer';
import {
  PdfJsDocumentTextExtractor,
  type PdfJsDocument,
  type PdfJsLoadingTask,
  type PdfJsModule,
  type PdfJsPage,
  type PdfJsTextContent,
} from './pdfjs-document-text.extractor';

class FakePdfPage implements PdfJsPage {
  cleaned = false;

  constructor(private readonly content: PdfJsTextContent) {}

  getTextContent(): Promise<PdfJsTextContent> {
    return Promise.resolve(this.content);
  }

  cleanup(): void {
    this.cleaned = true;
  }
}

class FakePdfDocument implements PdfJsDocument {
  readonly pages: FakePdfPage[];
  cleaned = false;

  constructor(contents: PdfJsTextContent[]) {
    this.pages = contents.map((content) => new FakePdfPage(content));
  }

  get numPages(): number {
    return this.pages.length;
  }

  getPage(pageNumber: number): Promise<PdfJsPage> {
    const page = this.pages[pageNumber - 1];

    return page
      ? Promise.resolve(page)
      : Promise.reject(new Error('Missing fake page.'));
  }

  cleanup(): Promise<void> {
    this.cleaned = true;
    return Promise.resolve();
  }
}

class FakePdfLoadingTask implements PdfJsLoadingTask {
  destroyed = false;

  constructor(readonly promise: Promise<PdfJsDocument>) {}

  destroy(): Promise<void> {
    this.destroyed = true;
    return Promise.resolve();
  }
}

class TestPdfExtractor extends PdfJsDocumentTextExtractor {
  constructor(
    normalizer: DocumentTextNormalizer,
    private readonly module: PdfJsModule,
  ) {
    super(normalizer);
  }

  protected loadPdfJs(): Promise<PdfJsModule> {
    return Promise.resolve(this.module);
  }
}

describe('PdfJsDocumentTextExtractor', () => {
  const limits = {
    max_output_bytes: 1_024,
    max_pdf_pages: 10,
  };

  function setup(contents: PdfJsTextContent[]) {
    const document = new FakePdfDocument(contents);
    const loadingTask = new FakePdfLoadingTask(Promise.resolve(document));
    const module: PdfJsModule = {
      getDocument: () => loadingTask,
    };
    const extractor = new TestPdfExtractor(
      new DocumentTextNormalizer(),
      module,
    );

    return { document, loadingTask, extractor };
  }

  it('preserves line and page order while ignoring parser metadata', async () => {
    const { document, loadingTask, extractor } = setup([
      {
        items: [
          { str: 'First', hasEOL: false },
          { str: 'line', hasEOL: true },
          { type: 'beginMarkedContent', id: 'hidden-metadata' },
          { str: 'Second line', hasEOL: false },
        ],
      },
      {
        items: [{ str: 'Next page', hasEOL: false }],
      },
    ]);

    await expect(
      extractor.extract({
        bytes: Buffer.from('%PDF-test'),
        signal: new AbortController().signal,
        limits,
      }),
    ).resolves.toBe('First line\nSecond line\n\nNext page');
    expect(document.pages.every((page) => page.cleaned)).toBe(true);
    expect(document.cleaned).toBe(true);
    expect(loadingTask.destroyed).toBe(true);
  });

  it('rejects no-text and over-limit PDFs instead of truncating them', async () => {
    const empty = setup([{ items: [] }]);
    const complex = setup([{ items: [{ str: 'Long extracted output' }] }]);

    await expect(
      empty.extractor.extract({
        bytes: Buffer.from('%PDF-test'),
        signal: new AbortController().signal,
        limits,
      }),
    ).rejects.toHaveProperty('code', 'no_text');
    await expect(
      complex.extractor.extract({
        bytes: Buffer.from('%PDF-test'),
        signal: new AbortController().signal,
        limits: { ...limits, max_output_bytes: 4 },
      }),
    ).rejects.toHaveProperty('code', 'too_complex');
  });

  it('classifies encrypted PDFs and cleans an unsuccessful loading task', async () => {
    const passwordError = Object.assign(new Error('private parser details'), {
      name: 'PasswordException',
    });
    const loadingTask = new FakePdfLoadingTask(Promise.reject(passwordError));
    const extractor = new TestPdfExtractor(new DocumentTextNormalizer(), {
      getDocument: () => loadingTask,
    });

    await expect(
      extractor.extract({
        bytes: Buffer.from('%PDF-test'),
        signal: new AbortController().signal,
        limits,
      }),
    ).rejects.toHaveProperty('code', 'encrypted');
    expect(loadingTask.destroyed).toBe(true);
  });

  it('enforces the configured page bound before reading page content', async () => {
    const { document, loadingTask, extractor } = setup([
      { items: [{ str: 'Page one' }] },
      { items: [{ str: 'Page two' }] },
    ]);

    await expect(
      extractor.extract({
        bytes: Buffer.from('%PDF-test'),
        signal: new AbortController().signal,
        limits: { ...limits, max_pdf_pages: 1 },
      }),
    ).rejects.toHaveProperty('code', 'too_complex');
    expect(document.pages.every((page) => !page.cleaned)).toBe(true);
    expect(loadingTask.destroyed).toBe(true);
  });
});
