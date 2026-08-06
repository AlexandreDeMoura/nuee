/**
 * Repairs foreign keys rewritten by the first deployed version of migration
 * 012. That version renamed `projects` before rebuilding it, so modern SQLite
 * rewrote child REFERENCES clauses to the temporary table name. The temporary
 * table was then dropped, leaving project-owned inserts unable to resolve
 * their parent table.
 *
 * This rename round trip works for both affected and already-correct schemas.
 * The first rename deliberately leaves child SQL unchanged. The second uses
 * SQLite's current rename behavior: references to the temporary name in an
 * affected database are rewritten to `projects`, while references already
 * naming `projects` remain correct.
 */
export const REPAIR_PROJECT_FOREIGN_KEYS_MIGRATION = `
  PRAGMA legacy_alter_table = ON;

  ALTER TABLE projects RENAME TO projects_pre_description_widening;

  PRAGMA legacy_alter_table = OFF;

  ALTER TABLE projects_pre_description_widening RENAME TO projects;
`;
