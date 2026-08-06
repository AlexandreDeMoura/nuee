/**
 * Validation limits that both sides of the API must agree on.
 *
 * These are runtime values, not types: the backend enforces them at the HTTP
 * boundary and the frontend uses them to keep input inside the same bounds
 * before a request is ever made. Keeping one definition removes the drift where
 * a client accepts input the server rejects.
 *
 * Changing a limit here does not migrate an existing database. Where SQLite
 * reinforces the same rule with a CHECK constraint, an existing database keeps
 * the constraint it was created with until a new migration rebuilds the table.
 */

/** Maximum length of a project description, measured after trimming. */
export const PROJECT_DESCRIPTION_MAX_LENGTH = 280;

/** Maximum length of the optional instructions attached to an extraction. */
export const KNOWLEDGE_EXTRACTION_INSTRUCTIONS_MAX_LENGTH = 2_000;
