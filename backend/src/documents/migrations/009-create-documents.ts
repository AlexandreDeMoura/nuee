export const CREATE_DOCUMENTS_MIGRATION = `
  CREATE TABLE documents (
    id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
    project_id TEXT NOT NULL,
    title TEXT NOT NULL CHECK (
      length(trim(title)) > 0
      AND length(title) <= 255
    ),
    original_filename TEXT NOT NULL CHECK (
      length(trim(original_filename)) > 0
      AND length(original_filename) <= 255
    ),
    file_reference TEXT NOT NULL UNIQUE CHECK (
      length(trim(file_reference)) > 0
      AND length(file_reference) <= 500
    ),
    format TEXT NOT NULL CHECK (
      format IN ('plain_text', 'markdown', 'pdf')
    ),
    mime_type TEXT NOT NULL CHECK (
      length(trim(mime_type)) > 0
      AND length(mime_type) <= 255
    ),
    size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
    source_hash TEXT NOT NULL CHECK (
      length(source_hash) = 64
      AND source_hash NOT GLOB '*[^0-9a-f]*'
    ),
    extracted_text TEXT,
    processed_source_hash TEXT CHECK (
      processed_source_hash IS NULL
      OR (
        length(processed_source_hash) = 64
        AND processed_source_hash NOT GLOB '*[^0-9a-f]*'
      )
    ),
    processing_status TEXT NOT NULL DEFAULT 'processing' CHECK (
      processing_status IN ('processing', 'ready', 'failed')
    ),
    processing_error_code TEXT CHECK (
      processing_error_code IS NULL
      OR processing_error_code IN (
        'unsafe',
        'encrypted',
        'corrupted',
        'no_text',
        'too_complex',
        'storage_unavailable',
        'scanner_unavailable',
        'processing_unavailable',
        'unknown'
      )
    ),
    processing_error_retryable INTEGER NOT NULL DEFAULT 0 CHECK (
      processing_error_retryable IN (0, 1)
    ),
    upload_idempotency_key TEXT NOT NULL CHECK (
      length(trim(upload_idempotency_key)) > 0
      AND length(upload_idempotency_key) <= 200
    ),
    upload_request_fingerprint TEXT NOT NULL CHECK (
      length(upload_request_fingerprint) = 64
      AND upload_request_fingerprint NOT GLOB '*[^0-9a-f]*'
    ),
    processing_generation INTEGER NOT NULL DEFAULT 1 CHECK (
      processing_generation > 0
    ),
    processing_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (
      processing_attempt_count >= 0
    ),
    processing_started_at TEXT,
    processing_completed_at TEXT,
    processing_lease_owner TEXT CHECK (
      processing_lease_owner IS NULL
      OR length(trim(processing_lease_owner)) > 0
    ),
    processing_lease_expires_at TEXT,
    created_at TEXT NOT NULL CHECK (length(trim(created_at)) > 0),
    updated_at TEXT NOT NULL CHECK (length(trim(updated_at)) > 0),
    UNIQUE (project_id, upload_idempotency_key),
    CHECK (
      (processing_lease_owner IS NULL) =
        (processing_lease_expires_at IS NULL)
    ),
    CHECK (
      (
        processing_status = 'processing'
        AND extracted_text IS NULL
        AND processed_source_hash IS NULL
        AND processing_error_code IS NULL
        AND processing_error_retryable = 0
        AND processing_completed_at IS NULL
        AND (
          processing_attempt_count > 0
          OR (
            processing_started_at IS NULL
            AND processing_lease_owner IS NULL
          )
        )
        AND (
          processing_attempt_count = 0
          OR processing_started_at IS NOT NULL
        )
      )
      OR (
        processing_status = 'ready'
        AND extracted_text IS NOT NULL
        AND length(trim(extracted_text)) > 0
        AND processed_source_hash = source_hash
        AND processing_error_code IS NULL
        AND processing_error_retryable = 0
        AND processing_attempt_count > 0
        AND processing_started_at IS NOT NULL
        AND processing_completed_at IS NOT NULL
        AND processing_lease_owner IS NULL
      )
      OR (
        processing_status = 'failed'
        AND extracted_text IS NULL
        AND processed_source_hash IS NULL
        AND processing_error_code IS NOT NULL
        AND processing_attempt_count > 0
        AND processing_started_at IS NOT NULL
        AND processing_completed_at IS NOT NULL
        AND processing_lease_owner IS NULL
      )
    ),
    CHECK (
      processing_lease_owner IS NULL
      OR processing_status = 'processing'
    ),
    CHECK (
      processing_completed_at IS NULL
      OR (
        processing_started_at IS NOT NULL
        AND processing_completed_at >= processing_started_at
      )
    ),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  ) STRICT;

  CREATE INDEX documents_project_order_idx
    ON documents (project_id, created_at DESC, id ASC);

  CREATE INDEX documents_processing_queue_idx
    ON documents (
      processing_status,
      processing_lease_expires_at ASC,
      updated_at ASC,
      id ASC
    )
    WHERE processing_status = 'processing';

  CREATE TRIGGER documents_source_immutable_guard
  BEFORE UPDATE OF
    project_id,
    original_filename,
    file_reference,
    format,
    mime_type,
    size_bytes,
    source_hash,
    upload_idempotency_key,
    upload_request_fingerprint,
    created_at
  ON documents
  WHEN
    NEW.project_id IS NOT OLD.project_id
    OR NEW.original_filename IS NOT OLD.original_filename
    OR NEW.file_reference IS NOT OLD.file_reference
    OR NEW.format IS NOT OLD.format
    OR NEW.mime_type IS NOT OLD.mime_type
    OR NEW.size_bytes IS NOT OLD.size_bytes
    OR NEW.source_hash IS NOT OLD.source_hash
    OR NEW.upload_idempotency_key IS NOT OLD.upload_idempotency_key
    OR NEW.upload_request_fingerprint IS NOT OLD.upload_request_fingerprint
    OR NEW.created_at IS NOT OLD.created_at
  BEGIN
    SELECT RAISE(ABORT, 'document source metadata is immutable');
  END;

  CREATE TRIGGER documents_processing_transition_guard
  BEFORE UPDATE OF
    processing_status,
    extracted_text,
    processed_source_hash,
    processing_error_code,
    processing_error_retryable,
    processing_generation,
    processing_attempt_count,
    processing_started_at,
    processing_completed_at,
    processing_lease_owner,
    processing_lease_expires_at
  ON documents
  WHEN
    NEW.processing_generation < OLD.processing_generation
    OR NEW.processing_generation > OLD.processing_generation + 1
    OR (
      NEW.processing_generation = OLD.processing_generation + 1
      AND NOT (
        OLD.processing_status = 'failed'
        AND OLD.processing_error_retryable = 1
        AND NEW.processing_status = 'processing'
        AND NEW.processing_attempt_count = 0
      )
    )
    OR (
      NEW.processing_generation = OLD.processing_generation
      AND (
        NEW.processing_attempt_count < OLD.processing_attempt_count
        OR NEW.processing_attempt_count > OLD.processing_attempt_count + 1
        OR (
          OLD.processing_status = 'ready'
          AND NEW.processing_status <> 'ready'
        )
        OR (
          OLD.processing_status = 'failed'
          AND NEW.processing_status <> 'failed'
        )
      )
    )
  BEGIN
    SELECT RAISE(ABORT, 'invalid document processing transition');
  END;
`;
