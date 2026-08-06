import { PROJECT_DESCRIPTION_MAX_LENGTH } from '@nuee/shared-types';

// The interpolated value is a compile-time constant, never request input, so it
// carries none of the injection risk that bans interpolation elsewhere.
//
// Editing the constant only changes databases created from this point on. An
// existing database keeps the CHECK it was built with, because an applied
// migration is never re-run: widening or narrowing the limit for existing data
// needs a new migration that rebuilds the table.
export const CREATE_PROJECTS_MIGRATION = `
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL CHECK (length(title) > 0),
    description TEXT NOT NULL CHECK (
      length(description) > 0 AND length(description) <= ${PROJECT_DESCRIPTION_MAX_LENGTH}
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
