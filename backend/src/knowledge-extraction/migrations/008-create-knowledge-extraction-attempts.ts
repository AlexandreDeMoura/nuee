export const CREATE_KNOWLEDGE_EXTRACTION_ATTEMPTS_MIGRATION = `
  CREATE TABLE knowledge_extraction_attempts (
    id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
    project_id TEXT NOT NULL,
    discussion_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL CHECK (
      length(trim(idempotency_key)) > 0
      AND length(idempotency_key) <= 200
    ),
    request_fingerprint TEXT NOT NULL CHECK (
      length(request_fingerprint) = 64
    ),
    source_snapshot TEXT NOT NULL CHECK (
      json_valid(source_snapshot)
      AND json_type(source_snapshot) = 'object'
      AND json_extract(source_snapshot, '$.version') = 1
      AND json_type(source_snapshot, '$.project_id') = 'text'
      AND json_extract(source_snapshot, '$.project_id') = project_id
      AND json_type(source_snapshot, '$.discussion_id') = 'text'
      AND json_extract(source_snapshot, '$.discussion_id') = discussion_id
      AND json_type(source_snapshot, '$.discussion_title') = 'text'
      AND length(trim(json_extract(
        source_snapshot,
        '$.discussion_title'
      ))) > 0
      AND json_type(source_snapshot, '$.requested_at') = 'text'
      AND json_extract(
        source_snapshot,
        '$.message_selection_kind'
      ) IN ('selected', 'whole_discussion')
      AND json_type(source_snapshot, '$.messages') = 'array'
      AND json_type(
        source_snapshot,
        '$.frozen_context_items'
      ) = 'array'
      AND (
        json_array_length(json_extract(source_snapshot, '$.messages'))
        + json_array_length(json_extract(
          source_snapshot,
          '$.frozen_context_items'
        ))
      ) > 0
    ),
    proposal TEXT CHECK (
      proposal IS NULL
      OR (json_valid(proposal) AND json_type(proposal) = 'object')
    ),
    status TEXT NOT NULL CHECK (
      status IN (
        'generating',
        'ready',
        'failed',
        'resolved',
        'discarded'
      )
    ),
    resolution_fingerprint TEXT CHECK (
      resolution_fingerprint IS NULL
      OR length(resolution_fingerprint) = 64
    ),
    resolution_kind TEXT CHECK (
      resolution_kind IS NULL
      OR resolution_kind IN ('new_bubble', 'update_bubble', 'reject')
    ),
    resulting_bubble_id TEXT CHECK (
      resulting_bubble_id IS NULL
      OR length(trim(resulting_bubble_id)) > 0
    ),
    retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
    created_at TEXT NOT NULL CHECK (length(trim(created_at)) > 0),
    updated_at TEXT NOT NULL CHECK (length(trim(updated_at)) > 0),
    expires_at TEXT NOT NULL CHECK (length(trim(expires_at)) > 0),
    UNIQUE (project_id, discussion_id, idempotency_key),
    CHECK (
      (
        status IN ('generating', 'failed')
        AND proposal IS NULL
      )
      OR (
        status IN ('ready', 'resolved')
        AND proposal IS NOT NULL
      )
      OR status = 'discarded'
    ),
    CHECK (
      (
        status <> 'resolved'
        AND resolution_fingerprint IS NULL
        AND resolution_kind IS NULL
        AND resulting_bubble_id IS NULL
      )
      OR (
        status = 'resolved'
        AND proposal IS NOT NULL
        AND resolution_fingerprint IS NOT NULL
        AND resolution_kind IS NOT NULL
        AND (
          (
            resolution_kind = 'reject'
            AND resulting_bubble_id IS NULL
          )
          OR (
            resolution_kind IN ('new_bubble', 'update_bubble')
            AND resulting_bubble_id IS NOT NULL
          )
        )
      )
    ),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (discussion_id) REFERENCES discussions(id) ON DELETE CASCADE
  ) STRICT;

  CREATE INDEX knowledge_extraction_attempts_expiry_idx
    ON knowledge_extraction_attempts (expires_at ASC, id ASC);

  CREATE INDEX knowledge_extraction_attempts_discussion_status_idx
    ON knowledge_extraction_attempts (
      project_id,
      discussion_id,
      status,
      created_at DESC
    );

  CREATE TRIGGER knowledge_extraction_attempts_scope_insert_guard
  BEFORE INSERT ON knowledge_extraction_attempts
  WHEN NOT EXISTS (
    SELECT 1
    FROM discussions
    WHERE
      discussions.id = NEW.discussion_id
      AND discussions.project_id = NEW.project_id
      AND discussions.deleted_at IS NULL
  )
  BEGIN
    SELECT RAISE(
      ABORT,
      'knowledge extraction discussion must be available in its project'
    );
  END;

  CREATE TRIGGER knowledge_extraction_attempts_source_immutable_guard
  BEFORE UPDATE OF
    project_id,
    discussion_id,
    idempotency_key,
    request_fingerprint,
    source_snapshot,
    created_at,
    expires_at
  ON knowledge_extraction_attempts
  BEGIN
    SELECT RAISE(
      ABORT,
      'knowledge extraction source snapshot is immutable'
    );
  END;
`;
