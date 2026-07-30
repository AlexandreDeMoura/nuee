export const COMPLETE_DISCUSSION_EXTRACTION_PROVENANCE_MIGRATION = `
  ALTER TABLE bubbles
    ADD COLUMN source_context_item_ids TEXT NOT NULL DEFAULT '[]' CHECK (
      json_valid(source_context_item_ids)
      AND json_type(source_context_item_ids) = 'array'
    );

  ALTER TABLE bubbles
    ADD COLUMN source_discussion_title TEXT CHECK (
      source_discussion_title IS NULL
      OR length(trim(source_discussion_title)) > 0
    );

  ALTER TABLE bubbles
    ADD COLUMN source_discussion_deleted_at TEXT CHECK (
      source_discussion_deleted_at IS NULL
      OR length(trim(source_discussion_deleted_at)) > 0
    );

  ALTER TABLE bubbles
    ADD COLUMN latest_extraction_id TEXT CHECK (
      latest_extraction_id IS NULL
      OR length(trim(latest_extraction_id)) > 0
    );

  UPDATE bubbles
  SET
    source_discussion_title = COALESCE(
      (
        SELECT COALESCE(discussions.title, 'Untitled discussion')
        FROM discussions
        WHERE discussions.id = bubbles.source_discussion_id
          AND discussions.project_id = bubbles.project_id
      ),
      'Unavailable discussion'
    ),
    source_discussion_deleted_at = CASE
      WHEN EXISTS (
        SELECT 1
        FROM discussions
        WHERE discussions.id = bubbles.source_discussion_id
          AND discussions.project_id = bubbles.project_id
      )
      THEN (
        SELECT discussions.deleted_at
        FROM discussions
        WHERE discussions.id = bubbles.source_discussion_id
          AND discussions.project_id = bubbles.project_id
      )
      ELSE updated_at
    END,
    latest_extraction_id = 'legacy:' || id
  WHERE source_kind = 'discussion';

  CREATE UNIQUE INDEX bubbles_latest_extraction_id_idx
    ON bubbles (latest_extraction_id)
    WHERE latest_extraction_id IS NOT NULL;

  CREATE TRIGGER bubbles_provenance_insert_guard
  BEFORE INSERT ON bubbles
  WHEN NOT (
    (
      NEW.source_kind = 'manual'
      AND NEW.source_discussion_id IS NULL
      AND NEW.source_discussion_title IS NULL
      AND NEW.source_discussion_deleted_at IS NULL
      AND NEW.latest_extraction_id IS NULL
      AND json_array_length(NEW.source_message_ids) = 0
      AND json_array_length(NEW.source_context_item_ids) = 0
    )
    OR
    (
      NEW.source_kind = 'discussion'
      AND NEW.source_discussion_id IS NOT NULL
      AND length(trim(NEW.source_discussion_id)) > 0
      AND NEW.source_discussion_title IS NOT NULL
      AND length(trim(NEW.source_discussion_title)) > 0
      AND NEW.latest_extraction_id IS NOT NULL
      AND length(trim(NEW.latest_extraction_id)) > 0
      AND (
        json_array_length(NEW.source_message_ids)
        + json_array_length(NEW.source_context_item_ids)
      ) > 0
      AND NOT EXISTS (
        SELECT 1
        FROM json_each(NEW.source_message_ids)
        WHERE type <> 'text' OR length(trim(value)) = 0
      )
      AND NOT EXISTS (
        SELECT 1
        FROM json_each(NEW.source_context_item_ids)
        WHERE type <> 'text' OR length(trim(value)) = 0
      )
      AND json_array_length(NEW.source_message_ids) = (
        SELECT COUNT(DISTINCT value)
        FROM json_each(NEW.source_message_ids)
      )
      AND json_array_length(NEW.source_context_item_ids) = (
        SELECT COUNT(DISTINCT value)
        FROM json_each(NEW.source_context_item_ids)
      )
    )
  )
  BEGIN
    SELECT RAISE(ABORT, 'invalid bubble discussion extraction provenance');
  END;

  CREATE TRIGGER bubbles_provenance_update_guard
  BEFORE UPDATE OF
    source_kind,
    source_discussion_id,
    source_discussion_title,
    source_discussion_deleted_at,
    source_message_ids,
    source_context_item_ids,
    latest_extraction_id
  ON bubbles
  WHEN NOT (
    (
      NEW.source_kind = 'manual'
      AND NEW.source_discussion_id IS NULL
      AND NEW.source_discussion_title IS NULL
      AND NEW.source_discussion_deleted_at IS NULL
      AND NEW.latest_extraction_id IS NULL
      AND json_array_length(NEW.source_message_ids) = 0
      AND json_array_length(NEW.source_context_item_ids) = 0
    )
    OR
    (
      NEW.source_kind = 'discussion'
      AND NEW.source_discussion_id IS NOT NULL
      AND length(trim(NEW.source_discussion_id)) > 0
      AND NEW.source_discussion_title IS NOT NULL
      AND length(trim(NEW.source_discussion_title)) > 0
      AND NEW.latest_extraction_id IS NOT NULL
      AND length(trim(NEW.latest_extraction_id)) > 0
      AND (
        json_array_length(NEW.source_message_ids)
        + json_array_length(NEW.source_context_item_ids)
      ) > 0
      AND NOT EXISTS (
        SELECT 1
        FROM json_each(NEW.source_message_ids)
        WHERE type <> 'text' OR length(trim(value)) = 0
      )
      AND NOT EXISTS (
        SELECT 1
        FROM json_each(NEW.source_context_item_ids)
        WHERE type <> 'text' OR length(trim(value)) = 0
      )
      AND json_array_length(NEW.source_message_ids) = (
        SELECT COUNT(DISTINCT value)
        FROM json_each(NEW.source_message_ids)
      )
      AND json_array_length(NEW.source_context_item_ids) = (
        SELECT COUNT(DISTINCT value)
        FROM json_each(NEW.source_context_item_ids)
      )
    )
  )
  BEGIN
    SELECT RAISE(ABORT, 'invalid bubble discussion extraction provenance');
  END;

  UPDATE bubbles
  SET source_kind = source_kind;
`;
