import { Injectable } from '@nestjs/common';
import { DocumentTextNormalizer } from './document-text.normalizer';
import {
  DocumentTextExtractionError,
  type DocumentTextExtractor,
  type ExtractDocumentTextInput,
} from './document.types';

abstract class Utf8DocumentTextExtractor implements DocumentTextExtractor {
  constructor(private readonly normalizer: DocumentTextNormalizer) {}

  extract(input: ExtractDocumentTextInput): Promise<string> {
    try {
      this.throwIfAborted(input.signal);

      let decoded: string;

      try {
        decoded = new TextDecoder('utf-8', { fatal: true }).decode(input.bytes);
      } catch (error) {
        throw new DocumentTextExtractionError('corrupted', false, {
          cause: error,
        });
      }

      this.throwIfAborted(input.signal);

      return Promise.resolve(
        this.normalizer.normalize(decoded, input.limits.max_output_bytes),
      );
    } catch (error) {
      return Promise.reject(error as Error);
    }
  }

  private throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) {
      throw new DocumentTextExtractionError('processing_unavailable', true, {
        cause: signal.reason,
      });
    }
  }
}

@Injectable()
export class PlainTextDocumentTextExtractor extends Utf8DocumentTextExtractor {
  constructor(normalizer: DocumentTextNormalizer) {
    super(normalizer);
  }
}

@Injectable()
export class MarkdownDocumentTextExtractor extends Utf8DocumentTextExtractor {
  constructor(normalizer: DocumentTextNormalizer) {
    super(normalizer);
  }
}
