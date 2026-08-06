/**
 * Widens the description CHECK from 280 to 800, because rebuilding the table is
 * the only way to replace a CHECK in SQLite.
 *
 * The limit is written literally rather than interpolated from
 * PROJECT_DESCRIPTION_MAX_LENGTH. A migration records one fixed transition: the
 * ledger stores only that "widen-project-description" ran, so an interpolated
 * value would let two databases apply the same recorded migration and end up
 * with different constraints, with no way to tell them apart or repair either.
 * Raising the limit again means adding a new migration, which the schema guard
 * in the migrations spec enforces.
 *
 * The statement order follows SQLite's documented table-rebuild procedure and
 * is not interchangeable. The original table is dropped rather than renamed:
 * renaming it would rewrite the REFERENCES clause of all five tables that point
 * at `projects`, leaving them attached to the discarded copy. Building the
 * replacement under a temporary name and renaming it last leaves those clauses
 * untouched, so they resolve to the rebuilt table and cascade behaviour
 * survives.
 *
 * `DROP TABLE projects` is only safe because `runDatabaseMigrations` suspends
 * foreign key enforcement; with it enabled the implicit DELETE FROM would
 * cascade and delete every bubble, link, discussion, document, and extraction
 * attempt in the database.
 *
 * A rebuild also drops the table's indexes, so the ordering index is recreated.
 */
export const WIDEN_PROJECT_DESCRIPTION_MIGRATION = `
  CREATE TABLE projects_rebuilt (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL CHECK (length(title) > 0),
    description TEXT NOT NULL CHECK (
      length(description) > 0 AND length(description) <= 800
    ),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    canvas_viewport_x REAL NOT NULL DEFAULT 0,
    canvas_viewport_y REAL NOT NULL DEFAULT 0,
    canvas_zoom REAL NOT NULL DEFAULT 1
  ) STRICT;

  INSERT INTO projects_rebuilt (
    id,
    title,
    description,
    created_at,
    updated_at,
    canvas_viewport_x,
    canvas_viewport_y,
    canvas_zoom
  )
  SELECT
    id,
    title,
    description,
    created_at,
    updated_at,
    canvas_viewport_x,
    canvas_viewport_y,
    canvas_zoom
  FROM projects;

  DROP TABLE projects;

  ALTER TABLE projects_rebuilt RENAME TO projects;

  CREATE INDEX IF NOT EXISTS projects_updated_at_idx
    ON projects (updated_at DESC, created_at DESC, id ASC);
`;
