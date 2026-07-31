import { Injectable } from '@nestjs/common';
import { DocumentTextNormalizer } from './document-text.normalizer';
import {
  DocumentTextExtractionError,
  type DocumentTextExtractor,
  type ExtractDocumentTextInput,
} from './document.types';

const PDFJS_MODULE_NAME = 'pdfjs-dist/legacy/build/pdf.mjs';

export interface PdfJsTextItem {
  str: string;
  hasEOL?: boolean;
}

export interface PdfJsTextContent {
  items: unknown[];
}

export interface PdfJsPage {
  getTextContent(options: {
    disableNormalization: boolean;
    includeMarkedContent: boolean;
  }): Promise<PdfJsTextContent>;
  cleanup(): void;
}

export interface PdfJsDocument {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfJsPage>;
  cleanup(): Promise<void>;
}

export interface PdfJsLoadingTask {
  promise: Promise<PdfJsDocument>;
  destroy(): Promise<void>;
}

export interface PdfJsModule {
  getDocument(options: {
    data: Uint8Array;
    disableAutoFetch: boolean;
    disableFontFace: boolean;
    disableRange: boolean;
    disableStream: boolean;
    isEvalSupported: boolean;
    maxImageSize: number;
    stopAtErrors: boolean;
    useSystemFonts: boolean;
    useWorkerFetch: boolean;
    verbosity: number;
  }): PdfJsLoadingTask;
}

@Injectable()
export class PdfJsDocumentTextExtractor implements DocumentTextExtractor {
  constructor(private readonly normalizer: DocumentTextNormalizer) {}

  async extract(input: ExtractDocumentTextInput): Promise<string> {
    this.throwIfAborted(input.signal);

    const pdfjs = await this.loadPdfJs();

    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(input.bytes),
      disableAutoFetch: true,
      disableFontFace: true,
      disableRange: true,
      disableStream: true,
      isEvalSupported: false,
      maxImageSize: 0,
      stopAtErrors: true,
      useSystemFonts: false,
      useWorkerFetch: false,
      verbosity: 0,
    });
    const abort = () => {
      void loadingTask.destroy().catch(() => undefined);
    };
    input.signal.addEventListener('abort', abort, { once: true });
    let document: PdfJsDocument | undefined;

    try {
      document = await loadingTask.promise;
      this.validatePageCount(document.numPages, input.limits.max_pdf_pages);

      const pages: string[] = [];
      let extractedBytes = 0;

      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
        this.throwIfAborted(input.signal);
        const page = await document.getPage(pageNumber);

        try {
          const textContent = await page.getTextContent({
            disableNormalization: false,
            includeMarkedContent: false,
          });
          const pageText = this.serializePage(textContent);
          const separator = pages.length === 0 ? '' : '\n\n';

          extractedBytes += Buffer.byteLength(
            `${separator}${pageText}`,
            'utf8',
          );

          if (extractedBytes > input.limits.max_output_bytes) {
            throw new DocumentTextExtractionError('too_complex', false);
          }

          pages.push(pageText);
        } finally {
          page.cleanup();
        }
      }

      this.throwIfAborted(input.signal);

      return this.normalizer.normalize(
        pages.join('\n\n'),
        input.limits.max_output_bytes,
      );
    } catch (error) {
      throw this.classifyParserError(error);
    } finally {
      input.signal.removeEventListener('abort', abort);

      if (document) {
        await document.cleanup().catch(() => undefined);
      }

      // Destroying the loading task tears down the parsed document with it.
      // `PDFDocumentProxy` itself exposes no `destroy`.
      await loadingTask.destroy().catch(() => undefined);
    }
  }

  protected async loadPdfJs(): Promise<PdfJsModule> {
    try {
      return (await import(PDFJS_MODULE_NAME)) as PdfJsModule;
    } catch (error) {
      throw new DocumentTextExtractionError('processing_unavailable', true, {
        cause: error,
      });
    }
  }

  private validatePageCount(pageCount: number, maximum: number): void {
    if (!Number.isSafeInteger(pageCount) || pageCount <= 0) {
      throw new DocumentTextExtractionError('corrupted', false);
    }

    if (pageCount > maximum) {
      throw new DocumentTextExtractionError('too_complex', false);
    }
  }

  private serializePage(content: PdfJsTextContent): string {
    let result = '';

    for (const candidate of content.items) {
      if (!this.isTextItem(candidate) || candidate.str.length === 0) {
        continue;
      }

      if (
        result.length > 0 &&
        !result.endsWith('\n') &&
        !/\s$/u.test(result) &&
        !/^\s/u.test(candidate.str)
      ) {
        result += ' ';
      }

      result += candidate.str;

      if (candidate.hasEOL) {
        result += '\n';
      }
    }

    return result;
  }

  private classifyParserError(error: unknown): DocumentTextExtractionError {
    if (error instanceof DocumentTextExtractionError) {
      return error;
    }

    const name = this.errorName(error);

    if (name === 'PasswordException') {
      return new DocumentTextExtractionError('encrypted', false, {
        cause: error,
      });
    }

    if (name === 'AbortException') {
      return new DocumentTextExtractionError('processing_unavailable', true, {
        cause: error,
      });
    }

    return new DocumentTextExtractionError('corrupted', false, {
      cause: error,
    });
  }

  private throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) {
      throw new DocumentTextExtractionError('processing_unavailable', true, {
        cause: signal.reason,
      });
    }
  }

  private isTextItem(value: unknown): value is PdfJsTextItem {
    return (
      typeof value === 'object' &&
      value !== null &&
      'str' in value &&
      typeof value.str === 'string' &&
      (!('hasEOL' in value) || typeof value.hasEOL === 'boolean')
    );
  }

  private errorName(error: unknown): string | undefined {
    if (
      typeof error === 'object' &&
      error !== null &&
      'name' in error &&
      typeof error.name === 'string'
    ) {
      return error.name;
    }

    return undefined;
  }
}
