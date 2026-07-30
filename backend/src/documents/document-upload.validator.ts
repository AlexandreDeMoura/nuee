import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { DocumentUploadFormatPolicy } from '@nuee/shared-types';
import { documentsConfig } from '../config/configuration';
import {
  PDF_UPLOAD_INSPECTOR,
  DocumentUploadValidationError,
  PdfUploadInspectionError,
  type DocumentUploadFile,
  type PdfUploadInspector,
  type ValidatedDocumentUpload,
} from './document.types';

const MAX_FILENAME_LENGTH = 255;
const PDF_SIGNATURE = Buffer.from('%PDF-', 'ascii');
const PDF_HEADER_SEARCH_LIMIT = 1_024;
const DISALLOWED_FILENAME_CHARACTERS = /[\p{Cc}\p{Cf}]/gu;

@Injectable()
export class DocumentUploadValidator {
  constructor(
    @Inject(documentsConfig.KEY)
    private readonly config: ConfigType<typeof documentsConfig>,
    @Inject(PDF_UPLOAD_INSPECTOR)
    private readonly pdfInspector: PdfUploadInspector,
  ) {}

  async validate(file: DocumentUploadFile): Promise<ValidatedDocumentUpload> {
    const originalFilename = this.normalizeFilename(file?.original_filename);
    const formatPolicy = this.formatPolicy(originalFilename);
    const mimeType = this.validateMimeType(
      file?.declared_mime_type,
      formatPolicy,
    );
    const bytes = this.copyBytes(file?.bytes);

    if (bytes.byteLength === 0) {
      throw new DocumentUploadValidationError(
        'empty_file',
        'The selected document is empty.',
      );
    }

    if (bytes.byteLength > this.config.max_file_size_bytes) {
      throw new DocumentUploadValidationError(
        'file_too_large',
        `The selected document exceeds the ${this.config.max_file_size_bytes}-byte upload limit.`,
      );
    }

    if (formatPolicy.category === 'pdf') {
      await this.validatePdf(bytes);
    } else {
      this.validateUtf8Text(bytes);
    }

    const sourceHash = createHash('sha256').update(bytes).digest('hex');
    const title = this.deriveTitle(originalFilename);
    const requestFingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          version: 1,
          original_filename: originalFilename,
          title,
          format: formatPolicy.category,
          mime_type: mimeType,
          size_bytes: bytes.byteLength,
          source_hash: sourceHash,
        }),
      )
      .digest('hex');

    return {
      original_filename: originalFilename,
      title,
      format: formatPolicy.category,
      mime_type: mimeType,
      size_bytes: bytes.byteLength,
      source_hash: sourceHash,
      request_fingerprint: requestFingerprint,
      bytes,
    };
  }

  normalizeFilename(value: unknown): string {
    if (typeof value !== 'string') {
      throw this.invalidFilename();
    }

    const withoutDevicePath = value.split(/[\\/]/u).at(-1) ?? '';
    const normalized = withoutDevicePath
      .normalize('NFC')
      .replace(DISALLOWED_FILENAME_CHARACTERS, '')
      .replace(/\s+/gu, ' ')
      .trim();

    if (normalized.length === 0 || normalized === '.' || normalized === '..') {
      throw this.invalidFilename();
    }

    return this.truncateFilename(normalized, MAX_FILENAME_LENGTH);
  }

  deriveTitle(filename: string): string {
    const extension = extname(filename);
    const title = filename
      .slice(0, filename.length - extension.length)
      .replace(/[_-]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();

    if (title.length === 0) {
      throw this.invalidFilename(
        'The filename must include a title before its extension.',
      );
    }

    return [...title].slice(0, MAX_FILENAME_LENGTH).join('');
  }

  private formatPolicy(filename: string): DocumentUploadFormatPolicy {
    const extension = extname(filename).toLowerCase();
    const policy = this.config.supported_formats.find((candidate) =>
      candidate.extensions.includes(extension),
    );

    if (!policy) {
      throw new DocumentUploadValidationError(
        'unsupported_extension',
        `Supported document extensions are ${this.config.supported_formats
          .flatMap((candidate) => candidate.extensions)
          .join(', ')}.`,
      );
    }

    return policy;
  }

  private validateMimeType(
    value: unknown,
    formatPolicy: DocumentUploadFormatPolicy,
  ): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new DocumentUploadValidationError(
        'mime_type_invalid',
        'The selected document must declare a supported MIME type.',
      );
    }

    const mimeType = value.split(';', 1)[0]?.trim().toLowerCase() ?? '';

    if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u.test(mimeType)) {
      throw new DocumentUploadValidationError(
        'mime_type_invalid',
        'The selected document has an invalid MIME type.',
      );
    }

    if (!formatPolicy.mime_types.includes(mimeType)) {
      throw new DocumentUploadValidationError(
        'mime_type_mismatch',
        'The declared MIME type does not match the filename extension.',
      );
    }

    return mimeType;
  }

  private copyBytes(value: unknown): Buffer {
    if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) {
      throw new DocumentUploadValidationError(
        'empty_file',
        'A complete readable document file is required.',
      );
    }

    return Buffer.from(value);
  }

  private validateUtf8Text(bytes: Buffer): void {
    let decoded: string;

    try {
      decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new DocumentUploadValidationError(
        'invalid_utf8',
        'Text and Markdown documents must use valid UTF-8 encoding.',
      );
    }

    if (this.hasDisallowedTextControl(decoded)) {
      throw new DocumentUploadValidationError(
        'binary_content',
        'The selected text document contains binary content.',
      );
    }
  }

  private hasDisallowedTextControl(value: string): boolean {
    return [...value].some((character) => {
      const codePoint = character.codePointAt(0);

      return (
        codePoint !== undefined &&
        (codePoint === 0x7f ||
          (codePoint >= 0x00 && codePoint <= 0x08) ||
          codePoint === 0x0b ||
          (codePoint >= 0x0e && codePoint <= 0x1f))
      );
    });
  }

  private async validatePdf(bytes: Buffer): Promise<void> {
    const signatureOffset = bytes.indexOf(PDF_SIGNATURE);

    if (
      signatureOffset < 0 ||
      signatureOffset >= PDF_HEADER_SEARCH_LIMIT ||
      !/^%PDF-\d\.\d/u.test(
        bytes.subarray(signatureOffset, signatureOffset + 8).toString('ascii'),
      )
    ) {
      throw new DocumentUploadValidationError(
        'invalid_pdf',
        'The selected file does not contain a valid PDF signature.',
      );
    }

    try {
      const inspection = await this.pdfInspector.inspect(bytes);

      if (
        !Number.isSafeInteger(inspection.page_count) ||
        inspection.page_count <= 0
      ) {
        throw new DocumentUploadValidationError(
          'invalid_pdf',
          'The selected PDF could not be parsed.',
        );
      }

      if (inspection.page_count > this.config.maxPdfPages) {
        throw new DocumentUploadValidationError(
          'pdf_too_complex',
          `PDF documents may contain at most ${this.config.maxPdfPages} pages.`,
        );
      }
    } catch (error) {
      if (error instanceof DocumentUploadValidationError) {
        throw error;
      }

      if (!(error instanceof PdfUploadInspectionError)) {
        throw new DocumentUploadValidationError(
          'invalid_pdf',
          'The selected PDF could not be parsed.',
        );
      }

      if (error.code === 'encrypted') {
        throw new DocumentUploadValidationError(
          'encrypted_pdf',
          'Encrypted or password-protected PDF documents are not supported.',
        );
      }

      if (error.code === 'unavailable') {
        throw new DocumentUploadValidationError(
          'validation_unavailable',
          'PDF validation is temporarily unavailable.',
        );
      }

      throw new DocumentUploadValidationError(
        'invalid_pdf',
        'The selected PDF is corrupted or inaccessible.',
      );
    }
  }

  private truncateFilename(filename: string, maximumLength: number): string {
    const characters = [...filename];

    if (characters.length <= maximumLength) {
      return filename;
    }

    const extension = extname(filename);
    const extensionCharacters = [...extension];
    const stem = filename.slice(0, filename.length - extension.length);
    const retainedExtension = extensionCharacters.slice(0, maximumLength - 1);
    const retainedStem = [...stem].slice(
      0,
      maximumLength - retainedExtension.length,
    );

    return [...retainedStem, ...retainedExtension].join('');
  }

  private invalidFilename(
    message = 'A valid document filename is required.',
  ): DocumentUploadValidationError {
    return new DocumentUploadValidationError('filename_invalid', message);
  }
}
