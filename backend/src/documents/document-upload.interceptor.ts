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

/** An upload request carries one `idempotency_key` field beside the file. */
const MAX_FIELDS_PER_REQUEST = 1;

/**
 * Busboy emits `partsLimit` when the part count reaches the configured limit
 * rather than when it exceeds it, so the accepted parts need one spare slot.
 * Without it a well-formed single-file upload is rejected as `LIMIT_PART_COUNT`.
 */
const PARTS_LIMIT_HEADROOM = 1;

type MultipartFailure = {
  readonly reason: string;
  readonly field: 'file' | 'idempotency_key';
  readonly detail: string;
};

/**
 * Multer failures reach the interceptor as `BadRequestException`s carrying the
 * multer or busboy message, optionally suffixed with ` - <field name>`.
 */
const MULTIPART_FAILURES: ReadonlyMap<string, MultipartFailure> = new Map([
  [
    'Too many parts',
    {
      reason: 'multipart_too_many_parts',
      field: 'file',
      detail: 'Send exactly one file and one idempotency key per request.',
    },
  ],
  [
    'Too many files',
    {
      reason: 'multipart_too_many_files',
      field: 'file',
      detail: 'Upload one file per request.',
    },
  ],
  [
    'Too many fields',
    {
      reason: 'multipart_too_many_fields',
      field: 'idempotency_key',
      detail: 'Send only the idempotency key beside the file.',
    },
  ],
  [
    'Unexpected field',
    {
      reason: 'multipart_unexpected_field',
      field: 'file',
      detail: 'Send the document in a field named "file".',
    },
  ],
  [
    'Field name too long',
    {
      reason: 'multipart_field_name_too_long',
      field: 'idempotency_key',
      detail: 'The upload field name is too long.',
    },
  ],
  [
    'Field value too long',
    {
      reason: 'multipart_field_value_too_long',
      field: 'idempotency_key',
      detail: `Idempotency key must be ${MAX_IDEMPOTENCY_KEY_BYTES} bytes or fewer.`,
    },
  ],
]);

const UNRECOGNIZED_MULTIPART_FAILURE: MultipartFailure = {
  reason: 'multipart_invalid',
  field: 'file',
  detail: 'Provide exactly one file and one idempotency key.',
};

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
        fields: MAX_FIELDS_PER_REQUEST,
        parts:
          MAX_FIELDS_PER_REQUEST +
          config.max_files_per_request +
          PARTS_LIMIT_HEADROOM,
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
        const failure = describeMultipartFailure(error.message);

        throw new BadRequestException({
          code: 'DOCUMENT_UPLOAD_VALIDATION_FAILED',
          message: 'The document upload request is invalid.',
          reason: failure.reason,
          field_errors: {
            [failure.field]: failure.detail,
          },
        });
      }

      throw error;
    }
  }
}

function describeMultipartFailure(message: string): MultipartFailure {
  const [multerMessage] = message.split(' - ');

  return (
    MULTIPART_FAILURES.get(multerMessage) ?? UNRECOGNIZED_MULTIPART_FAILURE
  );
}
