import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { DocumentUploadValidator } from './document-upload.validator';
import {
  DOCUMENT_FILE_STORAGE,
  DOCUMENT_REPOSITORY,
  PDF_UPLOAD_INSPECTOR,
} from './document.types';
import { DocumentsService } from './documents.service';
import { PdfJsUploadInspector } from './pdfjs-upload.inspector';
import { PrivateDocumentFileStorage } from './private-document-file.storage';
import { SqliteDocumentRepository } from './sqlite-document.repository';

@Module({
  imports: [ProjectsModule],
  providers: [
    DocumentsService,
    DocumentUploadValidator,
    PdfJsUploadInspector,
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
  ],
  exports: [DocumentsService],
})
export class DocumentsModule {}
