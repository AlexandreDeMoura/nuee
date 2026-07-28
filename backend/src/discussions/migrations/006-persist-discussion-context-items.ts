export const PERSIST_DISCUSSION_CONTEXT_ITEMS_MIGRATION = `
  ALTER TABLE discussions
    ADD COLUMN context_version INTEGER CHECK (
      context_version IS NULL OR context_version = 1
    );

  ALTER TABLE discussions
    ADD COLUMN expected_context_item_count INTEGER CHECK (
      expected_context_item_count IS NULL OR expected_context_item_count > 0
    );

  ALTER TABLE discussions
    ADD COLUMN creation_idempotency_key TEXT CHECK (
      creation_idempotency_key IS NULL OR (
        length(trim(creation_idempotency_key)) > 0
        AND length(creation_idempotency_key) <= 200
      )
    );

  ALTER TABLE discussions
    ADD COLUMN creation_request_fingerprint TEXT CHECK (
      creation_request_fingerprint IS NULL OR (
        length(trim(creation_request_fingerprint)) > 0
        AND length(creation_request_fingerprint) <= 200
      )
    );

  CREATE TABLE discussion_context_items (
    id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
    discussion_id TEXT NOT NULL,
    source_kind TEXT NOT NULL CHECK (
      source_kind IN ('project_description', 'bubble', 'document')
    ),
    source_id TEXT NOT NULL CHECK (length(trim(source_id)) > 0),
    source_title TEXT NOT NULL CHECK (length(trim(source_title)) > 0),
    frozen_content TEXT NOT NULL CHECK (
      source_kind = 'project_description'
      OR length(trim(frozen_content)) > 0
    ),
    created_at TEXT NOT NULL CHECK (length(trim(created_at)) > 0),
    display_order INTEGER NOT NULL CHECK (display_order >= 0),
    UNIQUE (discussion_id, display_order),
    UNIQUE (discussion_id, source_kind, source_id),
    FOREIGN KEY (discussion_id) REFERENCES discussions(id) ON DELETE CASCADE
  ) STRICT;

  CREATE UNIQUE INDEX discussion_context_items_project_description_idx
    ON discussion_context_items (discussion_id)
    WHERE source_kind = 'project_description';

  CREATE INDEX discussion_context_items_discussion_order_idx
    ON discussion_context_items (discussion_id, display_order ASC);

  CREATE UNIQUE INDEX discussions_project_creation_idempotency_idx
    ON discussions (project_id, creation_idempotency_key)
    WHERE creation_idempotency_key IS NOT NULL;

  CREATE TRIGGER discussions_context_metadata_insert_guard
  BEFORE INSERT ON discussions
  WHEN
    (NEW.context_version IS NULL) !=
      (NEW.expected_context_item_count IS NULL)
    OR (NEW.context_version IS NULL) !=
      (NEW.creation_idempotency_key IS NULL)
    OR (NEW.context_version IS NULL) !=
      (NEW.creation_request_fingerprint IS NULL)
  BEGIN
    SELECT RAISE(
      ABORT,
      'discussion context metadata must be wholly null or wholly populated'
    );
  END;

  CREATE TRIGGER discussions_versioned_context_direct_insert_guard
  BEFORE INSERT ON discussions
  WHEN NEW.context_version IS NOT NULL
  BEGIN
    SELECT RAISE(
      ABORT,
      'versioned discussion context must be finalized atomically'
    );
  END;

  CREATE TRIGGER discussions_context_metadata_update_guard
  BEFORE UPDATE OF
    context_version,
    expected_context_item_count,
    creation_idempotency_key,
    creation_request_fingerprint
  ON discussions
  BEGIN
    SELECT CASE
      WHEN
        OLD.context_version IS NOT NULL
        AND (
          NEW.context_version IS NOT OLD.context_version
          OR NEW.expected_context_item_count
            IS NOT OLD.expected_context_item_count
          OR NEW.creation_idempotency_key
            IS NOT OLD.creation_idempotency_key
          OR NEW.creation_request_fingerprint
            IS NOT OLD.creation_request_fingerprint
        )
      THEN RAISE(
        ABORT,
        'versioned discussion context metadata is immutable'
      )
    END;

    SELECT CASE
      WHEN
        (NEW.context_version IS NULL) !=
          (NEW.expected_context_item_count IS NULL)
        OR (NEW.context_version IS NULL) !=
          (NEW.creation_idempotency_key IS NULL)
        OR (NEW.context_version IS NULL) !=
          (NEW.creation_request_fingerprint IS NULL)
      THEN RAISE(
        ABORT,
        'discussion context metadata must be wholly null or wholly populated'
      )
    END;

    SELECT CASE
      WHEN
        NEW.context_version IS NOT NULL
        AND (
          SELECT COUNT(*)
          FROM discussion_context_items
          WHERE discussion_id = NEW.id
        ) != NEW.expected_context_item_count
      THEN RAISE(
        ABORT,
        'discussion context item count does not match metadata'
      )
    END;

    SELECT CASE
      WHEN
        NEW.context_version IS NOT NULL
        AND (
          SELECT COUNT(*)
          FROM discussion_context_items
          WHERE
            discussion_id = NEW.id
            AND source_kind = 'project_description'
        ) != 1
      THEN RAISE(
        ABORT,
        'discussion context must contain one project description'
      )
    END;

    SELECT CASE
      WHEN
        NEW.context_version IS NOT NULL
        AND (
          SELECT COUNT(*)
          FROM discussion_context_items
          WHERE
            discussion_id = NEW.id
            AND display_order >= 0
            AND display_order < NEW.expected_context_item_count
        ) != NEW.expected_context_item_count
      THEN RAISE(
        ABORT,
        'discussion context display order must be contiguous'
      )
    END;
  END;
`;
