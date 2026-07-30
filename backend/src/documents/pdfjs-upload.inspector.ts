import { Injectable } from '@nestjs/common';
import {
  PdfUploadInspectionError,
  type PdfUploadInspection,
  type PdfUploadInspector,
} from './document.types';

const PDFJS_MODULE_NAME = 'pdfjs-dist/legacy/build/pdf.mjs';

interface PdfJsLoadingTask {
  promise: Promise<PdfJsDocument>;
  destroy(): Promise<void>;
}

interface PdfJsDocument {
  numPages: number;
  destroy(): Promise<void>;
}

interface PdfJsModule {
  getDocument(options: {
    data: Uint8Array;
    disableFontFace: boolean;
    disableRange: boolean;
    disableStream: boolean;
    isEvalSupported: boolean;
    stopAtErrors: boolean;
    useSystemFonts: boolean;
  }): PdfJsLoadingTask;
}

@Injectable()
export class PdfJsUploadInspector implements PdfUploadInspector {
  async inspect(bytes: Uint8Array): Promise<PdfUploadInspection> {
    let pdfjs: PdfJsModule;

    try {
      // Keep the optional parser behind the upload-inspection port. The
      // dependency is installed by the contributor command documented in the
      // PRD, while TXT/Markdown tests do not need to load the ESM package.
      pdfjs = (await import(PDFJS_MODULE_NAME)) as PdfJsModule;
    } catch (error) {
      throw new PdfUploadInspectionError('unavailable', { cause: error });
    }

    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(bytes),
      disableFontFace: true,
      disableRange: true,
      disableStream: true,
      isEvalSupported: false,
      stopAtErrors: true,
      useSystemFonts: false,
    });

    let document: PdfJsDocument | undefined;

    try {
      document = await loadingTask.promise;

      if (!Number.isSafeInteger(document.numPages) || document.numPages <= 0) {
        throw new PdfUploadInspectionError('corrupted');
      }

      return {
        page_count: document.numPages,
      };
    } catch (error) {
      if (error instanceof PdfUploadInspectionError) {
        throw error;
      }

      const errorName = this.errorName(error);
      const errorCode =
        errorName === 'PasswordException' ? 'encrypted' : 'corrupted';

      throw new PdfUploadInspectionError(errorCode, { cause: error });
    } finally {
      if (document) {
        await document.destroy().catch(() => undefined);
      } else {
        await loadingTask.destroy().catch(() => undefined);
      }
    }
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
