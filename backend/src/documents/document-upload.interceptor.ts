import {
  BadRequestException,
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Observable } from 'rxjs';
import { documentsConfig } from '../config/configuration';

const MAX_IDEMPOTENCY_KEY_BYTES = 200 * 4;

@Injectable()
export class DocumentUploadInterceptor implements NestInterceptor {
  private readonly delegate: NestInterceptor;

  constructor(
    @Inject(documentsConfig.KEY)
    private readonly config: ConfigType<typeof documentsConfig>,
  ) {
    const Interceptor = FileInterceptor('file', {
      limits: {
        fileSize: config.max_file_size_bytes,
        files: config.max_files_per_request,
        fields: 1,
        parts: config.max_files_per_request + 1,
        fieldNameSize: 100,
        fieldSize: MAX_IDEMPOTENCY_KEY_BYTES,
      },
    });

    this.delegate = new Interceptor();
  }

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    try {
      return (await this.delegate.intercept(
        context,
        next,
      )) as Observable<unknown>;
    } catch (error) {
      if (error instanceof PayloadTooLargeException) {
        throw new PayloadTooLargeException({
          code: 'DOCUMENT_UPLOAD_LIMIT_EXCEEDED',
          message: `A document may contain at most ${this.config.max_file_size_bytes} bytes.`,
          reason: 'file_too_large',
          max_file_size_bytes: this.config.max_file_size_bytes,
        });
      }

      if (error instanceof BadRequestException) {
        throw new BadRequestException({
          code: 'DOCUMENT_UPLOAD_VALIDATION_FAILED',
          message: 'The document upload request is invalid.',
          reason: 'multipart_invalid',
          field_errors: {
            file: 'Provide exactly one file and one idempotency key.',
          },
        });
      }

      throw error;
    }
  }
}
