export const CREATE_PROJECTS_MIGRATION = `
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL CHECK (length(title) > 0),
    description TEXT NOT NULL CHECK (
      length(description) > 0 AND length(description) <= 280
    ),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    canvas_viewport_x REAL NOT NULL DEFAULT 0,
    canvas_viewport_y REAL NOT NULL DEFAULT 0,
    canvas_zoom REAL NOT NULL DEFAULT 1
  ) STRICT;

  CREATE INDEX IF NOT EXISTS projects_updated_at_idx
    ON projects (updated_at DESC, created_at DESC, id ASC);
`;
