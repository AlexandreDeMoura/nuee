export const CREATE_TERRITORIES_MIGRATION = `
  CREATE TABLE territories (
    id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
    project_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('composed', 'ungrouped')),
    title TEXT NOT NULL CHECK (
      length(trim(title)) > 0
      AND length(title) <= 60
      AND title = trim(title)
      AND (kind <> 'ungrouped' OR title = 'Ungrouped')
    ),
    position_x REAL NOT NULL,
    position_y REAL NOT NULL,
    visible_count INTEGER NOT NULL CHECK (
      visible_count >= 1 AND visible_count <= 100
    ),
    created_at TEXT NOT NULL CHECK (length(trim(created_at)) > 0),
    updated_at TEXT NOT NULL CHECK (length(trim(updated_at)) > 0),
    UNIQUE (id, project_id),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  ) STRICT;

  CREATE INDEX territories_project_id_idx
    ON territories (project_id, created_at ASC, id ASC);

  CREATE UNIQUE INDEX territories_one_ungrouped_per_project_idx
    ON territories (project_id)
    WHERE kind = 'ungrouped';

  INSERT INTO territories (
    id,
    project_id,
    kind,
    title,
    position_x,
    position_y,
    visible_count,
    created_at,
    updated_at
  )
  SELECT
    'territory:ungrouped:' || project_id,
    project_id,
    'ungrouped',
    'Ungrouped',
    MIN(position_x),
    MIN(position_y),
    MIN(4, COUNT(*)),
    MIN(created_at),
    MAX(updated_at)
  FROM bubbles
  GROUP BY project_id;

  CREATE TABLE bubbles_with_territories (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    territory_id TEXT NOT NULL,
    title TEXT NOT NULL CHECK (length(trim(title)) > 0),
    summary TEXT CHECK (
      summary IS NULL OR length(trim(summary)) > 0
    ),
    content TEXT NOT NULL CHECK (length(trim(content)) > 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    source_kind TEXT NOT NULL DEFAULT 'manual' CHECK (
      source_kind IN ('manual', 'discussion')
    ),
    source_discussion_id TEXT,
    source_message_ids TEXT NOT NULL DEFAULT '[]' CHECK (
      json_valid(source_message_ids) AND json_type(source_message_ids) = 'array'
    ),
    source_context_item_ids TEXT NOT NULL DEFAULT '[]' CHECK (
      json_valid(source_context_item_ids)
      AND json_type(source_context_item_ids) = 'array'
    ),
    source_discussion_title TEXT CHECK (
      source_discussion_title IS NULL
      OR length(trim(source_discussion_title)) > 0
    ),
    source_discussion_deleted_at TEXT CHECK (
      source_discussion_deleted_at IS NULL
      OR length(trim(source_discussion_deleted_at)) > 0
    ),
    latest_extraction_id TEXT CHECK (
      latest_extraction_id IS NULL
      OR length(trim(latest_extraction_id)) > 0
    ),
    UNIQUE (id, project_id),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (territory_id, project_id)
      REFERENCES territories(id, project_id) ON DELETE RESTRICT
  ) STRICT;

  INSERT INTO bubbles_with_territories (
    id,
    project_id,
    territory_id,
    title,
    summary,
    content,
    created_at,
    updated_at,
    source_kind,
    source_discussion_id,
    source_message_ids,
    source_context_item_ids,
    source_discussion_title,
    source_discussion_deleted_at,
    latest_extraction_id
  )
  SELECT
    id,
    project_id,
    'territory:ungrouped:' || project_id,
    title,
    summary,
    content,
    created_at,
    updated_at,
    source_kind,
    source_discussion_id,
    source_message_ids,
    source_context_item_ids,
    source_discussion_title,
    source_discussion_deleted_at,
    latest_extraction_id
  FROM bubbles;

  DROP TABLE bubbles;
  ALTER TABLE bubbles_with_territories RENAME TO bubbles;

  CREATE INDEX bubbles_project_id_idx
    ON bubbles (project_id, created_at ASC, id ASC);

  CREATE INDEX bubbles_territory_id_idx
    ON bubbles (project_id, territory_id, created_at ASC, id ASC);

  CREATE UNIQUE INDEX bubbles_id_project_id_unique_idx
    ON bubbles (id, project_id);

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
        SELECT 1 FROM json_each(NEW.source_message_ids)
        WHERE type <> 'text' OR length(trim(value)) = 0
      )
      AND NOT EXISTS (
        SELECT 1 FROM json_each(NEW.source_context_item_ids)
        WHERE type <> 'text' OR length(trim(value)) = 0
      )
      AND json_array_length(NEW.source_message_ids) = (
        SELECT COUNT(DISTINCT value) FROM json_each(NEW.source_message_ids)
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
        SELECT 1 FROM json_each(NEW.source_message_ids)
        WHERE type <> 'text' OR length(trim(value)) = 0
      )
      AND NOT EXISTS (
        SELECT 1 FROM json_each(NEW.source_context_item_ids)
        WHERE type <> 'text' OR length(trim(value)) = 0
      )
      AND json_array_length(NEW.source_message_ids) = (
        SELECT COUNT(DISTINCT value) FROM json_each(NEW.source_message_ids)
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
`;
