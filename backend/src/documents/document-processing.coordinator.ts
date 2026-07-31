import { createHash, randomUUID } from 'node:crypto';
import {
  Inject,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type {
  DocumentFormatCategory,
  DocumentProcessingErrorCode,
} from '@nuee/shared-types';
import { documentsConfig } from '../config/configuration';
import {
  DocumentTelemetry,
  documentCorrelationId,
  documentSizeBand,
} from './document.telemetry';
import {
  DOCUMENT_FILE_STORAGE,
  DOCUMENT_MALWARE_SCANNER,
  DOCUMENT_REPOSITORY,
  DocumentFileStorageError,
  DocumentMalwareScannerError,
  DocumentTextExtractionError,
  type DocumentFileStorage,
  type DocumentMalwareScanner,
  type DocumentProcessingQueue,
  type DocumentRecord,
  type DocumentRepository,
  type DocumentTextExtractor,
} from './document.types';
import { MarkdownDocumentTextExtractor } from './utf8-document-text.extractors';
import { PdfJsDocumentTextExtractor } from './pdfjs-document-text.extractor';
import { PlainTextDocumentTextExtractor } from './utf8-document-text.extractors';

interface ProcessingFailure {
  code: DocumentProcessingErrorCode;
  retryable: boolean;
}

class UnsafeDocumentError extends Error {}

@Injectable()
export class DocumentProcessingCoordinator
  implements DocumentProcessingQueue, OnModuleInit, OnModuleDestroy
{
  private readonly workerIdentity = randomUUID();
  private readonly activeControllers = new Set<AbortController>();
  private drainPromise: Promise<void> | undefined;
  private drainRequested = false;
  private drainScheduled = false;
  private shuttingDown = false;
  private recoveryTimer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(DOCUMENT_REPOSITORY)
    private readonly documents: DocumentRepository,
    @Inject(DOCUMENT_FILE_STORAGE)
    private readonly fileStorage: DocumentFileStorage,
    @Inject(DOCUMENT_MALWARE_SCANNER)
    private readonly malwareScanner: DocumentMalwareScanner,
    private readonly plainTextExtractor: PlainTextDocumentTextExtractor,
    private readonly markdownExtractor: MarkdownDocumentTextExtractor,
    private readonly pdfExtractor: PdfJsDocumentTextExtractor,
    @Inject(documentsConfig.KEY)
    private readonly config: ConfigType<typeof documentsConfig>,
    private readonly telemetry: DocumentTelemetry = new DocumentTelemetry(),
  ) {}

  onModuleInit(): void {
    this.schedule();
    this.recoveryTimer = setInterval(
      () => this.schedule(),
      Math.min(this.config.processingLeaseMs, 5_000),
    );
    this.recoveryTimer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    this.shuttingDown = true;

    if (this.recoveryTimer) {
      clearInterval(this.recoveryTimer);
      this.recoveryTimer = undefined;
    }

    for (const controller of this.activeControllers) {
      controller.abort(new Error('Document processing is shutting down.'));
    }

    await this.drainPromise;
  }

  schedule(): void {
    if (this.shuttingDown) {
      return;
    }

    this.drainRequested = true;

    if (this.drainScheduled || this.drainPromise) {
      return;
    }

    this.drainScheduled = true;
    queueMicrotask(() => {
      this.drainScheduled = false;
      void this.drain();
    });
  }

  async drain(): Promise<void> {
    if (this.drainPromise) {
      this.drainRequested = true;
      return this.drainPromise;
    }

    const operation = this.runUntilIdle();
    this.drainPromise = operation;

    try {
      await operation;
    } finally {
      this.drainPromise = undefined;

      if (this.drainRequested && !this.shuttingDown) {
        this.schedule();
      }
    }
  }

  private async runUntilIdle(): Promise<void> {
    do {
      this.drainRequested = false;

      await Promise.all(
        Array.from(
          { length: this.config.maxProcessingConcurrency },
          (_, workerIndex) => this.runWorker(workerIndex),
        ),
      );
    } while (this.drainRequested && !this.shuttingDown);
  }

  private async runWorker(workerIndex: number): Promise<void> {
    while (!this.shuttingDown) {
      const now = new Date();
      const leaseOwner = `${this.workerIdentity}:${workerIndex}:${randomUUID()}`;
      const candidate = this.documents.findProcessingCandidates(
        now.toISOString(),
        1,
      )[0];

      if (!candidate) {
        return;
      }

      const claimed = this.documents.claimProcessingLease({
        project_id: candidate.project_id,
        document_id: candidate.id,
        expected_generation: candidate.processing_generation,
        lease_owner: leaseOwner,
        claimed_at: now.toISOString(),
        lease_expires_at: new Date(
          now.getTime() + this.config.processingLeaseMs,
        ).toISOString(),
      });

      if (!claimed) {
        continue;
      }

      await this.processClaimedDocument(claimed, leaseOwner);
    }
  }

  private async processClaimedDocument(
    document: DocumentRecord,
    leaseOwner: string,
  ): Promise<void> {
    const startedAt = Date.now();
    const controller = new AbortController();
    let rejectWhenAborted!: () => void;
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectWhenAborted = () => {
        reject(
          new DocumentTextExtractionError('processing_unavailable', true, {
            cause: controller.signal.reason,
          }),
        );
      };
      controller.signal.addEventListener('abort', rejectWhenAborted, {
        once: true,
      });
    });
    const timeout = setTimeout(() => {
      controller.abort(new Error('Document processing exceeded its deadline.'));
    }, this.config.processingTimeoutMs);
    timeout.unref();
    this.activeControllers.add(controller);
    const operation = this.executeClaimedDocument(
      document,
      leaseOwner,
      controller.signal,
    );

    try {
      const completed = await Promise.race([operation, aborted]);
      this.recordProcessingTelemetry(
        document,
        startedAt,
        completed ? 'ready' : 'stale',
        null,
      );
    } catch (error) {
      const failure = this.classifyFailure(error, controller.signal);
      const outcome = this.recordFailure(document, leaseOwner, failure);
      this.recordProcessingTelemetry(
        document,
        startedAt,
        outcome,
        failure.code,
      );
    } finally {
      clearTimeout(timeout);
      controller.signal.removeEventListener('abort', rejectWhenAborted);
      this.activeControllers.delete(controller);
    }
  }

  private async executeClaimedDocument(
    document: DocumentRecord,
    leaseOwner: string,
    signal: AbortSignal,
  ): Promise<DocumentRecord | undefined> {
    let sourceBytes: Buffer | undefined;

    try {
      sourceBytes = await this.fileStorage.read(document.file_reference);
      this.throwIfAborted(signal);
      this.verifyStoredSource(sourceBytes, document.source_hash);

      const scanResult = await this.malwareScanner.scan(sourceBytes, signal);

      if (scanResult === 'unsafe') {
        throw new UnsafeDocumentError();
      }

      const extractedText = await this.extractorFor(document.format).extract({
        bytes: sourceBytes,
        signal,
        limits: {
          max_output_bytes: this.config.maxExtractedTextBytes,
          max_pdf_pages: this.config.maxPdfPages,
        },
      });
      this.throwIfAborted(signal);

      return this.documents.completeProcessing({
        project_id: document.project_id,
        document_id: document.id,
        expected_generation: document.processing_generation,
        lease_owner: leaseOwner,
        extracted_text: extractedText,
        processed_source_hash: document.source_hash,
        completed_at: new Date().toISOString(),
      });
    } finally {
      sourceBytes?.fill(0);
    }
  }

  private recordFailure(
    document: DocumentRecord,
    leaseOwner: string,
    failure: ProcessingFailure,
  ): 'retry_scheduled' | 'failed' | 'stale' {
    const completedAt = new Date().toISOString();
    const lease = {
      project_id: document.project_id,
      document_id: document.id,
      expected_generation: document.processing_generation,
      lease_owner: leaseOwner,
    };

    if (
      this.shuttingDown ||
      (failure.retryable &&
        document.processing_attempt_count < this.config.maxProcessingAttempts)
    ) {
      const released = this.documents.releaseProcessingLease({
        ...lease,
        released_at: completedAt,
      });
      return released ? 'retry_scheduled' : 'stale';
    }

    const failed = this.documents.failProcessing({
      ...lease,
      error_code: failure.code,
      retryable: failure.retryable,
      completed_at: completedAt,
    });
    return failed ? 'failed' : 'stale';
  }

  private recordProcessingTelemetry(
    document: DocumentRecord,
    startedAt: number,
    outcome: 'ready' | 'retry_scheduled' | 'failed' | 'stale',
    errorCode: DocumentProcessingErrorCode | null,
  ): void {
    this.telemetry.record({
      event: 'document_processing_finished',
      project_id: document.project_id,
      document_id: document.id,
      correlation_id: documentCorrelationId(document.id),
      format_category: document.format,
      size_band: documentSizeBand(document.size_bytes),
      duration_ms: Math.max(0, Date.now() - startedAt),
      retry_count: Math.max(0, document.processing_attempt_count - 1),
      outcome,
      error_code: errorCode,
    });
  }

  private extractorFor(format: DocumentFormatCategory): DocumentTextExtractor {
    switch (format) {
      case 'plain_text':
        return this.plainTextExtractor;
      case 'markdown':
        return this.markdownExtractor;
      case 'pdf':
        return this.pdfExtractor;
    }
  }

  private verifyStoredSource(bytes: Buffer, expectedHash: string): void {
    const actualHash = createHash('sha256').update(bytes).digest('hex');

    if (actualHash !== expectedHash) {
      throw new DocumentTextExtractionError('corrupted', false);
    }
  }

  private throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) {
      throw new DocumentTextExtractionError('processing_unavailable', true, {
        cause: signal.reason,
      });
    }
  }

  private classifyFailure(
    error: unknown,
    signal: AbortSignal,
  ): ProcessingFailure {
    if (signal.aborted) {
      return { code: 'processing_unavailable', retryable: true };
    }

    if (error instanceof UnsafeDocumentError) {
      return { code: 'unsafe', retryable: false };
    }

    if (error instanceof DocumentFileStorageError) {
      return { code: 'storage_unavailable', retryable: true };
    }

    if (error instanceof DocumentMalwareScannerError) {
      return { code: 'scanner_unavailable', retryable: true };
    }

    if (error instanceof DocumentTextExtractionError) {
      return { code: error.code, retryable: error.retryable };
    }

    return { code: 'unknown', retryable: true };
  }
}
