export const CREATE_BUBBLES_MIGRATION = `
  CREATE TABLE IF NOT EXISTS bubbles (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    title TEXT NOT NULL CHECK (length(trim(title)) > 0),
    summary TEXT CHECK (
      summary IS NULL OR length(trim(summary)) > 0
    ),
    content TEXT NOT NULL CHECK (length(trim(content)) > 0),
    position_x REAL NOT NULL DEFAULT 0,
    position_y REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    source_kind TEXT NOT NULL DEFAULT 'manual' CHECK (
      source_kind IN ('manual', 'discussion')
    ),
    source_discussion_id TEXT,
    source_message_ids TEXT NOT NULL DEFAULT '[]' CHECK (
      json_valid(source_message_ids) AND json_type(source_message_ids) = 'array'
    ),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  ) STRICT;

  CREATE INDEX IF NOT EXISTS bubbles_project_id_idx
    ON bubbles (project_id, created_at ASC, id ASC);
`;
