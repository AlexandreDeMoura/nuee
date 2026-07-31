import type {
  DocumentDetail,
  DocumentSummary,
  DocumentUploadPolicy,
} from '../api';

export const documentUploadPolicyFixture: DocumentUploadPolicy = {
  supported_formats: [
    {
      category: 'plain_text',
      extensions: ['.txt'],
      mime_types: ['text/plain'],
    },
    {
      category: 'markdown',
      extensions: ['.md'],
      mime_types: ['text/markdown', 'text/plain'],
    },
    {
      category: 'pdf',
      extensions: ['.pdf'],
      mime_types: ['application/pdf'],
    },
  ],
  max_file_size_bytes: 10 * 1024 * 1024,
  max_files_per_request: 1,
  max_documents_per_project: 25,
  max_project_storage_bytes: 100 * 1024 * 1024,
};

export function documentSummaryFixture(
  overrides: Partial<DocumentSummary> & Pick<DocumentSummary, 'id' | 'project_id'>,
): DocumentSummary {
  const base = {
    title: 'Research notes',
    original_filename: 'research-notes.txt',
    format: 'plain_text' as const,
    mime_type: 'text/plain',
    size_bytes: 128,
    created_at: '2026-07-30T10:00:00.000Z',
    updated_at: '2026-07-30T10:00:00.000Z',
  };

  if (overrides.processing_status === 'failed') {
    return {
      ...base,
      ...overrides,
      processing_status: 'failed',
      processing_error_code: overrides.processing_error_code ?? 'unknown',
      can_retry: overrides.can_retry ?? false,
    };
  }

  return {
    ...base,
    ...overrides,
    processing_status: overrides.processing_status ?? 'ready',
    processing_error_code: null,
    can_retry: false,
  } as DocumentSummary;
}

export function documentDetailFixture(
  overrides: Partial<DocumentDetail> & Pick<DocumentDetail, 'id' | 'project_id'>,
): DocumentDetail {
  const summary = documentSummaryFixture(overrides);

  return summary.processing_status === 'ready'
    ? {
        ...summary,
        extracted_text: overrides.extracted_text ?? 'Complete processed text.',
      }
    : { ...summary, extracted_text: null };
}
