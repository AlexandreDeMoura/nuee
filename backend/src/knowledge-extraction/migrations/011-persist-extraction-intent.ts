import { KNOWLEDGE_EXTRACTION_INSTRUCTIONS_MAX_LENGTH } from '../knowledge-extraction.types';

export const PERSIST_EXTRACTION_INTENT_MIGRATION = `
  ALTER TABLE knowledge_extraction_attempts
  ADD COLUMN instructions TEXT CHECK (
    instructions IS NULL
    OR (
      length(instructions) > 0
      AND length(instructions) <= ${KNOWLEDGE_EXTRACTION_INSTRUCTIONS_MAX_LENGTH}
      AND instructions = trim(instructions)
    )
  );

  ALTER TABLE knowledge_extraction_attempts
  ADD COLUMN detail_level TEXT NOT NULL DEFAULT 'standard' CHECK (
    detail_level IN ('tight', 'standard', 'detailed')
  );

  DROP TRIGGER knowledge_extraction_attempts_source_immutable_guard;

  CREATE TRIGGER knowledge_extraction_attempts_source_immutable_guard
  BEFORE UPDATE OF
    project_id,
    discussion_id,
    idempotency_key,
    request_fingerprint,
    source_snapshot,
    instructions,
    detail_level,
    created_at,
    expires_at
  ON knowledge_extraction_attempts
  BEGIN
    SELECT RAISE(
      ABORT,
      'knowledge extraction source snapshot is immutable'
    );
  END;
`;
