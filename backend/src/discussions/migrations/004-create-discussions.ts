export const CREATE_DISCUSSIONS_MIGRATION = `
  CREATE TABLE IF NOT EXISTS discussions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    title TEXT CHECK (
      title IS NULL OR length(trim(title)) > 0
    ),
    frozen_context TEXT NOT NULL CHECK (
      json_valid(frozen_context) AND json_type(frozen_context) = 'object'
    ),
    created_at TEXT NOT NULL CHECK (length(trim(created_at)) > 0),
    updated_at TEXT NOT NULL CHECK (length(trim(updated_at)) > 0),
    last_activity_at TEXT NOT NULL CHECK (
      length(trim(last_activity_at)) > 0
    ),
    deleted_at TEXT CHECK (
      deleted_at IS NULL OR length(trim(deleted_at)) > 0
    ),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  ) STRICT;

  CREATE INDEX IF NOT EXISTS discussions_project_activity_idx
    ON discussions (
      project_id,
      last_activity_at DESC,
      created_at DESC,
      id ASC
    )
    WHERE deleted_at IS NULL;
`;
