import type {
  DocumentFormatCategory,
  DocumentUploadFormatPolicy,
  DocumentUploadPolicy,
} from '../api';

export type DocumentUploadPreflightErrorCode =
  | 'empty_file'
  | 'file_too_large'
  | 'unsupported_extension'
  | 'unsupported_mime_type'
  | 'unreadable_file';

export interface DocumentUploadPreflightError {
  code: DocumentUploadPreflightErrorCode;
  message: string;
}

export type DocumentUploadPreflightResult =
  | {
      format: DocumentFormatCategory;
      ok: true;
    }
  | {
      error: DocumentUploadPreflightError;
      ok: false;
    };

function extensionOf(filename: string): string {
  const dotIndex = filename.lastIndexOf('.');

  return dotIndex > 0 ? filename.slice(dotIndex).toLowerCase() : '';
}

function matchingFormat(
  extension: string,
  formats: readonly DocumentUploadFormatPolicy[],
): DocumentUploadFormatPolicy | undefined {
  return formats.find((format) =>
    format.extensions.some(
      (configuredExtension) =>
        configuredExtension.toLowerCase() === extension,
    ),
  );
}

function readableSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} bytes`;
  }

  const mebibytes = bytes / (1024 * 1024);

  return mebibytes >= 1
    ? `${Number(mebibytes.toFixed(1))} MiB`
    : `${Math.ceil(bytes / 1024)} KiB`;
}

/**
 * Provides immediate feedback for browser-visible file properties. The server
 * remains authoritative and repeats every security-relevant validation.
 */
export async function preflightDocumentUpload(
  file: File,
  policy: DocumentUploadPolicy,
): Promise<DocumentUploadPreflightResult> {
  if (file.size === 0) {
    return {
      error: {
        code: 'empty_file',
        message: 'Choose a document that is not empty.',
      },
      ok: false,
    };
  }

  if (file.size > policy.max_file_size_bytes) {
    return {
      error: {
        code: 'file_too_large',
        message: `Choose a document no larger than ${readableSize(policy.max_file_size_bytes)}.`,
      },
      ok: false,
    };
  }

  const extension = extensionOf(file.name);
  const format = matchingFormat(extension, policy.supported_formats);

  if (!format) {
    const extensions = policy.supported_formats
      .flatMap(({ extensions: configuredExtensions }) => configuredExtensions)
      .join(', ');

    return {
      error: {
        code: 'unsupported_extension',
        message: `Choose a supported document type: ${extensions}.`,
      },
      ok: false,
    };
  }

  const visibleMimeType = file.type.trim().toLowerCase();

  if (
    visibleMimeType.length > 0 &&
    !format.mime_types.some(
      (mimeType) => mimeType.toLowerCase() === visibleMimeType,
    )
  ) {
    return {
      error: {
        code: 'unsupported_mime_type',
        message:
          'The selected file type does not match its filename. Choose a supported document.',
      },
      ok: false,
    };
  }

  try {
    await file.slice(0, 1).arrayBuffer();
  } catch {
    return {
      error: {
        code: 'unreadable_file',
        message: 'This document could not be read. Choose the file again.',
      },
      ok: false,
    };
  }

  return { format: format.category, ok: true };
}
