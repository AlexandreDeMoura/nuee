import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import type {
  DocumentDetail,
  DocumentListResponse,
  DocumentUploadPolicyResponse,
  RetryDocumentProcessingResponse,
  UploadDocumentResponse,
} from '@nuee/shared-types';
import { DocumentUploadInterceptor } from './document-upload.interceptor';
import { DocumentsService } from './documents.service';

interface UploadedDocumentFile {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
}

@Controller('document-upload-policy')
export class DocumentUploadPolicyController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  get(): DocumentUploadPolicyResponse {
    return this.documents.uploadPolicy();
  }
}

@Controller('projects/:projectId/documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Post()
  @UseInterceptors(DocumentUploadInterceptor)
  upload(
    @Param('projectId') projectId: string,
    @Body('idempotency_key') idempotencyKey: unknown,
    @UploadedFile() file: UploadedDocumentFile | undefined,
  ): Promise<UploadDocumentResponse> {
    return this.documents.upload(projectId, {
      idempotency_key: idempotencyKey,
      file: {
        original_filename: file?.originalname,
        declared_mime_type: file?.mimetype,
        bytes: file?.buffer,
      },
    });
  }

  @Get()
  list(@Param('projectId') projectId: string): DocumentListResponse {
    return this.documents.list(projectId);
  }

  @Get(':documentId')
  get(
    @Param('projectId') projectId: string,
    @Param('documentId') documentId: string,
  ): DocumentDetail {
    return this.documents.get(projectId, documentId);
  }

  @Post(':documentId/retry')
  @HttpCode(HttpStatus.OK)
  retry(
    @Param('projectId') projectId: string,
    @Param('documentId') documentId: string,
  ): RetryDocumentProcessingResponse {
    return this.documents.retry(projectId, documentId);
  }
}
