// Migration SQL is a historical record of one schema transition and must stay
// literal. Interpolating PROJECT_DESCRIPTION_MAX_LENGTH here would make this
// statement mean something different depending on when it runs, while the
// ledger records only that "create-projects" was applied. A database that
// applied it under one value would be indistinguishable from one that applied
// it under another, and neither would ever be corrected.
//
// The current limit is reached by applying this migration and every later one
// in order; migration 012 widens the description CHECK to its present value.
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
