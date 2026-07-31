import { Module } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { appConfig } from '../config/configuration';
import { DOCUMENT_CONTEXT_SOURCE_READER } from '../discussion-context/discussion-context.types';
import { ProjectsModule } from '../projects/projects.module';
import { ClamAvDocumentMalwareScanner } from './clamav-document-malware.scanner';
import { DeterministicDocumentMalwareScanner } from './deterministic-document-malware.scanner';
import { DocumentProcessingCoordinator } from './document-processing.coordinator';
import { DocumentTextNormalizer } from './document-text.normalizer';
import { DocumentUploadInterceptor } from './document-upload.interceptor';
import { DocumentUploadValidator } from './document-upload.validator';
import {
  DOCUMENT_FILE_STORAGE,
  DOCUMENT_MALWARE_SCANNER,
  DOCUMENT_PROCESSING_QUEUE,
  DOCUMENT_REPOSITORY,
  PDF_UPLOAD_INSPECTOR,
} from './document.types';
import {
  DocumentsController,
  DocumentUploadPolicyController,
} from './documents.controller';
import { DocumentsService } from './documents.service';
import { PdfJsDocumentTextExtractor } from './pdfjs-document-text.extractor';
import { PdfJsUploadInspector } from './pdfjs-upload.inspector';
import { PrivateDocumentFileStorage } from './private-document-file.storage';
import { SqliteDocumentRepository } from './sqlite-document.repository';
import {
  MarkdownDocumentTextExtractor,
  PlainTextDocumentTextExtractor,
} from './utf8-document-text.extractors';

@Module({
  imports: [ProjectsModule],
  controllers: [DocumentUploadPolicyController, DocumentsController],
  providers: [
    DocumentsService,
    DocumentUploadInterceptor,
    DocumentProcessingCoordinator,
    DocumentTextNormalizer,
    DocumentUploadValidator,
    PlainTextDocumentTextExtractor,
    MarkdownDocumentTextExtractor,
    PdfJsDocumentTextExtractor,
    PdfJsUploadInspector,
    ClamAvDocumentMalwareScanner,
    DeterministicDocumentMalwareScanner,
    PrivateDocumentFileStorage,
    SqliteDocumentRepository,
    {
      provide: DOCUMENT_REPOSITORY,
      useExisting: SqliteDocumentRepository,
    },
    {
      provide: PDF_UPLOAD_INSPECTOR,
      useExisting: PdfJsUploadInspector,
    },
    {
      provide: DOCUMENT_FILE_STORAGE,
      useExisting: PrivateDocumentFileStorage,
    },
    {
      provide: DOCUMENT_MALWARE_SCANNER,
      inject: [
        appConfig.KEY,
        ClamAvDocumentMalwareScanner,
        DeterministicDocumentMalwareScanner,
      ],
      useFactory: (
        application: ConfigType<typeof appConfig>,
        clamAv: ClamAvDocumentMalwareScanner,
        deterministic: DeterministicDocumentMalwareScanner,
      ) => (application.environment === 'production' ? clamAv : deterministic),
    },
    {
      provide: DOCUMENT_PROCESSING_QUEUE,
      useExisting: DocumentProcessingCoordinator,
    },
    {
      provide: DOCUMENT_CONTEXT_SOURCE_READER,
      useExisting: DocumentsService,
    },
  ],
  exports: [DocumentsService, DOCUMENT_CONTEXT_SOURCE_READER],
})
export class DocumentsModule {}
