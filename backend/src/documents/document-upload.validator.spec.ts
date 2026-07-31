import { createHash } from 'node:crypto';
import type { DocumentsConfig } from '../config/configuration';
import { DocumentUploadValidator } from './document-upload.validator';
import {
  DocumentUploadValidationError,
  PdfUploadInspectionError,
  type PdfUploadInspection,
  type PdfUploadInspector,
} from './document.types';

class FakePdfUploadInspector implements PdfUploadInspector {
  readonly inspections: Uint8Array[] = [];
  result: PdfUploadInspection = { page_count: 2 };
  error: PdfUploadInspectionError | undefined;

  inspect(bytes: Uint8Array): Promise<PdfUploadInspection> {
    this.inspections.push(bytes);

    if (this.error) {
      return Promise.reject(this.error);
    }

    return Promise.resolve(this.result);
  }
}

describe('DocumentUploadValidator', () => {
  let pdfInspector: FakePdfUploadInspector;
  let validator: DocumentUploadValidator;
  let config: DocumentsConfig;

  beforeEach(() => {
    config = {
      privateStoragePath: undefined,
      supported_formats: [
        {
          category: 'plain_text',
          extensions: ['.txt'],
          mime_types: ['text/plain'],
        },
        {
          category: 'markdown',
          extensions: ['.md'],
          mime_types: ['text/markdown', 'text/x-markdown', 'text/plain'],
        },
        {
          category: 'pdf',
          extensions: ['.pdf'],
          mime_types: ['application/pdf'],
        },
      ],
      max_file_size_bytes: 32,
      max_files_per_request: 1,
      max_documents_per_project: 25,
      max_project_storage_bytes: 100,
      maxPdfPages: 200,
      maxExtractedTextBytes: 64,
      processingTimeoutMs: 30_000,
      processingLeaseMs: 45_000,
      maxProcessingConcurrency: 2,
      maxProcessingAttempts: 3,
      malwareScannerHost: '127.0.0.1',
      malwareScannerPort: 3310,
      malwareScannerTimeoutMs: 10_000,
    };
    pdfInspector = new FakePdfUploadInspector();
    validator = new DocumentUploadValidator(config, pdfInspector);
  });

  it('normalizes device paths and derives deterministic metadata and hashes', async () => {
    const bytes = Buffer.from('# Research\\n\\nComplete notes.', 'utf8');

    const result = await validator.validate({
      original_filename: 'C:\\fakepath\\research_notes.MD',
      declared_mime_type: ' Text/Markdown; charset=utf-8 ',
      bytes,
    });

    expect(result).toEqual({
      original_filename: 'research_notes.MD',
      title: 'research notes',
      format: 'markdown',
      mime_type: 'text/markdown',
      size_bytes: bytes.byteLength,
      source_hash: createHash('sha256').update(bytes).digest('hex'),
      request_fingerprint: result.request_fingerprint,
      bytes,
    });
    expect(result.request_fingerprint).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('copies accepted bytes so later caller mutation cannot alter validation', async () => {
    const bytes = Buffer.from('stable', 'utf8');
    const result = await validator.validate({
      original_filename: 'stable.txt',
      declared_mime_type: 'text/plain',
      bytes,
    });

    bytes.fill(0);

    expect(result.bytes.toString('utf8')).toBe('stable');
  });

  it.each([
    {
      file: {
        original_filename: '',
        declared_mime_type: 'text/plain',
        bytes: Buffer.from('text'),
      },
      code: 'filename_invalid',
    },
    {
      file: {
        original_filename: 'notes.docx',
        declared_mime_type:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        bytes: Buffer.from('text'),
      },
      code: 'unsupported_extension',
    },
    {
      file: {
        original_filename: 'notes.txt',
        declared_mime_type: '',
        bytes: Buffer.from('text'),
      },
      code: 'mime_type_invalid',
    },
    {
      file: {
        original_filename: 'notes.txt',
        declared_mime_type: 'application/pdf',
        bytes: Buffer.from('text'),
      },
      code: 'mime_type_mismatch',
    },
    {
      file: {
        original_filename: 'notes.txt',
        declared_mime_type: 'text/plain',
        bytes: Buffer.alloc(0),
      },
      code: 'empty_file',
    },
    {
      file: {
        original_filename: 'notes.txt',
        declared_mime_type: 'text/plain',
        bytes: Buffer.alloc(33, 65),
      },
      code: 'file_too_large',
    },
    {
      file: {
        original_filename: 'notes.txt',
        declared_mime_type: 'text/plain',
        bytes: Buffer.from([0xc3, 0x28]),
      },
      code: 'invalid_utf8',
    },
    {
      file: {
        original_filename: 'notes.txt',
        declared_mime_type: 'text/plain',
        bytes: Buffer.from([0x61, 0, 0x62]),
      },
      code: 'binary_content',
    },
  ])(
    'rejects invalid independent upload input as $code',
    async ({ file, code }) => {
      await expect(validator.validate(file)).rejects.toMatchObject({
        name: 'DocumentUploadValidationError',
        code,
      });
    },
  );

  it('requires both a PDF signature and a successful parser result', async () => {
    await expect(
      validator.validate({
        original_filename: 'report.pdf',
        declared_mime_type: 'application/pdf',
        bytes: Buffer.from('not a pdf', 'ascii'),
      }),
    ).rejects.toMatchObject({
      code: 'invalid_pdf',
    });
    expect(pdfInspector.inspections).toHaveLength(0);

    const pdfBytes = Buffer.from('%PDF-1.7\\nfixture', 'ascii');
    const accepted = await validator.validate({
      original_filename: 'report.pdf',
      declared_mime_type: 'application/pdf',
      bytes: pdfBytes,
    });

    expect(accepted).toMatchObject({
      format: 'pdf',
      mime_type: 'application/pdf',
    });
    expect(pdfInspector.inspections).toHaveLength(1);
  });

  it.each([
    ['encrypted', 'encrypted_pdf'],
    ['corrupted', 'invalid_pdf'],
    ['unavailable', 'validation_unavailable'],
  ] as const)(
    'maps a %s parser failure to %s',
    async (inspectionCode, validationCode) => {
      pdfInspector.error = new PdfUploadInspectionError(inspectionCode);

      await expect(
        validator.validate({
          original_filename: 'report.pdf',
          declared_mime_type: 'application/pdf',
          bytes: Buffer.from('%PDF-1.7\\nfixture', 'ascii'),
        }),
      ).rejects.toEqual(
        expect.objectContaining<DocumentUploadValidationError>({
          code: validationCode,
        }),
      );
    },
  );

  it('rejects parser results above the configured page limit', async () => {
    pdfInspector.result = { page_count: 201 };

    await expect(
      validator.validate({
        original_filename: 'large.pdf',
        declared_mime_type: 'application/pdf',
        bytes: Buffer.from('%PDF-1.7\\nfixture', 'ascii'),
      }),
    ).rejects.toMatchObject({
      code: 'pdf_too_complex',
    });
  });
});
